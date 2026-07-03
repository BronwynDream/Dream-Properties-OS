import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  mapExtractionToRows,
  parseModelJson,
  reshapeFields,
} from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

// Document types worth reading for deal fields, most valuable first.
const TEXT_TARGETS = [
  "agreement_of_sale",
  "land_freehold_agreement",
  "offer_to_purchase",
  "fica_questionnaire",
  "company_resolution",
  "share_register",
  "cipc_form",
  "property_info",
  "detailed_listing",
  "cma",
  "transfer_instruction",
  "mandate",
];

const MAX_VISION_BYTES = 20 * 1024 * 1024; // 20 MB cap for a scanned doc

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callOpenRouter(apiKey: string, model: string, messages: any[], plugins?: any[]) {
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

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not set in the environment." },
      { status: 500 },
    );
  }
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  const { batchId } = (await request.json()) as { batchId?: string };
  if (!batchId) {
    return NextResponse.json({ error: "batchId required" }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: types } = await supabase
    .from("document_type")
    .select("id, code")
    .in("code", TEXT_TARGETS);
  const idToRank = new Map<string, number>();
  (types ?? []).forEach((t) => idToRank.set(t.id, TEXT_TARGETS.indexOf(t.code)));

  const { data: files } = await supabase
    .from("ingest_file")
    .select("id, original_filename, storage_path, detected_doc_type_id")
    .eq("batch_id", batchId);

  const candidates = (files ?? [])
    .filter((f) => f.detected_doc_type_id && idToRank.has(f.detected_doc_type_id))
    .sort(
      (a, b) =>
        (idToRank.get(a.detected_doc_type_id!) ?? 99) -
        (idToRank.get(b.detected_doc_type_id!) ?? 99),
    )
    .slice(0, 6);

  if (candidates.length === 0) {
    return NextResponse.json({
      ok: false,
      note: "No deal documents found. Classify the batch first.",
    });
  }

  // Download candidates (kept in rank order), extract text where possible.
  const gathered: { id: string; filename: string; buf: Buffer; text: string }[] = [];
  for (const f of candidates) {
    const { data: blob } = await supabase.storage.from("staging").download(f.storage_path);
    if (!blob) continue;
    const buf = Buffer.from(await blob.arrayBuffer());
    const text = await textFromFile(f.original_filename, buf);
    if (text.trim().length >= 40) {
      await supabase.from("ingest_file").update({ ocr_text: text.slice(0, 100000) }).eq("id", f.id);
    }
    gathered.push({ id: f.id, filename: f.original_filename, buf, text });
  }

  const primary = gathered[0];
  const others = gathered.slice(1);
  const otherText = others
    .filter((g) => g.text.trim().length >= 40)
    .map((g) => `\n\n===== ${g.filename} =====\n${g.text}`)
    .join("");

  let modelContent = "";
  let usedFiles: string[] = [];
  let primaryFileId: string | null = null;
  let mode = "text";

  try {
    if (primary && primary.text.trim().length >= 40) {
      // TEXT PATH — highest-ranked doc is text; append other text docs as context.
      const combined = `===== ${primary.filename} =====\n${primary.text}${otherText}`;
      primaryFileId = primary.id;
      usedFiles = [primary, ...others.filter((g) => g.text.trim().length >= 40)].map((g) => g.filename);
      modelContent = await callOpenRouter(apiKey, model, [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(combined) },
      ]);
    } else if (
      primary &&
      /\.(pdf|png|jpe?g|webp)$/i.test(primary.filename) &&
      primary.buf.length <= MAX_VISION_BYTES
    ) {
      // OCR / VISION PATH — the top doc is a scan; read it, append any text context.
      const name = primary.filename.toLowerCase();
      const isPdf = name.endsWith(".pdf");
      const b64 = primary.buf.toString("base64");
      mode = isPdf ? "ocr-pdf" : "vision-image";
      primaryFileId = primary.id;
      usedFiles = [primary.filename];

      const contentPart = isPdf
        ? { type: "file", file: { filename: primary.filename, file_data: `data:application/pdf;base64,${b64}` } }
        : { type: "image_url", image_url: { url: `data:image/${name.endsWith(".png") ? "png" : "jpeg"};base64,${b64}` } };
      const plugins = isPdf ? [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }] : undefined;

      modelContent = await callOpenRouter(
        apiKey,
        model,
        [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildUserPrompt(
                  `(The primary document is attached — read it in full. Additional context from related documents:)${otherText}`,
                ),
              },
              contentPart,
            ],
          },
        ],
        plugins,
      );
    } else if (otherText.trim().length >= 40) {
      // Primary unreadable but other text docs exist — use those.
      primaryFileId = others.find((g) => g.text.trim().length >= 40)?.id ?? null;
      usedFiles = others.filter((g) => g.text.trim().length >= 40).map((g) => g.filename);
      modelContent = await callOpenRouter(apiKey, model, [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(otherText) },
      ]);
    } else {
      return NextResponse.json({
        ok: false,
        note: "Documents had no extractable text (likely scanned images). Try again — the top document may need to be a scan the OCR can read.",
      });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  let rows;
  try {
    rows = mapExtractionToRows(parseModelJson(modelContent));
  } catch {
    return NextResponse.json(
      { error: "Model did not return parseable JSON.", raw: modelContent.slice(0, 400) },
      { status: 422 },
    );
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

  await supabase.from("ingest_batch").update({ status: "extracted" }).eq("id", batchId);

  // Kick off match candidate proposal now that extraction rows exist.
  // Belt-and-braces alongside the client-side auto-propose useEffect — if the
  // client hasn't remounted since extract, propose_matches still runs.
  if (rows.length > 0) {
    await supabase.rpc("propose_matches", {
      p_batch_id: batchId,
      p_fields: reshapeFields(rows),
    });
  }

  return NextResponse.json({ ok: true, rowsInserted: rows.length, used: usedFiles, model, mode });
}
