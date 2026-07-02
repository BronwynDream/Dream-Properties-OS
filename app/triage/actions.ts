"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { classifyFilename, JURISTIC_CODES } from "@/lib/classify";

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

  const { data: files } = await supabase
    .from("ingest_file")
    .select("id, original_filename")
    .eq("batch_id", batchId);

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
