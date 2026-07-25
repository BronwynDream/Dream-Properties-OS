import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deepClassifyBatch } from "@/lib/classify-deep";

export const runtime = "nodejs";
export const maxDuration = 60;

// Reclassify every file in the batch currently marked 'other' (or with low
// confidence from the filename pass). Thin wrapper around deepClassifyBatch —
// same pipeline that runs at intake, just triggered on demand from the triage UI.
export async function POST(request: Request) {
  const { batchId } = (await request.json()) as { batchId?: string };
  if (!batchId) return NextResponse.json({ error: "batchId required" }, { status: 400 });

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await deepClassifyBatch(supabase, batchId);
  if (result.processed === 0) {
    return NextResponse.json({ ok: true, processed: 0, note: "Nothing to reclassify." });
  }
  return NextResponse.json({
    ok: true,
    processed: result.processed,
    changed: result.changed,
    results: result.results,
  });
}
