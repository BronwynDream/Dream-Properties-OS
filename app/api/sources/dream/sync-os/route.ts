import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncWebsiteToOs } from "@/lib/dream/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/sources/dream/sync-os[?dry=1]   (admin)
//
// Turns the saved Dream website listings into Dream OS properties,
// listings and agents (lib/dream/sync.ts). Run the Dream website feed
// first so the saved rows carry their index card and agents. ?dry=1
// reports what would happen and writes nothing. After the first real run
// the nightly website feed keeps it in step on its own.

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { data: me } = await supabase.from("app_user").select("role, active").eq("id", user.id).single();
  if (me?.role !== "admin" || me.active === false) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  try {
    const report = await syncWebsiteToOs(createServiceClient(), { dry });
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
