import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scrapeListingDetail } from "@/lib/external-listings/property24";
import { inGardenRoute } from "@/lib/external-listings/geocode";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/sources/property24/regeocode-jsonld
//
// Bulk backfill: re-fetch every active Property24 listing detail page
// and update lat/lng from the schema.org JSON-LD block. This is the
// canonical source-of-truth — the same coords render P24's own map
// widget — so pins land where P24 puts them (correct by construction).
//
// Fixes the class of wrong-pin bugs Bronwyn kept spotting (8 Grey St
// pinned in Pezula; 29 River Club Rd pinned on Leisure Isle 15km off)
// where Mapbox and the muni-ERF lookup both failed for different
// reasons. JSON-LD covers ~all listings; the prior two-tier chain
// covered maybe 30-50%.
//
// Clears prcl_key on write so the snap-to-parcel trigger re-runs
// against the new coord (same pattern as manual-paste and per-row
// re-geocode paths).
//
// Query params:
//   ?dry=1        preview only, no writes
//   ?limit=N      cap rows scanned per invocation (default 50; Firecrawl
//                 is ~10-20s per detail scrape, Vercel Hobby caps at 60s,
//                 Pro at 300s. Multiple runs to drain the queue.)
//
// Auth: admin session OR CRON_SECRET bearer.

/* eslint-disable @typescript-eslint/no-explicit-any */

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

// Cap per-invocation. Vercel Pro maxDuration is 300s and each Firecrawl
// scrape is ~15s, so ~15 detail scrapes is the safe budget. Keep it low
// so the admin can watch progress across successive runs.
const DEFAULT_LIMIT = 15;
const SCRAPE_DELAY_MS = 1000;

