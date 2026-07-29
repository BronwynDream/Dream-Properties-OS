import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parsePriceFromMarkdown, reconcilePrice } from "@/lib/external-listings/priceParse";

export const runtime = "nodejs";

// GET /api/sources/property24/inspect?ref=117325992
//
// Diagnostic: dumps everything the parser sees for one P24 row so we can
// figure out why a price is wrong. Returns:
//   - current DB price
//   - the LLM's extracted price (raw.extract.price)
//   - every markdown regex candidate with ±80 chars of context
//   - the reconcile decision + which source it came from
//   - a snippet showing the first 500 chars of the markdown
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
    .select("id, source_ref, url, price, headline, raw")
    .eq("source", "property24")
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: error?.message ?? "not found" }, { status: 404 });

  const raw = row.raw as any;
  const markdown: string = (raw && typeof raw.markdown === "string") ? raw.markdown : "";
  const llmPrice = raw?.extract?.price != null && Number.isFinite(Number(raw.extract.price))
    ? Math.round(Number(raw.extract.price))
    : null;

  const parsed = parsePriceFromMarkdown(markdown);
  const reconciled = reconcilePrice(llmPrice, parsed.price);

  // Collect every "R [number]" occurrence so we can see what's on the page,
  // regardless of whether the parser accepted it. Show ±80 chars of context.
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
    dbPrice: row.price != null ? Number(row.price) : null,
    llmExtractPrice: llmPrice,
    parseResult: parsed,
    reconciled,
    markdown: {
      hasMarkdown: markdown.length > 0,
      length: markdown.length,
      firstChars: markdown.slice(0, 800),
    },
    allRandOccurrences,
    // Also expose what extract mode returned so we can see what other
    // fields the LLM captured (headline, address, etc.).
    llmExtractAll: raw?.extract ?? null,
  });
}
