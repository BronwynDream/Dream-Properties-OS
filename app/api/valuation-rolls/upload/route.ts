import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/valuation-rolls/upload
// multipart/form-data: file (PDF), kind (full_gv|supplement),
// supplement_number (optional int), effective_period_start (optional YYYY-MM-DD),
// effective_period_end (optional YYYY-MM-DD)
//
// Admin only. Uploads the PDF to Supabase Storage bucket 'valuation-rolls'
// and creates a valuation_roll_upload row with status='uploaded'. Parsing
// runs on a separate call to /api/valuation-rolls/:id/parse so a giant
// PDF doesn't tie up the upload endpoint's wall-clock budget.

const MAX_BYTES = 20 * 1024 * 1024; // 20MB
const BUCKET = "valuation-rolls";

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const kind = (form.get("kind") ?? "").toString();
  const supplementNumberRaw = form.get("supplement_number")?.toString();
  const effectivePeriodStart = form.get("effective_period_start")?.toString() || null;
  const effectivePeriodEnd = form.get("effective_period_end")?.toString() || null;
  const notes = form.get("notes")?.toString() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file supplied" }, { status: 400 });
  }
  if (!(kind === "full_gv" || kind === "supplement")) {
    return NextResponse.json({ error: "kind must be full_gv or supplement" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too large (${file.size} > ${MAX_BYTES})` },
      { status: 400 },
    );
  }
  if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "not a PDF" }, { status: 400 });
  }

  const supplementNumber = supplementNumberRaw ? parseInt(supplementNumberRaw, 10) : null;
  if (kind === "supplement" && (supplementNumber == null || !Number.isFinite(supplementNumber))) {
    return NextResponse.json(
      { error: "supplement_number required for kind=supplement" },
      { status: 400 },
    );
  }

  // Upload to Storage under a path that includes the timestamp + original
  // filename so re-uploads don't collide.
  const service = createServiceClient();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${kind}/${stamp}_${safeName}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, buf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ error: `storage upload: ${upErr.message}` }, { status: 500 });
  }

  const { data: inserted, error: insErr } = await service
    .from("valuation_roll_upload")
    .insert({
      kind,
      supplement_number: supplementNumber,
      effective_period_start: effectivePeriodStart,
      effective_period_end: effectivePeriodEnd,
      file_ref: path,
      file_name: file.name,
      file_size_bytes: file.size,
      uploaded_by: user.id,
      notes,
      status: "uploaded",
    })
    .select("id")
    .single();
  if (insErr) {
    return NextResponse.json(
      { error: `upload row insert: ${insErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}
