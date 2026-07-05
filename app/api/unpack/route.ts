import { NextResponse } from "next/server";
import { simpleParser } from "mailparser";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Crack open .eml files: pull each attachment out as its own staging file, keep the
// email body as text. Turns "1 opaque email" into the real documents inside it.
export async function POST(request: Request) {
  const { batchId } = (await request.json()) as { batchId?: string };
  if (!batchId) {
    return NextResponse.json({ error: "batchId required" }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // .eml files not yet unpacked (status still 'uploaded'/'classified', not 'parsed')
  const { data: files } = await supabase
    .from("ingest_file")
    .select("id, original_filename, storage_path, status")
    .eq("batch_id", batchId);

  const emls = (files ?? []).filter(
    (f) => f.original_filename.toLowerCase().endsWith(".eml") && f.status !== "parsed",
  );

  if (emls.length === 0) {
    return NextResponse.json({ ok: true, emails: 0, attachments: 0, note: "No new .eml files to unpack." });
  }

  let attachmentCount = 0;

  for (const eml of emls) {
    const { data: blob } = await supabase.storage.from("staging").download(eml.storage_path);
    if (!blob) continue;
    const buf = Buffer.from(await blob.arrayBuffer());

    let parsed;
    try {
      parsed = await simpleParser(buf);
    } catch {
      continue;
    }

    const base = eml.original_filename.replace(/\.eml$/i, "");

    for (const att of parsed.attachments ?? []) {
      // Skip inline decoration — Bronwyn's Dream email footer + Outlook signature
      // template arrive here as attachments with contentDisposition=inline and
      // a contentId (referenced from HTML body via cid:). Both are strong signals
      // this is chrome, not content. Also skip Outlook's auto-named image00N.*
      // as belt-and-braces for clients that omit the disposition header.
      const isInline =
        (att as { contentDisposition?: string }).contentDisposition === "inline" ||
        (att as { related?: boolean }).related === true ||
        !!att.contentId;
      const outlookAutoName = /^image\d+\.(png|jpe?g|gif|webp)$/i.test(att.filename ?? "");
      if (isInline || outlookAutoName) continue;

      const filename = att.filename || `attachment-${attachmentCount + 1}`;
      const path = `${batchId}/_unpacked/${base}/${filename}`;
      const content = att.content as Buffer;
      await supabase.storage.from("staging").upload(path, content, {
        contentType: att.contentType || "application/octet-stream",
        upsert: true,
      });
      await supabase.from("ingest_file").insert({
        batch_id: batchId,
        original_filename: filename,
        storage_bucket: "staging",
        storage_path: path,
        mime_type: att.contentType || null,
        byte_size: att.size ?? content.length,
        status: "uploaded",
      });
      attachmentCount++;
    }

    // keep the email body as searchable text, mark the .eml as unpacked
    await supabase
      .from("ingest_file")
      .update({ ocr_text: (parsed.text ?? "").slice(0, 100000), status: "parsed" })
      .eq("id", eml.id);
  }

  return NextResponse.json({ ok: true, emails: emls.length, attachments: attachmentCount });
}
