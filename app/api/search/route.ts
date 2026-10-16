import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/search?q=… → the ⌘K box's results (plan 019 B1/B2).
// One RPC, run as the signed-in user so RLS decides what comes back.

export const dynamic = "force-dynamic";

export type SearchHit = {
  kind: "property" | "deal" | "person" | "draft" | "document" | "market" | "erf" | "estate";
  id: string;
  title: string;
  subtitle: string | null;
  href: string | null;
  score: number;
};

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ q, hits: [] });

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { data, error } = await supabase.rpc("search_everything", { q, per_kind: 5 });
  if (error) return NextResponse.json({ q, hits: [], error: error.message }, { status: 500 });
  return NextResponse.json({ q, hits: (data ?? []) as SearchHit[] });
}
