"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { classifyFilename, JURISTIC_CODES } from "@/lib/classify";
import { reshapeFields } from "@/lib/extract";
import { normaliseFilename } from "@/lib/diff";

type DocType = {
  id: string;
  code: string;
  category: string;
  is_pii_default: boolean;
};

// Derive a human batch name from a document filename (strip type keywords + extension).
function deriveLabel(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(
      /\b(final\s+(signed|executed)?|property information|detailed listing|agreement of sale|deed of sale|land freehold agreement|joint mandate|open mandate|sole mandate|mandate|cma|comparative market analysis|light?stone|property report|fica)\b/gi,
      "",
    )
    .replace(/\(\d+\)/g, "")
    .replace(/[-–_,]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–_]+|[\s\-–_]+$/g, "")
    .trim();
}

const GENERIC_LABEL = /^dropped files/i;

// Preference order for which document names a batch (cleanest first).
const NAME_RANK = [
  "property_info",
  "detailed_listing",
  "agreement_of_sale",
  "land_freehold_agreement",
  "mandate",
  "cma",
  "lightstone_report",
];

// Classify every file in a batch by filename, set PII from the doc type, then score
// the batch tier (red = juristic/manual; green = agreement + FICA present; amber = else).
export async function classifyBatch(batchId: string) {
  const supabase = createClient();

  const { data: types } = await supabase
    .from("document_type")
    .select("id, code, category, is_pii_default");
  const byCode = new Map<string, DocType>(
    ((types ?? []) as DocType[]).map((t) => [t.code, t]),
  );

  const { data: allFiles } = await supabase
    .from("ingest_file")
    .select("id, original_filename, byte_size")
    .eq("batch_id", batchId);

  // De-duplicate: same filename + size ingested twice (folder had .eml AND loose copies).
  const seen = new Set<string>();
  const dupeIds: string[] = [];
  const files: { id: string; original_filename: string }[] = [];
  for (const f of allFiles ?? []) {
    const key = `${f.original_filename}::${f.byte_size ?? ""}`;
    if (seen.has(key)) dupeIds.push(f.id);
    else {
      seen.add(key);
      files.push({ id: f.id, original_filename: f.original_filename });
    }
  }
  if (dupeIds.length) await supabase.from("ingest_file").delete().in("id", dupeIds);

  const { data: batchRow } = await supabase
    .from("ingest_batch")
    .select("label")
    .eq("id", batchId)
    .single();

  const seenCategories = new Set<string>();
  let juristic = false;
  let labelCandidate: string | null = null;
  let bestRank = Infinity;

  for (const f of files ?? []) {
    const code = classifyFilename(f.original_filename);
    const t = byCode.get(code) ?? byCode.get("other");
    if (t) {
      seenCategories.add(t.category);
      if (JURISTIC_CODES.has(code)) juristic = true;
      const rank = NAME_RANK.indexOf(code);
      if (rank !== -1 && rank < bestRank) {
        const d = deriveLabel(f.original_filename);
        if (d.length > 3) {
          labelCandidate = d;
          bestRank = rank;
        }
      }
      await supabase
        .from("ingest_file")
        .update({
          detected_doc_type_id: t.id,
          is_pii: t.is_pii_default,
          classification_confidence: code === "other" ? 0.3 : 0.9,
          status: "classified",
        })
        .eq("id", f.id);
    }
  }

  const hasAgreement = seenCategories.has("agreement");
  const hasFica = seenCategories.has("fica");
  const tier = juristic ? "red" : hasAgreement && hasFica ? "green" : "amber";

  const update: Record<string, unknown> = { tier, status: "in_review" };
  if (batchRow && GENERIC_LABEL.test(batchRow.label) && labelCandidate) {
    update.label = labelCandidate;
  }

  await supabase.from("ingest_batch").update(update).eq("id", batchId);

  revalidatePath(`/triage/${batchId}`);
  revalidatePath("/triage");
}

// Rename every generically-labelled batch from its best-named document, in one pass.
export async function nameAllBatches() {
  const supabase = createClient();

  const { data: types } = await supabase.from("document_type").select("id, code");
  const idToCode = new Map<string, string>(
    ((types ?? []) as { id: string; code: string }[]).map((t) => [t.id, t.code]),
  );

  const { data: batches } = await supabase
    .from("ingest_batch")
    .select("id, label")
    .ilike("label", "Dropped files%");

  for (const b of batches ?? []) {
    const { data: bf } = await supabase
      .from("ingest_file")
      .select("original_filename, detected_doc_type_id")
      .eq("batch_id", b.id);

    let best: string | null = null;
    let bestRank = Infinity;
    let firstName: string | null = null;
    for (const f of bf ?? []) {
      if (!firstName) firstName = deriveLabel(f.original_filename);
      const code = f.detected_doc_type_id ? idToCode.get(f.detected_doc_type_id) : undefined;
      const rank = code ? NAME_RANK.indexOf(code) : -1;
      if (rank !== -1 && rank < bestRank) {
        const d = deriveLabel(f.original_filename);
        if (d.length > 3) {
          best = d;
          bestRank = rank;
        }
      }
    }
    const label = best ?? (firstName && firstName.length > 3 ? firstName : null);
    if (label) {
      await supabase.from("ingest_batch").update({ label }).eq("id", b.id);
    }
  }

  revalidatePath("/triage");
}

