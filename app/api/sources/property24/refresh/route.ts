import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  scrapeListingIndex,
  scrapeListingDetail,
} from "@/lib/external-listings/property24";

export const runtime = "nodejs";
export const maxDuration = 300;

const KNYSNA_INDEX_URL =
  "https://www.property24.com/for-sale/knysna/western-cape/468";
const DETAIL_DELAY_MS = 1000; // 1/sec; adjust after Firecrawl plan is chosen

// Cap detail scrapes per invocation. Firecrawl extract mode is ~10-20s per
// URL (JS render + LLM structured extract). Vercel Hobby caps functions at
// 60s; Pro at 300s. Even Pro can't finish 200-400 listings in one shot.
// Cap keeps every run finishing safely; subsequent runs pick up fresh URLs
// (prefer-not-yet-in-DB ordering). Full backfill happens over several runs.
const MAX_DETAILS_PER_RUN = 12;

// Time-budget guard. Once we've spent this long, stop starting new detail
// scrapes and finalise cleanly — better to return honest partial results
// than get 504'd by Vercel with an unparseable HTML response.
const MAX_WALL_MS = 240_000; // 4 min (safe for both Hobby+ and Pro).

// GET/POST /api/sources/property24/refresh
//
// Weekly Property24 scraper via Firecrawl. Two callers:
//   1. Vercel Cron — POST with Authorization: Bearer $CRON_SECRET.
//   2. Admin manual trigger — POST with an authenticated admin session.
//
// Pipeline:
//   walk paginated Knysna index → collect detail URLs → scrape each detail
//   via Firecrawl extract mode → upsert on (source='property24', source_ref)
//   → mark rows not seen in this run as active=false (sunset).
//
// POPIA: only public-listing fields are extracted; owner PII is never
// requested from the Firecrawl schema even if visible on the page.

function constantTimeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authorised(
  request: Request,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  // Cron / bearer path.
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (secret && bearer && constantTimeEq(bearer, secret)) return { ok: true };

  // Admin session fallback — lets the /map admin button trigger a manual run.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("app_user")
      .select("role, active")
      .eq("id", user.id)
      .single();
    if (profile?.role === "admin" && profile.active !== false) return { ok: true };
    return { ok: false, status: 403, error: "admin only" };
  }

  return { ok: false, status: 401, error: "unauthorised" };
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}

