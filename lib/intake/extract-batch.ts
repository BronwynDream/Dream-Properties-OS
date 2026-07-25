import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  mapExtractionToRows,
  parseModelJson,
  reshapeFields,
} from "@/lib/extract";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Shared AI-extract pipeline. Reads the top-ranked deal documents in a batch
// (agreement, mandate, title deed, CMA, lightstone, etc.), runs them through
// the LLM using the SYSTEM_PROMPT + JSON_SHAPE from lib/extract.ts, and
// writes the flattened field rows into `extraction` for review or auto-commit.
//
// Client-agnostic so it runs from both /api/extract (session client) and the
// intake webhook (service-role). Also calls propose_matches after inserting
// rows so match candidates surface on the batch page immediately.
//
// LLM latency depends on doc size and mode (text vs OCR); this helper is
// intended to be awaited during a request, not fired-and-forgotten.

const TEXT_TARGETS = [
  "agreement_of_sale",
  "land_freehold_agreement",
  "offer_to_purchase",
  "fica_questionnaire",
  "company_resolution",
  "share_register",
  "cipc_form",
  "property_info",
  "lightstone_report",
  "detailed_listing",
  "cma",
  "title_deed",
  "rates_account",
  "boundary_relaxation",
  "ppra_disclosure",
  "transfer_instruction",
  "mandate",
];

const MAX_VISION_BYTES = 20 * 1024 * 1024;

async function textFromFile(filename: string, buf: Buffer): Promise<string> {
  const name = filename.toLowerCase();
  try {
    if (name.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return value ?? "";
    }
    if (name.endsWith(".pdf")) {
      const pdf = (await import("pdf-parse/lib/pdf-parse.js")).default as (
        b: Buffer,
      ) => Promise<{ text: string }>;
      const out = await pdf(buf);
      return out.text ?? "";
    }
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: any[],
  plugins?: any[],
): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://app.dreamknysna.co.za",
      "X-Title": "Dream Properties OS",
    },
    body: JSON.stringify({ model, temperature: 0, messages, ...(plugins ? { plugins } : {}) }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  return (json?.choices?.[0]?.message?.content ?? "") as string;
}

export type ExtractBatchResult = {
  ok: boolean;
  rowsInserted?: number;
  used?: string[];
  mode?: string;
  note?: string;
  error?: string;
};

