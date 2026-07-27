import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseFullGv } from "@/lib/valuation-rolls/parse-full-gv";
import { parseSupplement } from "@/lib/valuation-rolls/parse-supplement";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/valuation-rolls/:id/parse
// Fetches the PDF from Storage, parses it with the appropriate adapter,
// writes preview_json + parsed_row_count. Doesn't touch muni_property /
// muni_valuation — that's /apply. Idempotent: safe to re-parse.

const BUCKET = "valuation-rolls";
const PREVIEW_SAMPLE_SIZE = 20;

async function authoriseAdmin(): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "unauthorised" };
  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { ok: false, status: 403, error: "admin only" };
  return { ok: true, userId: user.id };
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
  if (!["uploaded", "parsed", "failed"].includes(upload.status)) {
    return NextResponse.json(
      { error: `cannot parse — status is ${upload.status}` },
      { status: 409 },
    );
  }

  // Mark parsing
  await service
    .from("valuation_roll_upload")
    .update({ status: "parsing", parse_error: null })
    .eq("id", upload.id);

  // Download the PDF from Storage.
  const { data: blob, error: dlErr } = await service.storage
    .from(BUCKET)
    .download(upload.file_ref);
  if (dlErr || !blob) {
    await service
      .from("valuation_roll_upload")
      .update({ status: "failed", parse_error: `download: ${dlErr?.message ?? "no blob"}` })
      .eq("id", upload.id);
    return NextResponse.json({ error: `download: ${dlErr?.message}` }, { status: 500 });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    if (upload.kind === "full_gv") {
      const result = await parseFullGv(bytes);
      const preview = {
        sample: result.rows.slice(0, PREVIEW_SAMPLE_SIZE),
        markers: result.rows.filter((r) => r.is_marker).length,
        by_town: countBy(result.rows, (r) => r.town),
      };
      await service
        .from("valuation_roll_upload")
        .update({
          status: "parsed",
          parsed_row_count: result.rows.length,
          page_count: result.pageCount,
          preview_json: preview,
        })
        .eq("id", upload.id);
      return NextResponse.json({
        ok: true,
        rows: result.rows.length,
        pages: result.pageCount,
        warnings: result.warnings.length,
      });
    } else {
      const result = await parseSupplement(bytes);
      const preview = {
        sample: result.rows.slice(0, PREVIEW_SAMPLE_SIZE),
        markers: result.rows.filter((r) => r.is_marker).length,
        by_town: countBy(result.rows, (r) => r.town),
        by_sec_78: countBy(result.rows, (r) => r.sec_78 ?? "n/a"),
      };
      await service
        .from("valuation_roll_upload")
        .update({
          status: "parsed",
          parsed_row_count: result.rows.length,
          page_count: result.pageCount,
          preview_json: preview,
        })
        .eq("id", upload.id);
      return NextResponse.json({
        ok: true,
        rows: result.rows.length,
        pages: result.pageCount,
        warnings: result.warnings.length,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await service
      .from("valuation_roll_upload")
      .update({ status: "failed", parse_error: msg })
      .eq("id", upload.id);
    return NextResponse.json({ error: `parse: ${msg}` }, { status: 500 });
  }
}

function countBy<T>(arr: T[], keyFn: (t: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const t of arr) {
    const k = keyFn(t) || "(empty)";
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}