async function run(request: Request) {
  const gate = await authorised(request);
  if (!gate.ok)
    return NextResponse.json({ error: gate.error }, { status: gate.status });

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "FIRECRAWL_API_KEY not configured" },
      { status: 500 },
    );
  }

  const startedAt = Date.now();
  const supabase = createServiceClient();

  // Top-level try/catch. Any unhandled throw becomes a Vercel 500 HTML page,
  // which the admin button can't parse as JSON — user sees "The string did
  // not match the expected pattern" (Safari's JSON.parse error on HTML).
  // Wrap here so the button gets an actionable message.
  try {
    // 1. Discover: walk the paginated Knysna index, collect detail URLs.
    console.log("[property24] discovering listings...");
    const detailUrls = await scrapeListingIndex(apiKey, KNYSNA_INDEX_URL);
    console.log(`[property24] found ${detailUrls.length} detail URLs`);

    if (detailUrls.length === 0) {
      return NextResponse.json({
        ok: true,
        discovered: 0,
        upserted: 0,
        failed: 0,
        durationMs: Date.now() - startedAt,
        note: "No listings discovered — Firecrawl returned no links from the Knysna index. Check Firecrawl dashboard for the raw response.",
      });
    }

    // 2. Prioritise: process URLs we don't have yet before re-scraping
    //    known ones. So successive runs cover fresh ground until every
    //    listing has been ingested at least once. Extract the source_ref
    //    (numeric id from the URL) and left-anti-join against DB.
    const urlByRef: Record<string, string> = {};
    for (const u of detailUrls) {
      const m = u.match(/\/for-sale\/[^/]+\/[^/]+\/[^/]+\/(\d+)/);
      if (m) urlByRef[m[1]] = u;
    }
    const allRefs = Object.keys(urlByRef);
    const { data: existingRows } = await supabase
      .from("external_listing")
      .select("source_ref")
      .eq("source", "property24")
      .in("source_ref", allRefs);
    const existingSet = new Set((existingRows ?? []).map((r) => r.source_ref));
    const freshRefs = allRefs.filter((r) => !existingSet.has(r));
    const staleRefs = allRefs.filter((r) => existingSet.has(r));
    // Fresh first, then round-robin through stale (refreshes existing data
    // over time without starving new listings).
    const orderedRefs = [...freshRefs, ...staleRefs];
    const budget = orderedRefs.slice(0, MAX_DETAILS_PER_RUN);
    const remaining = orderedRefs.length - budget.length;
    console.log(
      `[property24] plan: ${freshRefs.length} fresh + ${staleRefs.length} stale · processing ${budget.length} this run · ${remaining} deferred`,
    );

    // 3. Scrape each detail with a polite delay between calls. Bail out
    //    early if wall time exceeds the safety budget.
    const seenSourceRefs: string[] = [];
    let ok = 0;
    let failed = 0;
    let budgetExhausted = false;
    for (const ref of budget) {
      if (Date.now() - startedAt > MAX_WALL_MS) {
        budgetExhausted = true;
        console.warn(`[property24] wall-time budget exhausted after ${ok + failed} scrapes`);
        break;
      }
      const url = urlByRef[ref];
      const listing = await scrapeListingDetail(apiKey, url);
      if (!listing) {
        failed++;
        continue;
      }
      seenSourceRefs.push(listing.sourceRef);

      const now = new Date().toISOString();
      const { error } = await supabase.from("external_listing").upsert(
        {
          source: "property24",
          source_ref: listing.sourceRef,
          url: listing.url,
          headline: listing.headline,
          address_raw: listing.addressRaw,
          suburb: listing.suburb,
          price: listing.price,
          bedrooms: listing.bedrooms,
          bathrooms: listing.bathrooms,
          property_type: listing.propertyType,
          agency_name: listing.agencyName,
          image_url: listing.imageUrl,
          lat: listing.lat,
          lng: listing.lng,
          raw: listing.raw,
          last_seen: now,
          active: true,
        },
        { onConflict: "source,source_ref" },
      );
      if (error) {
        console.error(`[property24] upsert ${listing.sourceRef} failed:`, error.message);
        failed++;
      } else {
        ok++;
      }

      await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
    }

    // 4. Sunset step is DISABLED during batched runs — we haven't seen the
    //    full catalogue this invocation, so we can't tell what's genuinely
    //    delisted from what we simply skipped. When the backlog is empty
    //    (remaining === 0 AND we processed everything), do the sunset then.
    if (remaining === 0 && !budgetExhausted && seenSourceRefs.length > 0) {
      const { error: sunsetErr } = await supabase
        .from("external_listing")
        .update({ active: false })
        .eq("source", "property24")
        .not("source_ref", "in", `(${seenSourceRefs.map((s) => `"${s}"`).join(",")})`);
      if (sunsetErr) {
        console.error("[property24] sunset failed:", sunsetErr.message);
      }
    }

    const durationMs = Date.now() - startedAt;
    console.log(`[property24] done: ok=${ok} failed=${failed} in ${durationMs}ms`);
    return NextResponse.json({
      ok: true,
      discovered: detailUrls.length,
      processedThisRun: budget.length,
      upserted: ok,
      failed,
      remaining: remaining + (budgetExhausted ? budget.length - (ok + failed) : 0),
      budgetExhausted,
      durationMs,
      note:
        remaining + (budgetExhausted ? budget.length - (ok + failed) : 0) > 0
          ? `${remaining + (budgetExhausted ? budget.length - (ok + failed) : 0)} listings still to process — click Refresh again (or wait for the next cron) to continue.`
          : "Full catalogue processed.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[property24] unhandled error:", msg, e);
    return NextResponse.json(
      { ok: false, error: `Property24 refresh failed: ${msg}` },
      { status: 500 },
    );
  }
}
