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

  const seenCategories = new Set<string>();
  let juristic = false;

  for (const f of files ?? []) {
    const code = classifyFilename(f.original_filename);
    const t = byCode.get(code) ?? byCode.get("other");
    if (t) {
      seenCategories.add(t.category);
      if (JURISTIC_CODES.has(code)) juristic = true;
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

  await supabase
    .from("ingest_batch")
    .update({ tier, status: "in_review" })
    .eq("id", batchId);

  revalidatePath(`/triage/${batchId}`);
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
