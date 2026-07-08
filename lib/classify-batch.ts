import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyFilename, JURISTIC_CODES } from "@/lib/classify";

// Batch classification, callable from anywhere that has a Supabase client:
//   - Server actions (session client) via app/triage/actions.ts
//   - Webhooks (service-role client) via app/api/intake/email
//
// Filename → doc_type. Sets PII from the type. Deduplicates same-name-and-size
// files. Scores the batch tier (red = juristic; green = agreement + FICA;
// amber = else). Renames a generically-labelled batch off its best-named file.
//
// Does NOT call revalidatePath — the caller decides whether that applies.

type DocType = {
  id: string;
  code: string;
  category: string;
  is_pii_default: boolean;
};

// Strip type keywords + extension from a filename to get a human batch name.
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

export async function classifyBatchWithClient(
  batchId: string,
  supabase: SupabaseClient,
): Promise<void> {
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

  for (const f of files) {
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
}