export async function extractBatchWithClient(
  supabase: SupabaseClient,
  batchId: string,
  opts: { apiKey?: string; model?: string } = {},
): Promise<ExtractBatchResult> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY not configured" };
  const model = opts.model ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

  const { data: types } = await supabase
    .from("document_type")
    .select("id, code")
    .in("code", TEXT_TARGETS);
  const idToRank = new Map<string, number>();
  (types ?? []).forEach((t: any) => idToRank.set(t.id, TEXT_TARGETS.indexOf(t.code)));

  const { data: files } = await supabase
    .from("ingest_file")
    .select("id, original_filename, storage_path, detected_doc_type_id")
    .eq("batch_id", batchId);

  const candidates = (files ?? [])
    .filter((f: any) => f.detected_doc_type_id && idToRank.has(f.detected_doc_type_id))
    .sort(
      (a: any, b: any) =>
        (idToRank.get(a.detected_doc_type_id) ?? 99) -
        (idToRank.get(b.detected_doc_type_id) ?? 99),
    )
    .slice(0, 6);

  if (candidates.length === 0) {
    const anyUnclassified = (files ?? []).some((f: any) => !f.detected_doc_type_id);
    return {
      ok: false,
      note: anyUnclassified
        ? "No deal documents found. Classify the batch first."
        : "Nothing to extract — this batch has no agreements, mandates, or listings.",
    };
  }

  // Gather text from every candidate. Text-extraction-first (mammoth for docx,
  // pdf-parse for PDFs with a real text layer, utf8 for txt/eml); if that
  // yields nothing AND the file is a PDF/image under the vision cap, run
  // OCR via Mistral-through-OpenRouter. This is the key change from the
  // previous version — before, only the PRIMARY doc got OCRed, so an ERF
  // living inside an SG diagram or a scanned title deed was invisible when
  // that doc wasn't the top-ranked candidate.
  //
  // OCR is sequential per doc (avoids OpenRouter concurrency issues) and can
  // add 10–30s per scanned doc to the intake latency. Acceptable within the
  // 300s Vercel ceiling; a single batch rarely has more than 2–3 scanned docs.
  const gathered: {
    id: string;
    filename: string;
    text: string;
    source: "text" | "ocr";
  }[] = [];
  for (const f of candidates as any[]) {
    const { data: blob } = await supabase.storage.from("staging").download(f.storage_path);
    if (!blob) continue;
    const buf = Buffer.from(await blob.arrayBuffer());

    let text = await textFromFile(f.original_filename, buf);
    let source: "text" | "ocr" = "text";

    if (
      text.trim().length < 40 &&
      apiKey &&
      /\.(pdf|png|jpe?g|webp)$/i.test(f.original_filename) &&
      buf.length <= MAX_VISION_BYTES
    ) {
      try {
        const ocrText = await ocrScanViaOpenRouter(apiKey, model, f.original_filename, buf);
        if (ocrText.trim().length >= 40) {
          text = ocrText;
          source = "ocr";
        }
      } catch {
        // OCR failed for this file — skip it silently and let the others carry
        // the batch. One bad scan shouldn't fail the whole extract.
      }
    }

    if (text.trim().length >= 40) {
      await supabase
        .from("ingest_file")
        .update({ ocr_text: text.slice(0, 100000) })
        .eq("id", f.id);
      gathered.push({ id: f.id, filename: f.original_filename, text, source });
    }
  }

  if (gathered.length === 0) {
    return {
      ok: false,
      note: "No extractable text from any document (all likely scanned and OCR failed).",
    };
  }

  // Combine every doc's text into one prompt so the LLM can cross-reference
  // (e.g. ERF from the SG diagram + title deed no from the mandate + price
  // from the agreement — all in a single JSON reply).
  const combined = gathered
    .map((g) => `===== ${g.filename} =====\n${g.text}`)
    .join("\n\n");
  const primaryFileId = gathered[0].id;
  const usedFiles = gathered.map((g) => g.filename);
  const anyOcr = gathered.some((g) => g.source === "ocr");
  const allOcr = gathered.every((g) => g.source === "ocr");
  const mode = allOcr ? "ocr" : anyOcr ? "mixed" : "text";

  let modelContent = "";
  try {
    modelContent = await callOpenRouter(apiKey, model, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(combined) },
    ]);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  let rows;
  try {
    rows = mapExtractionToRows(parseModelJson(modelContent));
  } catch {
    return { ok: false, error: "Model did not return parseable JSON." };
  }

  await supabase.from("extraction").delete().eq("batch_id", batchId).eq("status", "proposed");
  if (rows.length > 0) {
    await supabase.from("extraction").insert(
      rows.map((r) => ({
        batch_id: batchId,
        source_file_id: primaryFileId,
        target_table: r.target_table,
        target_field: r.target_field,
        entity_hint: r.entity_hint,
        proposed_value: r.proposed_value,
        confidence: r.confidence,
        status: "proposed",
      })),
    );
  }

  // Advance status to 'extracted' unless the batch is already past that
  // (committed batches must stay committed — re-extract is a repair action,
  // not a state regression).
  const { data: currentBatch } = await supabase
    .from("ingest_batch")
    .select("status")
    .eq("id", batchId)
    .single();
  if (currentBatch?.status !== "committed") {
    await supabase.from("ingest_batch").update({ status: "extracted" }).eq("id", batchId);
  }

  if (rows.length > 0) {
    await supabase.rpc("propose_matches", {
      p_batch_id: batchId,
      p_fields: reshapeFields(rows),
    });
  }

  return { ok: true, rowsInserted: rows.length, used: usedFiles, mode };
}
