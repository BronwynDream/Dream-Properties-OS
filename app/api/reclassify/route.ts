import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyContent, CLASSIFIABLE_CODES } from "@/lib/content-classify";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_VISION_BYTES = 20 * 1024 * 1024;

// Local copy of the text extractor from /api/extract — kept small and dependency-free.
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

// Reclassify every file in the batch currently marked 'other' (or with low
// confidence from the filename pass). Doesn't touch anything else, so manual
// setFileType corrections are safe.
export async function POST(request: Request) {
  const { batchId } = (await request.json()) as { batchId?: string };
  if (!batchId) return NextResponse.json({ error: "batchId required" }, { status: 400 });

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  // Resolve 'other' code id + a full label lookup so we can update by code name.
  const { data: allTypes } = await supabase
    .from("document_type")
    .select("id, code, is_pii_default");
  const byCode = new Map<string, { id: string; is_pii_default: boolean }>();
  (allTypes ?? []).forEach((t) => byCode.set(t.code, { id: t.id, is_pii_default: t.is_pii_default }));
  const otherId = byCode.get("other")?.id;

  // Target: 'other' + anything below 0.5 confidence. Skip already-strong classifications.
  const { data: files } = await supabase
    .from("ingest_file")
    .select(
      "id, original_filename, storage_path, detected_doc_type_id, classification_confidence, byte_size, ocr_text",
    )
    .eq("batch_id", batchId);

  const targets = (files ?? []).filter((f) => {
    if (f.detected_doc_type_id === otherId) return true;
    if (!f.detected_doc_type_id) return true;
    if ((f.classification_confidence ?? 1) < 0.5) return true;
    return false;
  });

  if (targets.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, note: "Nothing to reclassify." });
  }

  let changed = 0;
  const results: { file: string; from: string | null; to: string; via: string; conf: number }[] = [];

  for (const f of targets) {
    const name = f.original_filename;

    // Skip photos and .eml wrappers — the filename classifier handles those.
    if (/\.(jpe?g|png|heic|heif|webp|tif|tiff|gif|bmp|eml)$/i.test(name)) continue;

    // Text-first: use cached OCR if we have it, else read the file.
    let text = f.ocr_text ?? "";
    let via = "cache";

    if (text.length < 40) {
      const { data: blob } = await supabase.storage.from("staging").download(f.storage_path);
      if (!blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());

      const extracted = await textFromFile(name, buf);
      if (extracted.trim().length >= 40) {
        text = extracted;
        via = "text";
      } else if (
        apiKey &&
        /\.(pdf|png|jpe?g|webp)$/i.test(name) &&
        buf.length <= MAX_VISION_BYTES
      ) {
        // Scan → OCR via OpenRouter file-parser (same path /api/extract uses).
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

    // Regex first — cheap. LLM fallback for anything the regex misses.
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

    results.push({
      file: name,
      from: f.detected_doc_type_id ?? null,
      to: hit.code,
      via: mode,
      conf: hit.confidence,
    });
    changed++;
  }

  return NextResponse.json({ ok: true, processed: targets.length, changed, results });
}
