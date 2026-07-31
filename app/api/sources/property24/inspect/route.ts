import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseJsonLdFields } from "@/lib/external-listings/property24";

export const runtime = "nodejs";

// GET /api/sources/property24/inspect?ref=117325992
//
// Diagnostic: dumps what the scraper sees for one P24 row so we can figure
// out why a coord or price is wrong. Returns:
//   - current DB price + coords
//   - what JSON-LD says (the canonical source of truth for both since
//     2026-07-31)
//   - what the LLM extracted (for reference — no longer trusted)
//   - the first 800 chars of markdown
//   - every "R [number]" match in the markdown, with ±80 chars of context,
//     so we can see what a listing looks like when JSON-LD is absent
//
// Admin-only. Read-only — never writes.

/* eslint-disable @typescript-eslint/no-explicit-any */

async function authorised() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "unauthorised" };
  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile.active === false) return { ok: false as const, status: 403, error: "admin only" };
  return { ok: true as const };
}

export async function GET(request: Request) {
  const gate = await authorised();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const url = new URL(request.url);
  const sourceRef = url.searchParams.get("ref");
  if (!sourceRef) return NextResponse.json({ error: "ref param required" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: row, error } = await supabase
    .from("external_listing")
    .select("id, source_ref, url, price, lat, lng, headline, raw")
    .eq("source", "property24")
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });

  const raw = row.raw as any;
  const markdown: string = (raw && typeof raw.markdown === "string") ? raw.markdown : "";
  const rawHtml: string =
    typeof raw?.rawHtml === "string" ? raw.rawHtml : typeof raw?.html === "string" ? raw.html : "";
  const jsonLd = parseJsonLdFields(rawHtml);
  const llmExtract = raw?.extract ?? null;

  const allRandOccurrences: { match: string; context: string; index: number }[] = [];
  const anyR = /R\s*[\d\s,]{3,}/g;
  for (const m of markdown.matchAll(anyR)) {
    const idx = m.index ?? 0;
    const start = Math.max(0, idx - 80);
    const end = Math.min(markdown.length, idx + m[0].length + 80);
    allRandOccurrences.push({
      match: m[0].slice(0, 40),
      context: markdown.slice(start, end).replace(/\s+/g, " "),
      index: idx,
    });
    if (allRandOccurrences.length >= 30) break;
  }

  return NextResponse.json({
    sourceRef: row.source_ref,
    url: row.url,
    headline: row.headline,
    db: {
      price: row.price != null ? Number(row.price) : null,
      lat: row.lat != null ? Number(row.lat) : null,
      lng: row.lng != null ? Number(row.lng) : null,
    },
    jsonLd,
    llmExtract,
    markdown: {
      hasMarkdown: markdown.length > 0,
      length: markdown.length,
      firstChars: markdown.slice(0, 800),
    },
    allRandOccurrences,
  });
}
