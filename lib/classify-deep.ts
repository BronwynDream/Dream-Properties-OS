import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyContent, CLASSIFIABLE_CODES } from "@/lib/content-classify";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Deep classification pass — content-first (text extraction + regex rules)
// with LLM fallback. Meant to catch files whose *filename* gave nothing
// away, e.g. "E105 features.docx" or "PROPERTY DESCRIPTION.docx", which
// the filename-only classifier drops to "other/30%".
//
// Runs on every file in a batch currently marked 'other' or low-confidence.
// Skips .eml wrappers (already unpacked) and images (already routed to 'photo'
// by the filename+MIME pass in lib/classify.ts).
//
// Client-agnostic: caller supplies the Supabase client, so this works from
// both service-role webhooks (intake) and session-based routes (reclassify).
//
// Returns a summary the caller can render or log.

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
    if (/\.(txt|eml|html?)$/i.test(name)) return buf.toString("utf8");
    return "";
  } catch {
    return "";
  }
}

async function ocrScanViaOpenRouter(
  apiKey: string,
  model: string,
  filename: string,
  buf: Buffer,
): Promise<string> {
  const isPdf = filename.toLowerCase().endsWith(".pdf");
  const b64 = buf.toString("base64");
  const contentPart = isPdf
    ? { type: "file", file: { filename, file_data: `data:application/pdf;base64,${b64}` } }
    : {
        type: "image_url",
        image_url: {
          url: `data:image/${filename.toLowerCase().endsWith(".png") ? "png" : "jpeg"};base64,${b64}`,
        },
      };
  const body = {
    model,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Extract the raw text from the attached document. Preserve headings and key phrases as written. Reply with just the text, no commentary.",
          },
          contentPart,
        ],
      },
    ],
    ...(isPdf ? { plugins: [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }] } : {}),
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://dreamproperties.app",
      "X-Title": "Dream Properties OS",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return "";
  const json = await res.json();
  return (json?.choices?.[0]?.message?.content ?? "") as string;
}

async function llmClassify(
  apiKey: string,
  model: string,
  text: string,
): Promise<{ code: string; confidence: number } | null> {
  const body = {
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You classify South African property documents. Reply with ONE of these codes, then a slash, then a two-digit confidence percentage. Example: "gas_coc/90". If nothing fits, reply "other/30".

Codes: ${CLASSIFIABLE_CODES.join(", ")}.`,
      },
      {
        role: "user",
        content: `Classify this document. Text (first 2000 chars):\n\n${text.slice(0, 2000)}`,
      },
    ],
  };
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://dreamproperties.app",
      "X-Title": "Dream Properties OS",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const content = String(json?.choices?.[0]?.message?.content ?? "").trim();
  const m = content.match(/^([a-z_]+)\/(\d{1,3})/i);
  if (!m) return null;
  const code = m[1];
  const conf = Math.max(0, Math.min(100, parseInt(m[2], 10))) / 100;
  if (!CLASSIFIABLE_CODES.includes(code)) return null;
  return { code, confidence: conf };
}

export type DeepClassifyResult = {
  processed: number;
  changed: number;
  results: {
    file: string;
    from: string | null;
    to: string;
    via: string;
    conf: number;
  }[];
};

export type DeepClassifyOptions = {
  apiKey?: string;         // OpenRouter API key — required for LLM/OCR fallbacks
  model?: string;          // model id, defaults to gpt-4o-mini
  allowOcr?: boolean;      // OCR scanned PDFs/images — slow, defaults true
  storageBucket?: string;  // defaults to 'staging'
};

export async function deepClassifyBatch(
  supabase: SupabaseClient,
  batchId: string,
  opts: DeepClassifyOptions = {},
): Promise<DeepClassifyResult> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  const model = opts.model ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const allowOcr = opts.allowOcr ?? true;
  const bucket = opts.storageBucket ?? "staging";

  const { data: allTypes } = await supabase
    .from("document_type")
    .select("id, code, is_pii_default");
  const byCode = new Map<string, { id: string; is_pii_default: boolean }>();
  (allTypes ?? []).forEach((t: any) =>
    byCode.set(t.code, { id: t.id, is_pii_default: t.is_pii_default }),
  );
  const otherId = byCode.get("other")?.id;
  const photoTypeId = byCode.get("photo")?.id;

  const { data: files } = await supabase
    .from("ingest_file")
    .select(
      "id, original_filename, storage_path, detected_doc_type_id, classification_confidence, byte_size, ocr_text, mime_type",
    )
    .eq("batch_id", batchId);

  const targets = (files ?? []).filter((f: any) => {
    if (f.detected_doc_type_id === otherId) return true;
    if (!f.detected_doc_type_id) return true;
    if ((f.classification_confidence ?? 1) < 0.5) return true;
    return false;
  });

  const result: DeepClassifyResult = { processed: targets.length, changed: 0, results: [] };
  if (targets.length === 0) return result;

  for (const f of targets as any[]) {
    const name: string = f.original_filename;

    if (/\.eml$/i.test(name)) continue;

    // Images: MIME/extension-first path already handles these via lib/classify.ts,
    // but re-assert here so any stragglers still land correctly.
    const isImageByExt = /\.(jpe?g|png|heic|heif|webp|tif|tiff|gif|bmp)$/i.test(name);
    const isImageByMime = f.mime_type ? /^image\//i.test(f.mime_type) : false;
    if (isImageByExt || isImageByMime) {
      if (photoTypeId && f.detected_doc_type_id !== photoTypeId) {
        await supabase
          .from("ingest_file")
          .update({
            detected_doc_type_id: photoTypeId,
            classification_confidence: 0.95,
            status: "classified",
          })
          .eq("id", f.id);
        result.changed++;
        result.results.push({
          file: name,
          from: "other",
          to: "photo",
          via: isImageByMime && !isImageByExt ? "mime" : "ext",
          conf: 0.95,
        });
      }
      continue;
    }

    let text: string = f.ocr_text ?? "";
    let via = "cache";

    if (text.length < 40) {
      const { data: blob } = await supabase.storage.from(bucket).download(f.storage_path);
      if (!blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());

      const extracted = await textFromFile(name, buf);
      if (extracted.trim().length >= 40) {
        text = extracted;
        via = "text";
      } else if (
        allowOcr &&
        apiKey &&
        /\.(pdf|png|jpe?g|webp)$/i.test(name) &&
        buf.length <= MAX_VISION_BYTES
      ) {
        text = await ocrScanViaOpenRouter(apiKey, model, name, buf);
        via = "ocr";
      }

      if (text.trim().length >= 40) {
        await supabase
          .from("ingest_file")
          .update({ ocr_text: text.slice(0, 100000) })
          .eq("id", f.id);
      }
    }

    if (text.trim().length < 40) continue;

    let hit = classifyContent(text);
    let mode = via + "+regex";
    if (!hit && apiKey) {
      const llm = await llmClassify(apiKey, model, text);
      if (llm && llm.code !== "other") {
        hit = llm;
        mode = via + "+llm";
      }
    }

    if (!hit) continue;
    const t = byCode.get(hit.code);
    if (!t) continue;

    await supabase
      .from("ingest_file")
      .update({
        detected_doc_type_id: t.id,
        is_pii: t.is_pii_default,
        classification_confidence: hit.confidence,
        status: "classified",
      })
      .eq("id", f.id);

    result.results.push({
      file: name,
      from: f.detected_doc_type_id ?? null,
      to: hit.code,
      via: mode,
      conf: hit.confidence,
    });
    result.changed++;
  }

  return result;
}
