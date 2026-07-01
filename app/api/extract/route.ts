import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  mapExtractionToRows,
  parseModelJson,
} from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

// Document types worth reading for deal fields, most valuable first.
const TEXT_TARGETS = [
  "agreement_of_sale",
  "land_freehold_agreement",
  "offer_to_purchase",
  "transfer_instruction",
  "fica_questionnaire",
];

async function textFromFile(
  filename: string,
  buf: Buffer,
): Promise<string> {
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
    // eml / txt / html and anything else — treat as text
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not set in the environment." },
      { status: 500 },
    );
  }
  const model = process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet";

  const { batchId } = (await request.json()) as { batchId?: string };
  if (!batchId) {
    return NextResponse.json({ error: "batchId required" }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Which document types are we willing to read?
  const { data: types } = await supabase
    .from("document_type")
    .select("id, code")
    .in("code", TEXT_TARGETS);
  const idToRank = new Map<string, number>();
  (types ?? []).forEach((t) =>
    idToRank.set(t.id, TEXT_TARGETS.indexOf(t.code)),
  );

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
    .slice(0, 3);

  if (candidates.length === 0) {
    return NextResponse.json({
      ok: false,
      note: "No text-readable deal documents found. Classify the batch first, or this folder's agreement may be a scanned image (vision/OCR is a later step).",
    });
  }

  // Gather text
  let combined = "";
  const used: string[] = [];
  let primaryFileId: string | null = null;
  for (const f of candidates) {
    const { data: blob } = await supabase.storage
      .from("staging")
      .download(f.storage_path);
    if (!blob) continue;
    const buf = Buffer.from(await blob.arrayBuffer());
    const text = await textFromFile(f.original_filename, buf);
    if (text.trim().length < 40) continue; // scanned / empty
    if (!primaryFileId) primaryFileId = f.id;
    combined += `\n\n===== ${f.original_filename} =====\n${text}`;
    used.push(f.original_filename);
    // stash the extracted text for audit/search
    await supabase.from("ingest_file").update({ ocr_text: text.slice(0, 100000) }).eq("id", f.id);
  }

  if (combined.trim().length < 40) {
    return NextResponse.json({
      ok: false,
      note: "Documents had no extractable text (likely scanned images). Vision/OCR extraction is a later step.",
    });
  }

  // Call OpenRouter
  let modelContent = "";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(combined) },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        { error: `OpenRouter ${res.status}: ${t.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const json = await res.json();
    modelContent = json?.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    return NextResponse.json(
      { error: `OpenRouter call failed: ${(e as Error).message}` },
      { status: 502 },
    );
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

  // Replace any prior proposals for this batch, then insert fresh
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

  return NextResponse.json({ ok: true, rowsInserted: rows.length, used, model });
}
