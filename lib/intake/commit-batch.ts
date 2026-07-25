import type { SupabaseClient } from "@supabase/supabase-js";
import { reshapeFields } from "@/lib/extract";
import { normaliseFilename } from "@/lib/diff";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Shared commit pipeline — reads extraction rows for a batch, calls the
// commit_batch RPC to upsert property/transfer/agreement/parties, then
// promotes each classified file into the `document` table + document_link.
//
// Client-agnostic so it runs from both:
//   - Server actions (session client, cookie auth) → app/triage/actions.ts
//   - Webhooks (service-role client, no cookies) → app/api/intake/email
//
// commit_batch's authorization guard was loosened in migration 0036 to
// allow the service_role postgres role, so the intake webhook can auto-
// commit high-confidence batches without a human click.

export type CommitBatchResult = {
  ok: boolean;
  error?: string;
  propertyId?: string;
  transferId?: string;
  filed?: number;
  deduped?: number;
};

export async function commitBatchWithClient(
  supabase: SupabaseClient,
  batchId: string,
  userId: string,
): Promise<CommitBatchResult> {
  // 1. Pull the fresh 'proposed' extraction rows and reshape into the nested
  //    JSON that commit_batch expects.
  const { data: extractions } = await supabase
    .from("extraction")
    .select("target_table, target_field, entity_hint, proposed_value")
    .eq("batch_id", batchId)
    .eq("status", "proposed");

  const rows = ((extractions ?? []) as any[]).map((e) => ({
    target_table: e.target_table,
    target_field: e.target_field,
    entity_hint: e.entity_hint,
    proposed_value: e.proposed_value ?? "",
  }));

  const fields: any = reshapeFields(rows);

  // 2. Fold in any 'link' decisions the reviewer set on match candidates.
  //    At intake time this is empty (no reviewer has touched the batch),
  //    but keep the logic for symmetry with the server-action path.
  const { data: decided } = await supabase
    .from("match_candidate")
    .select("extracted_ref, candidate_id")
    .eq("batch_id", batchId)
    .eq("decision", "link");
  for (const d of (decided ?? []) as { extracted_ref: string; candidate_id: string }[]) {
    if (d.extracted_ref === "property") {
      fields.property.id = d.candidate_id;
    } else if (d.extracted_ref === "transfer") {
      if (!fields.transfer) fields.transfer = {};
      fields.transfer.id = d.candidate_id;
    } else {
      const m = d.extracted_ref.match(/^(seller|purchaser)_(\d+)$/);
      if (!m) continue;
      const arr = m[1] === "purchaser" ? fields.purchasers : fields.sellers;
      const i = parseInt(m[2], 10) - 1;
      while (arr.length <= i) arr.push({});
      arr[i].id = d.candidate_id;
    }
  }

  // 3. Property / transfer fallbacks from the batch (auto-attached at intake).
  if (!fields.property.id || (fields.transfer && !fields.transfer.id)) {
    const { data: batchRow } = await supabase
      .from("ingest_batch")
      .select("property_id, transfer_id")
      .eq("id", batchId)
      .single();
    if (!fields.property.id && batchRow?.property_id) {
      fields.property.id = batchRow.property_id;
    }
    if (batchRow?.transfer_id) {
      if (!fields.transfer) fields.transfer = {};
      if (!fields.transfer.id) fields.transfer.id = batchRow.transfer_id;
    }
  } else if (!fields.transfer?.id) {
    const { data: batchRow } = await supabase
      .from("ingest_batch")
      .select("transfer_id")
      .eq("id", batchId)
      .single();
    if (batchRow?.transfer_id) {
      if (!fields.transfer) fields.transfer = {};
      fields.transfer.id = batchRow.transfer_id;
    }
  }

  // 4. Suburb fallback: scan the extracted address for a seeded suburb name
  //    when the LLM lumped it into the address string.
  if (!fields.property.suburb && fields.property.primary_address) {
    const { data: suburbs } = await supabase.from("suburb").select("name");
    const addr = String(fields.property.primary_address).toLowerCase();
    let best: string | null = null;
    for (const s of (suburbs ?? []) as { name: string }[]) {
      if (addr.includes(s.name.toLowerCase())) {
        if (!best || s.name.length > best.length) best = s.name;
      }
    }
    if (best) fields.property.suburb = best;
  }

  // 5. Fire commit_batch — upserts property/transfer/agreement/parties.
  const { data, error } = await supabase.rpc("commit_batch", {
    p_batch_id: batchId,
    p_fields: fields,
  });
  if (error) return { ok: false, error: error.message };

  const result = data as { property_id: string; transfer_id: string };

  // 6. Promote each classified file into `document` + link to property AND
  //    transfer. Dedupe by normalised title + byte size against existing
  //    documents on the same property.
  const { data: ifiles } = await supabase
    .from("ingest_file")
    .select(
      "id, original_filename, storage_bucket, storage_path, mime_type, byte_size, is_pii, detected_doc_type_id, status",
    )
    .eq("batch_id", batchId);

  const { data: existingLinks } = await supabase
    .from("document_link")
    .select("document_id, document:document_id(id, title, byte_size)")
    .eq("entity_type", "property")
    .eq("entity_id", result.property_id);
  const existingByKey = new Map<string, string>();
  for (const link of (existingLinks ?? []) as any[]) {
    const d = link.document;
    if (!d?.title) continue;
    const key = `${normaliseFilename(d.title)}::${d.byte_size ?? ""}`;
    existingByKey.set(key, d.id);
  }

  let filed = 0;
  let deduped = 0;
  for (const f of (ifiles ?? []) as any[]) {
    if (!f.detected_doc_type_id || f.status === "parsed" || f.status === "committed") continue;

    const key = `${normaliseFilename(f.original_filename)}::${f.byte_size ?? ""}`;
    const existingDocId = existingByKey.get(key);

    let docId: string | null = null;
    if (existingDocId) {
      docId = existingDocId;
      await supabase.from("document_link").insert({
        document_id: docId,
        entity_type: "transfer",
        entity_id: result.transfer_id,
      });
      deduped++;
    } else {
      const { data: doc } = await supabase
        .from("document")
        .insert({
          doc_type_id: f.detected_doc_type_id,
          title: f.original_filename,
          storage_bucket: f.storage_bucket,
          storage_path: f.storage_path,
          mime_type: f.mime_type,
          byte_size: f.byte_size,
          is_pii: f.is_pii,
          status: "final",
          uploaded_by: userId,
        })
        .select("id")
        .single();
      if (doc) {
        docId = doc.id;
        await supabase.from("document_link").insert([
          { document_id: doc.id, entity_type: "transfer", entity_id: result.transfer_id },
          { document_id: doc.id, entity_type: "property", entity_id: result.property_id },
        ]);
        existingByKey.set(key, doc.id);
        filed++;
      }
    }

    if (docId) {
      await supabase
        .from("ingest_file")
        .update({ committed_document_id: docId, status: "committed" })
        .eq("id", f.id);
    }
  }

  return {
    ok: true,
    propertyId: result.property_id,
    transferId: result.transfer_id,
    filed,
    deduped,
  };
}
