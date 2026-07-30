import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { findErfCentroidByAddress } from "@/lib/external-listings/erfLookup";
import { inGardenRoute } from "@/lib/external-listings/geocode";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/sources/property24/regeocode-erf
//
// Runs the Muni ERF-lookup pipeline against EVERY external_listing row
// (Property24 primarily; can be scoped by source query param). For each
// row: parse the address, look up the erf in muni_property, pin to the
// cadastral centroid. Clears prcl_key so the snap trigger re-runs.
//
// Written to bulk-fix the historical rows already in the DB with
// wrong Mapbox-geocoded coords. Bronwyn's 29 River Club Road pinned
// on Leisure Isle (15km off from the actual Simola erf) — one pin
// per broken listing would take hours; this endpoint does the lot
// in one invocation.
//
// Query params:
//   ?dry=1        preview only, no writes
//   ?source=X     limit to source (default: property24)
//   ?limit=N      cap number of rows scanned (default 500)
//
// Auth: admin session OR CRON_SECRET bearer (same pattern as regeocode).

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

export async function POST(request: Request) {
  const gate = await authorised(request);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";
  const source = url.searchParams.get("source") ?? "property24";
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") ?? "500", 10)), 2000);

  const supabase = createServiceClient();

  const { data: rows, error } = await supabase
    .from("external_listing")
    .select("id, source_ref, address_raw, suburb, lat, lng")
    .eq("source", source)
    .eq("active", true)
    .not("address_raw", "is", null)
    .limit(limit);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const changes: {
    id: string;
    source_ref: string;
    before: { lat: number | null; lng: number | null };
    after: { lat: number; lng: number };
    matched_address: string;
    suburb: string | null;
    erf_number: string | null;
    moved_km: number;
  }[] = [];

  let scanned = 0;
  let hitErf = 0;
  let unchanged = 0;
  let noHit = 0;
  let updated = 0;

  for (const r of (rows ?? []) as any[]) {
    scanned++;
    const address = r.address_raw
      ? r.suburb
        ? `${r.address_raw}, ${r.suburb}`
        : r.address_raw
      : null;
    if (!address) { noHit++; continue; }

    const hit = await findErfCentroidByAddress(address);
    if (!hit || !inGardenRoute({ lng: hit.lng, lat: hit.lat })) { noHit++; continue; }
    hitErf++;

    const prevLat = r.lat != null ? Number(r.lat) : null;
    const prevLng = r.lng != null ? Number(r.lng) : null;
    const closeEnough =
      prevLat != null && prevLng != null &&
      Math.abs(prevLat - hit.lat) < 0.0002 &&
      Math.abs(prevLng - hit.lng) < 0.0002;
    if (closeEnough) { unchanged++; continue; }

    // Rough km delta so Simon can eyeball how far pins are moving.
    // 0.01° lat ≈ 1.1km at Knysna latitude. Not exact but useful.
    const dLat = prevLat != null ? Math.abs(hit.lat - prevLat) : 0;
    const dLng = prevLng != null ? Math.abs(hit.lng - prevLng) : 0;
    const moved_km = Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * 111 * 10) / 10;

    changes.push({
      id: r.id,
      source_ref: r.source_ref,
      before: { lat: prevLat, lng: prevLng },
      after: { lat: hit.lat, lng: hit.lng },
      matched_address: hit.matchedAddress,
      suburb: hit.suburb,
      erf_number: hit.erfNumber,
      moved_km,
    });

    if (!dry) {
      // Clear prcl_key so the snap-to-parcel trigger (0045) re-runs
      // against the new coord. Same rationale as the manual-paste and
      // per-row re-geocode paths.
      const { error: upErr } = await supabase
        .from("external_listing")
        .update({ lat: hit.lat, lng: hit.lng, prcl_key: null })
        .eq("id", r.id);
      if (!upErr) updated++;
    }
  }

  // Sort biggest movers first — the wrongest pins Simon has been
  // spotting are the ones the ERF-lookup will visibly fix.
  changes.sort((a, b) => b.moved_km - a.moved_km);

  return NextResponse.json({
    ok: true,
    scanned,
    hitErf,
    unchanged,
    noHit,
    updated: dry ? 0 : updated,
    dry,
    changeCount: changes.length,
    changes: changes.slice(0, 50),
  });
}
