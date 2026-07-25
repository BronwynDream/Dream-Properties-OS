import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractBatchWithClient } from "@/lib/intake/extract-batch";

export const runtime = "nodejs";
export const maxDuration = 60;

// Thin wrapper around extractBatchWithClient — same pipeline that runs
// automatically at intake, exposed here for the Extract fields (AI) button
// on the triage batch page (re-runs on user demand).
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

  const result = await extractBatchWithClient(supabase, batchId);
  if (!result.ok) {
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: false, note: result.note });
  }
  return NextResponse.json({
    ok: true,
    rowsInserted: result.rowsInserted ?? 0,
    used: result.used ?? [],
    mode: result.mode,
  });
}
