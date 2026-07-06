import { NextResponse } from "next/server";
import { simpleParser } from "mailparser";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Bumped from 60 → 300. Real Bronwyn emails run 5–13 MB apiece with base64
// attachments; sequential parse of a 25 MB batch was silently hitting the
// old cap. 300s is the Vercel Pro ceiling; Hobby will cap to whatever it
// allows without failing the deploy.
export const maxDuration = 300;

type FileError = { file: string; stage: string; message: string };

// Crack open .eml files: pull each attachment out as its own staging file, keep the
// email body as text. Turns "1 opaque email" into the real documents inside it.
// Failure-visible: any parse, upload, or insert error is captured per-file and
// returned to the client, and the .eml is only marked `parsed` on a successful
// end-to-end run so a retry re-processes it.
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
  const errors: FileError[] = [];
  let successfulEmails = 0;

  for (const eml of emls) {
    let succeeded = true;

    // 1. Download the .eml from staging.
    const { data: blob, error: dlErr } = await supabase.storage
      .from("staging")
      .download(eml.storage_path);
    if (dlErr || !blob) {
      errors.push({
        file: eml.original_filename,
        stage: "download",
        message: dlErr?.message ?? "download returned no blob",
      });
      continue;
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(await blob.arrayBuffer());
    } catch (e) {
      errors.push({
        file: eml.original_filename,
        stage: "read",
        message: (e as Error).message,
      });
      continue;
    }

    // 2. Parse the MIME payload.
    let parsed;
    try {
      parsed = await simpleParser(buf);
    } catch (e) {
      errors.push({
        file: eml.original_filename,
        stage: "parse",
        message: (e as Error).message.slice(0, 300),
      });
      continue;
    }

    const base = eml.original_filename.replace(/\.eml$/i, "");

    // 3. Extract attachments, skipping inline signature decoration.
    //    Correct signals for "this is inline chrome, not a real attachment":
    //    contentDisposition === 'inline' OR mailparser's `related` flag.
    //    NOT contentId alone — Outlook sets a contentId on almost every
    //    attachment (including real PDFs), so treating it as a skip signal
    //    silently drops legitimate documents. Learned this the hard way
    //    diagnosing the Bowden batch: 3 real PDFs (Lightstone, Signed Joint
    //    Mandate, Plans) all had cid set and were being lost.
    for (const att of parsed.attachments ?? []) {
      const isInline =
        (att as { contentDisposition?: string }).contentDisposition === "inline" ||
        (att as { related?: boolean }).related === true;
      const outlookAutoName = /^image\d+\.(png|jpe?g|gif|webp)$/i.test(att.filename ?? "");
      if (isInline || outlookAutoName) continue;

      const filename = att.filename || `attachment-${attachmentCount + 1}`;
      const path = `${batchId}/_unpacked/${base}/${filename}`;
      const content = att.content as Buffer;

      const { error: upErr } = await supabase.storage.from("staging").upload(path, content, {
        contentType: att.contentType || "application/octet-stream",
        upsert: true,
      });
      if (upErr) {
        errors.push({
          file: `${eml.original_filename} → ${filename}`,
          stage: "upload",
          message: upErr.message,
        });
        succeeded = false;
        continue;
      }

      const { error: insErr } = await supabase.from("ingest_file").insert({
        batch_id: batchId,
        original_filename: filename,
        storage_bucket: "staging",
        storage_path: path,
        mime_type: att.contentType || null,
        byte_size: att.size ?? content.length,
        status: "uploaded",
      });
      if (insErr) {
        errors.push({
          file: `${eml.original_filename} → ${filename}`,
          stage: "insert",
          message: insErr.message,
        });
        succeeded = false;
        continue;
      }
      attachmentCount++;
    }

    // 4. Only mark 'parsed' if we got through the attachment loop without
    //    upload/insert errors. That way a retry will reprocess partial failures.
    if (succeeded) {
      await supabase
        .from("ingest_file")
        .update({ ocr_text: (parsed.text ?? "").slice(0, 100000), status: "parsed" })
        .eq("id", eml.id);
      successfulEmails++;
    }
  }

  return NextResponse.json({
    ok: true,
    emails: successfulEmails,
    emailsAttempted: emls.length,
    attachments: attachmentCount,
    errors,
  });
}
