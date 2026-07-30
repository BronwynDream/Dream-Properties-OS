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

  // Pull active P24 rows in order of largest existing coord uncertainty
  // first — rows without prcl_key snap first (they've never been
  // parcel-verified), then oldest updates. Preserves the "biggest
  // movers first" invariant Simon has been eyeballing in the dry-run
  // preview.
  const { data: rows, error } = await supabase
    .from("external_listing")
    .select("id, source_ref, url, lat, lng")
    .eq("source", "property24")
    .eq("active", true)
    .not("url", "is", null)
    .order("prcl_key", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const changes: {
    id: string;
    source_ref: string;
    url: string;
    before: { lat: number | null; lng: number | null };
    after: { lat: number; lng: number };
    moved_km: number;
  }[] = [];

  let scanned = 0;
  let hitJsonLd = 0;
  let unchanged = 0;
  let noHit = 0;
  let updated = 0;
  const startedAt = Date.now();

  for (const r of (rows ?? []) as any[]) {
    scanned++;
    // Wall-time guard — same pattern as refresh route. Firecrawl budget
    // varies; stop 15s short of the Vercel maxDuration cap.
    if (Date.now() - startedAt > 285_000) {
      console.warn(`[regeocode-jsonld] wall-time budget exhausted after ${scanned - 1} rows`);
      break;
    }

    const listing = await scrapeListingDetail(apiKey, r.url);
    if (!listing || listing.lat == null || listing.lng == null) {
      noHit++;
      await new Promise((res) => setTimeout(res, SCRAPE_DELAY_MS));
      continue;
    }
    if (!inGardenRoute({ lng: listing.lng, lat: listing.lat })) {
      // JSON-LD coord fell outside the Garden Route bbox. Very rare;
      // probably a P24 data error. Skip — safer than pinning to
      // Antarctica.
      noHit++;
      await new Promise((res) => setTimeout(res, SCRAPE_DELAY_MS));
      continue;
    }
    hitJsonLd++;

    const prevLat = r.lat != null ? Number(r.lat) : null;
    const prevLng = r.lng != null ? Number(r.lng) : null;
    const closeEnough =
      prevLat != null && prevLng != null &&
      Math.abs(prevLat - listing.lat) < 0.0002 &&
      Math.abs(prevLng - listing.lng) < 0.0002;
    if (closeEnough) {
      unchanged++;
      await new Promise((res) => setTimeout(res, SCRAPE_DELAY_MS));
      continue;
    }

    const dLat = prevLat != null ? Math.abs(listing.lat - prevLat) : 0;
    const dLng = prevLng != null ? Math.abs(listing.lng - prevLng) : 0;
    const moved_km = Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * 111 * 10) / 10;

    changes.push({
      id: r.id,
      source_ref: r.source_ref,
      url: r.url,
      before: { lat: prevLat, lng: prevLng },
      after: { lat: listing.lat, lng: listing.lng },
      moved_km,
    });

    if (!dry) {
      const { error: upErr } = await supabase
        .from("external_listing")
        .update({ lat: listing.lat, lng: listing.lng, prcl_key: null })
        .eq("id", r.id);
      if (!upErr) updated++;
    }

    await new Promise((res) => setTimeout(res, SCRAPE_DELAY_MS));
  }

  changes.sort((a, b) => b.moved_km - a.moved_km);

  return NextResponse.json({
    ok: true,
    scanned,
    hitJsonLd,
    unchanged,
    noHit,
    updated: dry ? 0 : updated,
    dry,
    changeCount: changes.length,
    changes: changes.slice(0, 30),
    note: `Firecrawl-limited to ${limit} rows/invocation. Rerun until scanned < ${limit}.`,
  });
}
