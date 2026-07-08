import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLightstoneAdapter } from "@/lib/lightstone";

export const runtime = "nodejs";

// POST /api/lightstone/search
// Body: { query: string }
// Admin-gated. Calls the adapter's Property Search and returns candidates.
// Used by the take-on form: type an address → pick a match → capture propertyId.

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const query = (body.query ?? "").trim();
  if (query.length < 3) {
    return NextResponse.json(
      { error: "query must be at least 3 characters" },
      { status: 400 },
    );
  }

  const adapter = getLightstoneAdapter();
  const source: "stub" | "live" =
    process.env.LIGHTSTONE_API_BASE && process.env.LIGHTSTONE_API_KEY
      ? "live"
      : "stub";

  try {
    const candidates = await adapter.searchAddress(query);
    return NextResponse.json({ ok: true, source, candidates });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, source },
      { status: 502 },
    );
  }
}
