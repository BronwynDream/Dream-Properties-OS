import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

// GET /api/sources/property24/queue-status
//
// Lightweight peek at property24_url_queue for the client-side drain loop.
// Returns pending + processed + total counts so the DrainQueueButton can
// poll progress without triggering a scrape. Cheap enough (three head
// counts) to hit every few seconds while a drain is in flight.
//
// Auth: admin session only. No cron use-case, so no bearer path.

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile.active === false) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const service = createServiceClient();
  const [pendingRes, totalRes] = await Promise.all([
    service
      .from("property24_url_queue")
      .select("*", { count: "exact", head: true })
      .is("processed_at", null),
    service
      .from("property24_url_queue")
      .select("*", { count: "exact", head: true }),
  ]);
  const pending = pendingRes.count ?? 0;
  const total = totalRes.count ?? 0;
  const processed = Math.max(0, total - pending);

  return NextResponse.json({ pending, processed, total });
}