export async function POST(request: Request) {
  const gate = await authorised(request);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "FIRECRAWL_API_KEY not set" }, { status: 500 });

  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";
  const limit = Math.min(
    Math.max(1, parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10)),
    50,
  );

  const supabase = createServiceClient();

  // Pull active P24 rows in order of last-attempted (nulls first =
  // never attempted). Was ordering by prcl_key nulls first, which
  // caused the drain to stall — no-hit rows never had prcl_key
  // modified, so successive clicks kept re-scanning the same batch.
  // regeocode_attempted_at is bumped on every attempt below (hit,
  // unchanged, OR no-hit) so the queue always advances. See
  // migration 0062.
  const { data: rows, error } = await supabase
    .from("external_listing")
    .select("id, source_ref, url, lat, lng, price")
    .eq("source", "property24")
    .eq("active", true)
    .not("url", "is", null)
    .order("regeocode_attempted_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const changes: {
    id: string;
    source_ref: string;
    url: string;
    before: { lat: number | null; lng: number | null; price: number | null };
    after: { lat: number | null; lng: number | null; price: number | null };
    moved_km: number;
    priceChanged: boolean;
  }[] = [];

  // Per-row failure reasons so we can diagnose why hitJsonLd < scanned.
  // First dry-run reported 2/5 hits (3 noHit with no clue why); this
  // splits the noHit bucket into scrape-failed vs no-coord-in-jsonld vs
  // coord-outside-bbox. Sample the failing URLs so the admin can eyeball
  // whether those listings really are missing JSON-LD or something else.
  const noHitReasons: Record<string, { count: number; sampleUrls: string[] }> = {
    scrape_failed: { count: 0, sampleUrls: [] },
    no_jsonld_coord: { count: 0, sampleUrls: [] },
    coord_outside_garden_route: { count: 0, sampleUrls: [] },
  };
  function recordNoHit(reason: keyof typeof noHitReasons, listingUrl: string) {
    noHitReasons[reason].count++;
    if (noHitReasons[reason].sampleUrls.length < 3) {
      noHitReasons[reason].sampleUrls.push(listingUrl);
    }
  }

  let scanned = 0;
  let hitJsonLd = 0;
  let unchanged = 0;
  let noHit = 0;
  let updated = 0;
  const startedAt = Date.now();

  // Collect ids of rows we attempted, regardless of outcome, so we can
  // bulk-bump regeocode_attempted_at at the end of the batch. Advances
  // the drain queue even when nothing was updated (hit + unchanged or
  // no-hit paths).
  const attemptedIds: string[] = [];

  for (const r of (rows ?? []) as any[]) {
    scanned++;
    // Wall-time guard — same pattern as refresh route. Firecrawl budget
    // varies; stop 15s short of the Vercel maxDuration cap.
    if (Date.now() - startedAt > 285_000) {
      console.warn(`[regeocode-jsonld] wall-time budget exhausted after ${scanned - 1} rows`);
      break;
    }
    attemptedIds.push(r.id);

    const listing = await scrapeListingDetail(apiKey, r.url);
    const prevLat = r.lat != null ? Number(r.lat) : null;
    const prevLng = r.lng != null ? Number(r.lng) : null;
    const prevPrice = r.price != null ? Number(r.price) : null;

    if (!listing) {
      // Transient Firecrawl failure — don't touch data. The attempted_at
      // bump at end-of-batch means we'll re-try later without stalling
      // the queue.
      noHit++;
      recordNoHit("scrape_failed", r.url);
      await new Promise((res) => setTimeout(res, SCRAPE_DELAY_MS));
      continue;
    }

    const coordOk =
      listing.lat != null &&
      listing.lng != null &&
      inGardenRoute({ lng: listing.lng, lat: listing.lat });

    if (!coordOk) {
      // Page loaded but no usable JSON-LD coord. As of 2026-07-31 that
      // also means we should distrust whatever price is on the row: the
      // historical value came from the removed LLM + markdown-regex
      // fallback chain (source of the listing-id-as-price bug on POR
      // pages and the size-as-price bug on the Uitzicht farm). Null it —
      // showing "Price on request" beats showing a hallucinated number.
      noHit++;
      if (listing.lat == null || listing.lng == null) {
        recordNoHit("no_jsonld_coord", r.url);
      } else {
        recordNoHit("coord_outside_garden_route", r.url);
      }
      if (!dry && prevPrice != null) {
        const { error: upErr } = await supabase
          .from("external_listing")
          .update({ price: null })
          .eq("id", r.id);
        if (!upErr) updated++;
      }
      await new Promise((res) => setTimeout(res, SCRAPE_DELAY_MS));
      continue;
    }
    hitJsonLd++;

    const coordCloseEnough =
      prevLat != null && prevLng != null &&
      Math.abs(prevLat - listing.lat!) < 0.0002 &&
      Math.abs(prevLng - listing.lng!) < 0.0002;
    const priceUnchanged = prevPrice === listing.price;

    if (coordCloseEnough && priceUnchanged) {
      unchanged++;
      await new Promise((res) => setTimeout(res, SCRAPE_DELAY_MS));
      continue;
    }

    const dLat = prevLat != null ? Math.abs(listing.lat! - prevLat) : 0;
    const dLng = prevLng != null ? Math.abs(listing.lng! - prevLng) : 0;
    const moved_km = Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * 111 * 10) / 10;

    changes.push({
      id: r.id,
      source_ref: r.source_ref,
      url: r.url,
      before: { lat: prevLat, lng: prevLng, price: prevPrice },
      after: { lat: listing.lat, lng: listing.lng, price: listing.price },
      moved_km,
      priceChanged: !priceUnchanged,
    });

    if (!dry) {
      // Full patch — coords, price, and null-out prcl_key so the snap-
      // to-parcel trigger re-runs against the new coord.
      //
      // listing.price is JSON-LD-only as of 2026-07-31 (see property24.ts
      // header). When JSON-LD didn't ship a priceCurrency:ZAR node, price
      // is null — the row displays as "Price on request" until the next
      // scrape finds one, which is more truthful than the old fallback
      // chain's hallucinations. One-shot backfill: reset
      // regeocode_attempted_at for all P24 rows, then drain, so every row
      // gets re-evaluated under the new logic.
      const patch: Record<string, unknown> = {
        lat: listing.lat,
        lng: listing.lng,
        price: listing.price,
        prcl_key: null,
      };
      const { error: upErr } = await supabase
        .from("external_listing")
        .update(patch)
        .eq("id", r.id);
      if (!upErr) updated++;
    }

    await new Promise((res) => setTimeout(res, SCRAPE_DELAY_MS));
  }

  // Advance the drain queue: bump regeocode_attempted_at on EVERY row
  // we tried this batch, regardless of whether we found coords or not.
  // Without this, the next click re-queries the same rows (see
  // migration 0062 comment for the failure story).
  if (!dry && attemptedIds.length > 0) {
    const now = new Date().toISOString();
    const { error: bumpErr } = await supabase
      .from("external_listing")
      .update({ regeocode_attempted_at: now })
      .in("id", attemptedIds);
    if (bumpErr) {
      console.error(`[regeocode-jsonld] failed to bump regeocode_attempted_at: ${bumpErr.message}`);
    }
  }

  changes.sort((a, b) => b.moved_km - a.moved_km);

  return NextResponse.json({
    ok: true,
    scanned,
    hitJsonLd,
    unchanged,
    noHit,
    noHitReasons,
    updated: dry ? 0 : updated,
    dry,
    changeCount: changes.length,
    changes: changes.slice(0, 30),
    note: `Firecrawl-limited to ${limit} rows/invocation. Rerun until scanned < ${limit}.`,
  });
}
