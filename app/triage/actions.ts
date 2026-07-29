"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { classifyFilename } from "@/lib/classify";
import { classifyBatchWithClient } from "@/lib/classify-batch";
import { reshapeFields } from "@/lib/extract";
import { normaliseFilename } from "@/lib/diff";
import { fileBatchAgainstPropertyWithClient } from "@/lib/intake/file-batch";
import { extractBatchWithClient } from "@/lib/intake/extract-batch";

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

// Classify every file in a batch by filename, set PII from the doc type, then
// score the batch tier. Thin wrapper around the shared helper so the intake
// webhook (service-role client, no cookies) can run the same logic.
export async function classifyBatch(batchId: string) {
  const supabase = createClient();
  await classifyBatchWithClient(batchId, supabase);
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
//
// Side-effect: any decision change on the property target invalidates the
// transfer picker (a picked transfer belongs to the OLD property choice).
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

  // Any property decision change wipes a stale transfer pick.
  if (targetRef === "property") {
    await supabase
      .from("match_candidate")
      .delete()
      .eq("batch_id", batchId)
      .eq("extracted_ref", "transfer");
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
    } else if (d.extracted_ref === "transfer") {
      // Explicit transfer picked by the reviewer — commit_batch verifies it
      // belongs to the linked property before using it.
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

  // Property + transfer take-on fallbacks: when a batch was created scoped to
  // a property (drop zone on /properties/[id]) OR is being re-committed after
  // a re-extract, ingest_batch.property_id / transfer_id are already set and
  // no match_candidate 'link' decision exists. Read them so commit_batch
  // links to the existing rows instead of creating duplicates. The
  // match-candidate 'link' decision takes precedence when both are set —
  // the reviewer's explicit choice wins.
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
    // property.id was provided via match-candidate but we still need to check
    // for a pre-existing transfer_id on the batch.
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
//
// Also wipes any transfer-picker decision on this batch — if the reviewer
// changed the property, any prior transfer pick belongs to the old property
// and is stale.
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
    .in("extracted_ref", ["property", "transfer"]);
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

// Attach the batch's transfer target to a specific existing transfer on the
// linked property. When set, commit_batch skips creating a new transfer and
// uses this one — parties / agreements / documents accrete onto it instead.
// The 'create' case is the absence of any transfer match_candidate row (the
// default), so linkTransfer with transferId = null / 'new' clears the target.
export async function linkTransfer(
  batchId: string,
  transferId: string | null,
  label: string | null,
) {
  const supabase = createClient();
  // Always wipe existing transfer decisions first — one target, one decision.
  await supabase
    .from("match_candidate")
    .delete()
    .eq("batch_id", batchId)
    .eq("extracted_ref", "transfer");

  if (transferId) {
    await supabase.from("match_candidate").insert({
      batch_id: batchId,
      target_kind: "transfer",
      extracted_ref: "transfer",
      candidate_id: transferId,
      candidate_label: label ?? "Existing transfer",
      score: 1.0,
      decision: "link",
      decided_at: new Date().toISOString(),
    });
  }
  revalidatePath(`/triage/${batchId}`);
  return { ok: true as const };
}

// Commit a batch by ID — same as commitBatch but fetches the extraction rows
// from the DB rather than accepting them as an arg. Used by the bulk-commit
// path where the client iterates through eligible batches without having
// their extraction rows pre-loaded.
export async function commitBatchById(batchId: string) {
  const supabase = createClient();
  const { data: extractions } = await supabase
    .from("extraction")
    .select("target_table, target_field, entity_hint, proposed_value")
    .eq("batch_id", batchId)
    .eq("status", "proposed");
  const rows: FieldRow[] = (extractions ?? []).map((e: any) => ({
    target_table: e.target_table,
    target_field: e.target_field,
    entity_hint: e.entity_hint,
    value: e.proposed_value ?? "",
  }));
  return commitBatch(batchId, rows);
}

// Merge N source batches into a target batch. Moves ingest_file rows,
// extraction rows, and match_candidate rows onto the target, then
// deletes the sources. Guard: source batches must not be committed
// (their files already belong to a real property; merging them would
// double-attach) and must not carry a distinct property_id from the
// target — a match_candidate resolution would silently override.
//
// Written to fix the 2026-07-29 discovery on /triage that the same
// folder had been ingested 2-4 times as separate batches (drag-drop
// twice, email intake twice, etc.) leaving Bronwyn to reconcile them
// by eye.
export async function mergeBatches(
  targetId: string,
  sourceIds: string[],
): Promise<{ ok: boolean; error?: string; moved?: { files: number; extractions: number; matches: number } }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const { data: me } = await supabase.from("app_user").select("role, active").eq("id", user.id).single();
  if (me?.role !== "admin" || me.active === false) return { ok: false, error: "admin only" };

  if (!targetId) return { ok: false, error: "targetId required" };
  const uniqSources = Array.from(new Set(sourceIds)).filter((id) => id && id !== targetId);
  if (uniqSources.length === 0) return { ok: false, error: "no source batches" };

  // Fetch target + all sources in one round-trip to validate.
  const { data: batchRows, error: bErr } = await supabase
    .from("ingest_batch")
    .select("id, status, property_id, transfer_id")
    .in("id", [targetId, ...uniqSources]);
  if (bErr) return { ok: false, error: bErr.message };
  const target = (batchRows ?? []).find((b) => b.id === targetId);
  if (!target) return { ok: false, error: "target batch not found" };
  const sources = (batchRows ?? []).filter((b) => b.id !== targetId);

  // Refuse committed sources (would double-attach their files to a real
  // property/transfer) and any source whose property/transfer link
  // conflicts with the target's.
  for (const s of sources) {
    if (s.status === "committed") {
      return { ok: false, error: `source ${s.id.slice(0, 8)} is committed — cannot merge` };
    }
    if (s.property_id && target.property_id && s.property_id !== target.property_id) {
      return { ok: false, error: `source ${s.id.slice(0, 8)} is linked to a different property` };
    }
    if (s.transfer_id && target.transfer_id && s.transfer_id !== target.transfer_id) {
      return { ok: false, error: `source ${s.id.slice(0, 8)} is linked to a different transfer` };
    }
  }

  // Move rows. Order matters: files first (largest set), then extractions,
  // then match_candidates. All operations are idempotent updates so a
  // partial failure won't corrupt state (source rows just haven't moved yet).
  let movedFiles = 0, movedExtractions = 0, movedMatches = 0;

  const { count: fileCount } = await supabase
    .from("ingest_file").select("id", { count: "exact", head: true }).in("batch_id", uniqSources);
  const { error: fErr } = await supabase
    .from("ingest_file").update({ batch_id: targetId }).in("batch_id", uniqSources);
  if (fErr) return { ok: false, error: `move files: ${fErr.message}` };
  movedFiles = fileCount ?? 0;

  const { count: exCount } = await supabase
    .from("extraction").select("id", { count: "exact", head: true }).in("batch_id", uniqSources);
  const { error: eErr } = await supabase
    .from("extraction").update({ batch_id: targetId }).in("batch_id", uniqSources);
  if (eErr) return { ok: false, error: `move extractions: ${eErr.message}` };
  movedExtractions = exCount ?? 0;

  const { count: mcCount } = await supabase
    .from("match_candidate").select("id", { count: "exact", head: true }).in("batch_id", uniqSources);
  const { error: mErr } = await supabase
    .from("match_candidate").update({ batch_id: targetId }).in("batch_id", uniqSources);
  if (mErr) return { ok: false, error: `move matches: ${mErr.message}` };
  movedMatches = mcCount ?? 0;

  // Coalesce property_id / transfer_id if only one side had it. Prefer target's
  // existing value; take source's when target is empty.
  const patch: Record<string, unknown> = {};
  if (!target.property_id) {
    const donor = sources.find((s) => s.property_id);
    if (donor?.property_id) patch.property_id = donor.property_id;
  }
  if (!target.transfer_id) {
    const donor = sources.find((s) => s.transfer_id);
    if (donor?.transfer_id) patch.transfer_id = donor.transfer_id;
  }
  if (Object.keys(patch).length > 0) {
    await supabase.from("ingest_batch").update(patch).eq("id", targetId);
  }

  // Delete the emptied sources.
  const { error: dErr } = await supabase.from("ingest_batch").delete().in("id", uniqSources);
  if (dErr) return { ok: false, error: `delete sources: ${dErr.message}` };

  revalidatePath("/triage");
  revalidatePath(`/triage/${targetId}`);
  return { ok: true, moved: { files: movedFiles, extractions: movedExtractions, matches: movedMatches } };
}

// Route a whole batch into an estate document vault. Skips the extraction
// + match_candidate paths entirely — the batch is being filed as reference
// material, not committed to a property/transfer. Written to handle
// Bronwyn's 2026-07-28 intake of Pezula Private Estate documents
// (architectural design manual, HOA rules, plant list, disturbance-area
// plans per plot) that had no obvious property home.
//
// Per file with a classified doc_type:
//   1. Skip if a document with the same normalised title + byte size is
//      already on the estate (dedupes re-forwarded batches).
//   2. Insert a `document` row bound to the estate (document.estate_id)
//      + a `document_link` (entity_type='estate') so the vault lists it.
//   3. Mark the ingest_file committed and stamp the committed_document_id.
// Then flip ingest_batch to committed + set estate_id.
export async function routeBatchToEstate(
  batchId: string,
  estateId: string,
): Promise<{ ok: boolean; error?: string; filed?: number; deduped?: number; skipped?: number }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const { data: me } = await supabase.from("app_user").select("role, active").eq("id", user.id).single();
  if (me?.role !== "admin" || me.active === false) return { ok: false, error: "admin only" };

  if (!batchId || !estateId) return { ok: false, error: "batchId and estateId required" };

  const { data: batch } = await supabase
    .from("ingest_batch")
    .select("id, status")
    .eq("id", batchId)
    .single();
  if (!batch) return { ok: false, error: "batch not found" };
  if (batch.status === "committed") return { ok: false, error: "batch already committed" };

  const { data: estate } = await supabase
    .from("estate")
    .select("id, name")
    .eq("id", estateId)
    .single();
  if (!estate) return { ok: false, error: "estate not found" };

  const { data: files } = await supabase
    .from("ingest_file")
    .select("id, original_filename, storage_bucket, storage_path, mime_type, byte_size, is_pii, detected_doc_type_id, status")
    .eq("batch_id", batchId);

  // Dedupe against docs already on the estate. Same key as commitBatch:
  // normalised filename + byte size.
  const { data: existingDocs } = await supabase
    .from("document")
    .select("id, title, byte_size")
    .eq("estate_id", estateId);
  const existingByKey = new Map<string, string>();
  for (const d of (existingDocs ?? []) as { id: string; title: string; byte_size: number | null }[]) {
    if (!d.title) continue;
    existingByKey.set(`${normaliseFilename(d.title)}::${d.byte_size ?? ""}`, d.id);
  }

  let filed = 0, deduped = 0, skipped = 0;

  for (const f of (files ?? []) as any[]) {
    // Skip unclassified files + .eml wrappers — same rule commitBatch uses.
    if (!f.detected_doc_type_id) { skipped++; continue; }
    if (f.status === "committed" || f.status === "skipped") { skipped++; continue; }
    if ((f.original_filename ?? "").toLowerCase().endsWith(".eml")) { skipped++; continue; }

    const key = `${normaliseFilename(f.original_filename)}::${f.byte_size ?? ""}`;
    const existingId = existingByKey.get(key);
    let docId: string | null = null;

    if (existingId) {
      docId = existingId;
      deduped++;
    } else {
      const { data: doc, error: docErr } = await supabase
        .from("document")
        .insert({
          doc_type_id: f.detected_doc_type_id,
          title: f.original_filename,
          storage_bucket: f.storage_bucket,
          storage_path: f.storage_path,
          mime_type: f.mime_type,
          byte_size: f.byte_size,
          is_pii: f.is_pii,
          estate_id: estateId,
          status: "final",
          uploaded_by: user.id,
        })
        .select("id")
        .single();
      if (docErr || !doc) { skipped++; continue; }
      docId = doc.id;
      existingByKey.set(key, doc.id);
      // Link table too — the vault reads document.estate_id directly, but
      // document_link keeps the "which entity owns this doc" story
      // consistent with property/transfer bindings.
      await supabase.from("document_link").insert({
        document_id: doc.id,
        entity_type: "estate",
        entity_id: estateId,
      });
      filed++;
    }

    if (docId) {
      await supabase
        .from("ingest_file")
        .update({ committed_document_id: docId, status: "committed" })
        .eq("id", f.id);
    }
  }

  await supabase
    .from("ingest_batch")
    .update({ status: "committed", estate_id: estateId })
    .eq("id", batchId);

  revalidatePath("/triage");
  revalidatePath(`/triage/${batchId}`);
  revalidatePath("/estates");
  revalidatePath(`/estates/${estateId}`);
  return { ok: true, filed, deduped, skipped };
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

// File a batch against its already-attached property without going through
// the field-extract / commit_batch RPC. Use for batches whose contents are
// filing-only (plans, photos, email correspondence) — no agreement to parse,
// so nothing to commit_batch about. Thin server-action wrapper around the
// shared helper so the intake webhook can call the same logic.
export async function fileBatchAgainstProperty(
  batchId: string,
): Promise<{ ok: boolean; error?: string; filed?: number; deduped?: number }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const result = await fileBatchAgainstPropertyWithClient(supabase, batchId, user.id);

  if (result.ok) {
    // Grab the property_id so we can revalidate the property page too.
    const { data: b } = await supabase
      .from("ingest_batch")
      .select("property_id")
      .eq("id", batchId)
      .single();
    revalidatePath(`/triage/${batchId}`);
    revalidatePath("/triage");
    if (b?.property_id) revalidatePath(`/properties/${b.property_id}`);
  }

  return result;
}