// Row shape shared between propose_matches, commit_batch, and reshapeFields.
type FieldRow = {
  target_table: string;
  target_field: string;
  entity_hint: string | null;
  value: string;
};

// Ask the DB to score fuzzy-match candidates for the batch's extracted
// property + individual parties. Idempotent; preserves prior decisions.
export async function proposeMatches(batchId: string, rows: FieldRow[]) {
  const supabase = createClient();
  const fields = reshapeFields(rows);
  const { error } = await supabase.rpc("propose_matches", {
    p_batch_id: batchId,
    p_fields: fields,
  });
  revalidatePath(`/triage/${batchId}`);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

// Record the reviewer's call on a target: link to a candidate, or create fresh.
// "link" sets that row to 'link' and clears siblings so a mind-change is one click.
// "create" marks every candidate row for the target as 'create'.
// "reset" returns every row for the target to 'undecided'.
export async function decideMatch(
  batchId: string,
  targetRef: string,
  candidateId: string | null,
  decision: "link" | "create" | "reset",
) {
  const supabase = createClient();
  if (decision === "reset") {
    await supabase
      .from("match_candidate")
      .update({ decision: "undecided", decided_at: null })
      .eq("batch_id", batchId)
      .eq("extracted_ref", targetRef);
  } else if (decision === "create") {
    await supabase
      .from("match_candidate")
      .update({ decision: "create", decided_at: new Date().toISOString() })
      .eq("batch_id", batchId)
      .eq("extracted_ref", targetRef);
  } else if (decision === "link" && candidateId) {
    await supabase
      .from("match_candidate")
      .update({ decision: "undecided", decided_at: null })
      .eq("batch_id", batchId)
      .eq("extracted_ref", targetRef);
    await supabase
      .from("match_candidate")
      .update({ decision: "link", decided_at: new Date().toISOString() })
      .eq("id", candidateId);
  }
  revalidatePath(`/triage/${batchId}`);
}

export async function commitBatch(batchId: string, rows: FieldRow[]) {
  const supabase = createClient();

  const fields = reshapeFields(rows);

  // Fold "link" decisions from match_candidate into explicit IDs so
  // commit_batch skips its match-or-create path for these entities.
  const { data: decided } = await supabase
    .from("match_candidate")
    .select("extracted_ref, candidate_id")
    .eq("batch_id", batchId)
    .eq("decision", "link");
  for (const d of (decided ?? []) as { extracted_ref: string; candidate_id: string }[]) {
    if (d.extracted_ref === "property") {
      fields.property.id = d.candidate_id;
    } else {
      const m = d.extracted_ref.match(/^(seller|purchaser)_(\d+)$/);
      if (!m) continue;
      const arr = m[1] === "purchaser" ? fields.purchasers : fields.sellers;
      const i = parseInt(m[2], 10) - 1;
      while (arr.length <= i) arr.push({});
      arr[i].id = d.candidate_id;
    }
  }

  // Suburb fallback: if the LLM extracted an address but not a suburb
  // (very common — LLMs treat "6 Bowden Park, Leisure Isle, Knysna" as one
  // string), scan the extracted address for a seeded suburb name.
  // Prefer the longest match (Thesen Islands beats Thesen).
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

  const { data, error } = await supabase.rpc("commit_batch", {
    p_batch_id: batchId,
    p_fields: fields,
  });
  if (error) return { ok: false, error: error.message };

  const result = data as { property_id: string; transfer_id: string };

  // Promote the batch's documents into `document` + link them to the new deal.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: ifiles } = await supabase
    .from("ingest_file")
    .select(
      "id, original_filename, storage_bucket, storage_path, mime_type, byte_size, is_pii, detected_doc_type_id, status",
    )
    .eq("batch_id", batchId);

  // Pre-fetch existing documents already linked to this property so we can
  // dedupe by normalised title + byte_size. Turns the "37 docs, most duplicates"
  // property record into a clean unique set as batches accumulate.
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

  for (const f of (ifiles ?? []) as any[]) {
    // skip the .eml wrappers (already unpacked) and anything unclassified
    if (!f.detected_doc_type_id || f.status === "parsed" || f.status === "committed") continue;

    const key = `${normaliseFilename(f.original_filename)}::${f.byte_size ?? ""}`;
    const existingDocId = existingByKey.get(key);

    let docId: string | null = null;

    if (existingDocId) {
      // Same file, already on this property — reuse the document row. Only
      // add a document_link for the new transfer (the property link is already
      // there from the prior commit).
      docId = existingDocId;
      await supabase.from("document_link").insert({
        document_id: docId,
        entity_type: "transfer",
        entity_id: result.transfer_id,
      });
    } else {
      // First time seeing this file on this property — create it fresh.
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
          uploaded_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (doc) {
        docId = doc.id;
        await supabase.from("document_link").insert([
          { document_id: doc.id, entity_type: "transfer", entity_id: result.transfer_id },
          { document_id: doc.id, entity_type: "property", entity_id: result.property_id },
        ]);
        // Remember for the rest of this batch so intra-batch duplicates also
        // collapse (rare but happens with .eml unpack + loose copies).
        existingByKey.set(key, doc.id);
      }
    }

    if (docId) {
      await supabase
        .from("ingest_file")
        .update({ committed_document_id: docId, status: "committed" })
        .eq("id", f.id);
    }
  }

  revalidatePath(`/triage/${batchId}`);
  revalidatePath("/triage");
  return { ok: true, result };
}

// Property search for the manual-attach flow — matches against primary_address,
// title_deed_no, and erf_number. Returns 20 max, with the property's suburb +
// erf list rolled in for at-a-glance disambiguation.
export type PropertyHit = {
  id: string;
  address: string;
  deed: string | null;
  suburb: string | null;
  erven: string[];
};

export async function searchProperties(q: string): Promise<PropertyHit[]> {
  const supabase = createClient();
  const query = (q ?? "").trim();
  if (query.length < 2) return [];

  const like = `%${query.replace(/[%_]/g, "\\$&")}%`;

  // 1. Property-side matches (address / deed).
  const { data: propHits } = await supabase
    .from("property")
    .select("id, primary_address, title_deed_no, suburb:suburb_id(name)")
    .or(`primary_address.ilike.${like},title_deed_no.ilike.${like}`)
    .limit(20);

  // 2. Erf-side matches (erf number).
  const { data: erfHits } = await supabase
    .from("erf")
    .select("property_id, erf_number, property:property_id(id, primary_address, title_deed_no, suburb:suburb_id(name))")
    .ilike("erf_number", like)
    .limit(20);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map<string, any>();
  for (const p of (propHits ?? []) as any[]) {
    byId.set(p.id, { ...p, erven: [] as string[] });
  }
  for (const e of (erfHits ?? []) as any[]) {
    const p = e.property;
    if (!p) continue;
    if (!byId.has(p.id)) byId.set(p.id, { ...p, erven: [] as string[] });
    byId.get(p.id).erven.push(e.erf_number);
  }

  // Backfill erven for property-side matches so every result shows them.
  const ids = Array.from(byId.keys());
  if (ids.length > 0) {
    const { data: allErven } = await supabase
      .from("erf")
      .select("property_id, erf_number")
      .in("property_id", ids);
    for (const e of (allErven ?? []) as { property_id: string; erf_number: string }[]) {
      const row = byId.get(e.property_id);
      if (row && !row.erven.includes(e.erf_number)) row.erven.push(e.erf_number);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Array.from(byId.values()).slice(0, 20).map((p: any) => ({
    id: p.id,
    address: p.primary_address ?? "Unknown address",
    deed: p.title_deed_no ?? null,
    suburb: p.suburb?.name ?? null,
    erven: (p.erven ?? []) as string[],
  }));
}

// Link the batch's property target to a manually-picked property. Wipes any
// auto-proposed candidates for the target (they're superseded by this manual
// choice) and inserts a fresh match_candidate with decision='link' pointing at
// the chosen property. commit_batch reads that row and skips its match-or-create
// path, attaching straight to the existing property.
export async function linkPropertyManually(
  batchId: string,
  propertyId: string,
  label: string,
) {
  const supabase = createClient();
  await supabase
    .from("match_candidate")
    .delete()
    .eq("batch_id", batchId)
    .eq("extracted_ref", "property");
  await supabase.from("match_candidate").insert({
    batch_id: batchId,
    target_kind: "property",
    extracted_ref: "property",
    candidate_id: propertyId,
    candidate_label: label,
    score: 1.0,
    decision: "link",
    decided_at: new Date().toISOString(),
  });
  revalidatePath(`/triage/${batchId}`);
  return { ok: true as const };
}

// Manual correction of a single file's detected document type.
export async function setFileType(fileId: string, batchId: string, docTypeId: string) {
  const supabase = createClient();
  const { data: t } = await supabase
    .from("document_type")
    .select("is_pii_default")
    .eq("id", docTypeId)
    .single();
  await supabase
    .from("ingest_file")
    .update({
      detected_doc_type_id: docTypeId,
      is_pii: t?.is_pii_default ?? false,
      classification_confidence: 1.0,
      status: "classified",
    })
    .eq("id", fileId);
  revalidatePath(`/triage/${batchId}`);
}
