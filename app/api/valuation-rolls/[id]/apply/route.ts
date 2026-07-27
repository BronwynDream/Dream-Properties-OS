import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseFullGv } from "@/lib/valuation-rolls/parse-full-gv";
import { parseSupplement } from "@/lib/valuation-rolls/parse-supplement";
import { applyFullGv, applySupplement } from "@/lib/valuation-rolls/apply";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/valuation-rolls/:id/apply
// Re-parses the stored PDF (deterministic — same output as the /parse call
// that populated the preview) and upserts into muni_property + muni_valuation.
// Idempotent per apply.ts: delete-then-insert per-SG for valuations, upsert
// on sg_number for properties.

const BUCKET = "valuation-rolls";

async function authoriseAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "unauthorised" };
  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { ok: false as const, status: 403, error: "admin only" };
  return { ok: true as const, userId: user.id };
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const gate = await authoriseAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const service = createServiceClient();

  const { data: upload, error: fetchErr } = await service
    .from("valuation_roll_upload")
    .select("id, kind, file_ref, status")
    .eq("id", params.id)
    .single();
  if (fetchErr || !upload) {
    return NextResponse.json({ error: fetchErr?.message ?? "not found" }, { status: 404 });
  }
  if (upload.status !== "parsed") {
    return NextResponse.json(
      { error: `cannot apply — status is ${upload.status}; parse first` },
      { status: 409 },
    );
  }

  await service
    .from("valuation_roll_upload")
    .update({ status: "applying" })
    .eq("id", upload.id);

  const { data: blob, error: dlErr } = await service.storage.from(BUCKET).download(upload.file_ref);
  if (dlErr || !blob) {
    await service
      .from("valuation_roll_upload")
      .update({ status: "failed", parse_error: `download: ${dlErr?.message}` })
      .eq("id", upload.id);
    return NextResponse.json({ error: dlErr?.message ?? "download failed" }, { status: 500 });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());

  try {
    let result;
    if (upload.kind === "full_gv") {
      const parsed = await parseFullGv(bytes);
      result = await applyFullGv(service, parsed.rows, upload.id);
    } else {
      const parsed = await parseSupplement(bytes);
      result = await applySupplement(service, parsed.rows, upload.id);
    }

    await service
      .from("valuation_roll_upload")
      .update({
        status: result.errors.length === 0 ? "applied" : "failed",
        applied_row_count: result.valuations_inserted,
        applied_at: new Date().toISOString(),
        parse_error: result.errors.length > 0 ? result.errors.join(" · ") : null,
      })
      .eq("id", upload.id);

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await service
      .from("valuation_roll_upload")
      .update({ status: "failed", parse_error: msg })
      .eq("id", upload.id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
