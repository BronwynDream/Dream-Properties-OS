import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  scrapeListingIndex,
  scrapeListingDetail,
} from "@/lib/external-listings/property24";
import {
  geocodeAddress,
  centroidForArea,
  inGardenRoute,
} from "@/lib/external-listings/geocode";

export const runtime = "nodejs";
export const maxDuration = 300;

// Property24's canonical area URL for Knysna. The area code is 322 (verified
// 2026-07-26 by browsing the canonical redirect). Do NOT change to 468 —
// that redirects to Beaufort West and quietly returns wrong-town listings.
const KNYSNA_INDEX_URL =
  "https://www.property24.com/for-sale/knysna/western-cape/322";
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
    // 1. Discovery gate: only walk the P24 index when the queue is empty.
    //    Discovery is 100-200s per run (5-10s per index page × 5-20 pages);
    //    doing it every time leaves no budget for detail scrapes. The queue
    //    persists across invocations, so re-runs just drain pending URLs.
    let discoveredThisRun = 0;
    const { count: pendingCount } = await supabase
      .from("property24_url_queue")
      .select("*", { count: "exact", head: true })
      .is("processed_at", null);

    if ((pendingCount ?? 0) === 0) {
      console.log("[property24] queue empty — running full index discovery");
      const detailUrls = await scrapeListingIndex(apiKey, KNYSNA_INDEX_URL);
      console.log(`[property24] discovered ${detailUrls.length} URLs`);
      if (detailUrls.length > 0) {
        const rows = detailUrls.map((url) => ({ url }));
        const { error: enqueueErr } = await supabase
          .from("property24_url_queue")
          .upsert(rows, { onConflict: "url", ignoreDuplicates: true });
        if (enqueueErr) {
          console.error(`[property24] enqueue failed: ${enqueueErr.message}`);
        }
        discoveredThisRun = detailUrls.length;
      }
    } else {
      console.log(`[property24] queue has ${pendingCount} pending URLs — skipping discovery`);
    }

    // 2. Drain: take the next N pending URLs from the queue (FIFO). Cap by
    //    MAX_DETAILS_PER_RUN. If we still have wall-time budget, we scrape
    //    each and mark processed. Any URL we couldn't process this run
    //    stays pending for the next invocation.
    const remainingBudgetMs = MAX_WALL_MS - (Date.now() - startedAt);
    // Rough estimate: 20s per detail scrape + 1s delay. Cap batch by
    // whichever is smaller: MAX_DETAILS_PER_RUN or the wall-time budget.
    const timeCappedBudget = Math.max(0, Math.floor(remainingBudgetMs / 21_000));
    const batchSize = Math.min(MAX_DETAILS_PER_RUN, timeCappedBudget);

    let pendingRows: { url: string }[] = [];
    if (batchSize > 0) {
      const { data } = await supabase
        .from("property24_url_queue")
        .select("url")
        .is("processed_at", null)
        .order("discovered_at", { ascending: true })
        .limit(batchSize);
      pendingRows = (data ?? []) as { url: string }[];
    }

    console.log(
      `[property24] drain: batch=${batchSize} available=${pendingRows.length} discoveredThisRun=${discoveredThisRun}`,
    );

    let ok = 0;
    let failed = 0;
    let budgetExhausted = false;

    for (const { url } of pendingRows) {
      if (Date.now() - startedAt > MAX_WALL_MS) {
        budgetExhausted = true;
        console.warn(`[property24] wall-time budget exhausted after ${ok + failed} scrapes`);
        break;
      }
      const listing = await scrapeListingDetail(apiKey, url);
      if (!listing) {
        // Mark processed anyway so we don't retry forever — a broken URL
        // stays broken. If this becomes a maintenance concern we can add
        // a retry_count column later.
        await supabase
          .from("property24_url_queue")
          .update({ processed_at: new Date().toISOString() })
          .eq("url", url);
        failed++;
        continue;
      }

      // Geocode via Mapbox (P24 doesn't expose reliable coords; Firecrawl
      // LLM extract hallucinates them). Fall back to suburb centroid if
      // geocoding fails or drifts outside the Garden Route bbox.
      let coord: { lng: number; lat: number } | null = null;
      if (listing.addressRaw) {
        const geo = await geocodeAddress(listing.addressRaw, {
          suburb: listing.suburb,
        });
        if (geo && inGardenRoute(geo)) coord = geo;
      }
      if (!coord) {
        const centroid = centroidForArea(listing.addressRaw, listing.suburb);
        if (centroid) coord = centroid;
      }

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
          lat: coord?.lat ?? null,
          lng: coord?.lng ?? null,
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
        await supabase
          .from("property24_url_queue")
          .update({ processed_at: now })
          .eq("url", url);
      }

      await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
    }

    // Count remaining pending URLs for the response note.
    const { count: stillPending } = await supabase
      .from("property24_url_queue")
      .select("*", { count: "exact", head: true })
      .is("processed_at", null);
    const remaining = stillPending ?? 0;

    // Sunset step deferred — with the queue model, we'd need to know when
    // a full discovery-plus-drain cycle completed to safely mark unseen
    // rows inactive. Track that in a future iteration; for now stale rows
    // just sit as active until the next discovery re-observes (or doesn't)
    // them. Low-cost oversight at Dream's scale.

    const durationMs = Date.now() - startedAt;
    console.log(
      `[property24] done: discoveredThisRun=${discoveredThisRun} upserted=${ok} failed=${failed} remaining=${remaining} in ${durationMs}ms`,
    );
    return NextResponse.json({
      ok: true,
      discoveredThisRun,
      processedThisRun: pendingRows.length,
      upserted: ok,
      failed,
      remaining,
      budgetExhausted,
      durationMs,
      note:
        remaining > 0
          ? `${remaining} listings still queued — click Refresh again to continue.`
          : discoveredThisRun > 0
          ? "Full catalogue discovered and processed."
          : "Queue empty — nothing new to process.",
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
