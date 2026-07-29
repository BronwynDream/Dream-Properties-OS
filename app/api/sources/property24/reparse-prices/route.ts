import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parsePriceFromMarkdown, reconcilePrice } from "@/lib/external-listings/priceParse";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/sources/property24/reparse-prices
//
// One-shot: re-derive price from the STORED raw Firecrawl markdown for
// every external_listing row where the current price looks suspicious
// (below R 100 000 in Knysna = extraction error). No re-scraping —
// pure client-side re-parse against the raw JSON we already have.
//
// Written to fix the 2026-07-29 discovery: P24 listing 117345816
// (36 Glen View Road, R 9 500 000) had been stored as R 693 because
// the LLM extract picked up an erf number instead of the price.
// The new parsePriceFromMarkdown / reconcilePrice pair now runs
// on all future scrapes; this endpoint fixes historical data.
//
// Query params:
//   ?dry=1   → don't write, just return what would change
//   ?all=1   → re-parse EVERY row (not just suspicious ones)
//
// Auth: same dual-path as regeocode (CRON_SECRET bearer OR admin session).

const SUSPECT_FLOOR = 100_000;

function constantTimeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authorised(request: Request) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (secret && bearer && constantTimeEq(bearer, secret)) return { ok: true as const };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("app_user")
      .select("role, active")
      .eq("id", user.id)
      .single();
    if (profile?.role === "admin" && profile.active !== false) return { ok: true as const };
    return { ok: false as const, status: 403, error: "admin only" };
  }
  return { ok: false as const, status: 401, error: "unauthorised" };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(request: Request) {
  const gate = await authorised(request);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";
  const all = url.searchParams.get("all") === "1";

  const supabase = createServiceClient();
  let q = supabase.from("external_listing").select("id, source_ref, price, raw").eq("source", "property24");
  if (!all) q = q.or(`price.is.null,price.lt.${SUSPECT_FLOOR}`);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const changes: { id: string; source_ref: string; before: number | null; after: number | null; source: string | null }[] = [];
  let updated = 0;
  let unchanged = 0;
  let noMarkdown = 0;
  let noExtract = 0;

  for (const row of rows ?? []) {
    const raw = (row as any).raw;
    const md = (raw && typeof raw.markdown === "string") ? raw.markdown : "";
    if (!md) {
      noMarkdown++;
      continue;
    }
    const llmVal = raw?.extract?.price != null && Number.isFinite(Number(raw.extract.price))
      ? Math.round(Number(raw.extract.price))
      : null;
    const md_ = parsePriceFromMarkdown(md);
    const reconciled = reconcilePrice(llmVal, md_.price);
    if (reconciled.price == null) {
      noExtract++;
      continue;
    }
    if (reconciled.price === row.price) {
      unchanged++;
      continue;
    }
    changes.push({
      id: row.id as string,
      source_ref: row.source_ref as string,
      before: row.price != null ? Number(row.price) : null,
      after: reconciled.price,
      source: reconciled.source,
    });
    if (!dry) {
      const { error: upErr } = await supabase.from("external_listing").update({ price: reconciled.price }).eq("id", row.id);
      if (!upErr) updated++;
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: rows?.length ?? 0,
    updated: dry ? 0 : updated,
    dry,
    unchanged,
    noMarkdown,
    noExtract,
    changes: changes.slice(0, 100), // return first 100 for spot-check
    changeCount: changes.length,
  });
}
