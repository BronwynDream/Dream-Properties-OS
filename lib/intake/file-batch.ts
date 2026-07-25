import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseFilename } from "@/lib/diff";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Core logic for filing a batch's classified documents against an already-
// attached property, without going through the extract → commit_batch RPC.
// Client-agnostic so it can be called from:
//   - Server actions (session client, cookie-based auth) → app/triage/actions.ts
//   - Webhooks (service-role client, no cookies) → app/api/intake/email
//
// The caller supplies both the Supabase client and the auth'd user id
// (service-role callers pass the batch's created_by).
//
// Returns a summary so the caller can render a message. Errors are returned
// as `{ ok: false, error }` rather than thrown — one bad batch shouldn't
// panic the intake webhook.
export async function fileBatchAgainstPropertyWithClient(
  supabase: SupabaseClient,
  batchId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string; filed?: number; deduped?: number }> {
  const { data: batch, error: bErr } = await supabase
    .from("ingest_batch")
    .select("id, status, property_id")
    .eq("id", batchId)
    .single();
  if (bErr || !batch) return { ok: false, error: bErr?.message ?? "batch not found" };
  if (!batch.property_id) {
    return {
      ok: false,
      error: "Batch is not attached to a property. Attach one first, then file.",
    };
  }
  if (batch.status === "committed") {
    return { ok: false, error: "Batch is already committed." };
  }

  const { data: ifiles } = await supabase
    .from("ingest_file")
    .select(
      "id, original_filename, storage_bucket, storage_path, mime_type, byte_size, is_pii, detected_doc_type_id, status",
    )
    .eq("batch_id", batchId);

  // Dedupe against documents already on this property (by normalised title +
  // byte size) so re-forwarding the same email doesn't produce duplicate rows.
  const { data: existingLinks } = await supabase
    .from("document_link")
    .select("document_id, document:document_id(id, title, byte_size)")
    .eq("entity_type", "property")
    .eq("entity_id", batch.property_id);
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
    if (!f.detected_doc_type_id) continue;
    if (f.original_filename.toLowerCase().endsWith(".eml")) continue;
    if (f.status === "committed") continue;

    const key = `${normaliseFilename(f.original_filename)}::${f.byte_size ?? ""}`;
    const existingDocId = existingByKey.get(key);

    let docId: string | null = existingDocId ?? null;
    if (existingDocId) {
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
        await supabase.from("document_link").insert({
          document_id: doc.id,
          entity_type: "property",
          entity_id: batch.property_id,
        });
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

  await supabase.from("ingest_batch").update({ status: "committed" }).eq("id", batchId);

  return { ok: true, filed, deduped };
}

// Categories that produce structured fields → extract → commit_batch flow.
// Anything not in this set is filing-only (plans, photos, correspondence,
// FICA-only shortcuts, uncategorised).
const EXTRACTABLE_CATEGORIES = new Set([
  "agreement",
  "fica",
  "listing",
  "municipal",
  "company",
]);

// Decide whether a batch is filing-only — i.e. contains at least one classified
// file but none of them belong to an extractable category. Used by the intake
// webhook to auto-file a batch after classification when nothing needs
// extracting (skip triage entirely).
export async function batchIsFilingOnly(
  supabase: SupabaseClient,
  batchId: string,
): Promise<boolean> {
  const { data: files } = await supabase
    .from("ingest_file")
    .select("detected_doc_type_id, document_type:detected_doc_type_id(category)")
    .eq("batch_id", batchId);

  const rows = (files ?? []) as any[];
  if (rows.length === 0) return false;
  const anyClassified = rows.some((r) => r.detected_doc_type_id);
  if (!anyClassified) return false;
  return !rows.some((r) => {
    const cat = r.document_type?.category as string | undefined;
    return cat ? EXTRACTABLE_CATEGORIES.has(cat) : false;
  });
}