// Re-extract the batch's documents and re-commit the results to the existing
// property/transfer. Use to repair records that were committed before the
// auto-extract-at-intake shipped (or before task #28 tightened the
// registered-advance rule) so their fields now populate correctly.
//
// Because commitBatch now falls back to ingest_batch.transfer_id, this
// action reuses the existing transfer instead of spawning a duplicate.
export async function reextractAndRecommit(
  batchId: string,
): Promise<{
  ok: boolean;
  error?: string;
  extracted?: number;
  used?: string[];
  mode?: string;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  // Step 1: fresh extraction pass. Deletes prior 'proposed' rows and inserts
  // new ones; leaves 'accepted' rows in place as historical record.
  const ex = await extractBatchWithClient(supabase, batchId);
  if (!ex.ok) return { ok: false, error: ex.error ?? ex.note ?? "extract failed" };

  // Step 2: pull the fresh proposed rows and hand them to commitBatch.
  const { data: extractions } = await supabase
    .from("extraction")
    .select("target_table, target_field, entity_hint, proposed_value")
    .eq("batch_id", batchId)
    .eq("status", "proposed");
  const rows: FieldRow[] = ((extractions ?? []) as any[]).map((e) => ({
    target_table: e.target_table,
    target_field: e.target_field,
    entity_hint: e.entity_hint,
    value: e.proposed_value ?? "",
  }));

  const commitResult = await commitBatch(batchId, rows);
  if (!commitResult.ok) {
    return { ok: false, error: commitResult.error };
  }

  return {
    ok: true,
    extracted: ex.rowsInserted ?? 0,
    used: ex.used ?? [],
    mode: ex.mode,
  };
}

