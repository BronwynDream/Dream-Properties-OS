import { NextResponse } from "next/server";
import { recordFeedRun } from "@/lib/feeds/run";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { locateListing } from "@/lib/external-listings/locate";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/sources/property24/regeocode
//
// One-shot: re-geocode every Property24 row via Mapbox, replacing whatever
// coords Firecrawl's LLM hallucinated (Simola listings landing near
// Wilderness, etc.). Uses the same anchor + bbox logic the scraper now
// uses on new upserts. Idempotent — safe to run repeatedly.
//
// Auth: same dual-path as the refresh endpoint (CRON_SECRET bearer OR
// admin session). Wall-time budget of 240s means we process ~200 rows
// per invocation (~1s per Mapbox call). Batching + pagination if you
// need it later.

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
    if (profile?.role === "admin" && profile.active !== false) {
      return { ok: true as const };
    }
    return { ok: false as const, status: 403, error: "admin only" };
  }
  return { ok: false as const, status: 401, error: "unauthorised" };
}

export async function POST(request: Request) {
  return recordFeedRun("geocode", request, () => handlePost(request));
}

async function handlePost(request: Request) {
  const gate = await authorised(request);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const startedAt = Date.now();
  const supabase = createServiceClient();

  try {
    const { data: rows, error } = await supabase
      .from("external_listing")
      .select("id, address_raw, suburb, headline, lat, lng")
      .eq("source", "property24");
    if (error) {
      return NextResponse.json(
        { ok: false, error: `query failed: ${error.message}` },
        { status: 500 },
      );
    }

    let updated = 0;
    let centroidFallback = 0;
    let noResolution = 0;
    let scanned = 0;

    for (const row of rows ?? []) {
      if (Date.now() - startedAt > 240_000) {
        console.warn(`[property24 regeocode] wall-time budget hit at ${scanned}/${rows?.length}`);
        break;
      }
      scanned++;

      // Mapbox-only by design (no portal coordinate): this endpoint is the
      // "start again from the address" button. Same rules as everywhere
      // else — see lib/external-listings/locate.ts.
      const located = await locateListing({
        address: row.address_raw,
        suburb: row.suburb,
        headline: row.headline,
        skipErf: true,
      });
      const coord = located.coord;
      const usedCentroid = located.geocodeSource === "centroid";

      if (!coord) {
        noResolution++;
        continue;
      }

      // Setting lat/lng nulls prcl_key indirectly? Not automatically — the
      // trigger only fires when prcl_key IS null. Explicitly nullify
      // prcl_key too so the trigger re-snaps against the new coords.
      const { error: updErr } = await supabase
        .from("external_listing")
        .update({
          lat: coord.lat,
          lng: coord.lng,
          prcl_key: null,
          geocode_source: usedCentroid ? "centroid" : "exact",
        })
        .eq("id", row.id);
      if (updErr) {
        console.error(`[property24 regeocode] update ${row.id} failed: ${updErr.message}`);
        continue;
      }
      updated++;
      if (usedCentroid) centroidFallback++;
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      `[property24 regeocode] scanned=${scanned}/${rows?.length ?? 0} updated=${updated} (centroid=${centroidFallback}) noRes=${noResolution} in ${durationMs}ms`,
    );
    return NextResponse.json({
      ok: true,
      scanned,
      totalRows: rows?.length ?? 0,
      updated,
      centroidFallback,
      noResolution,
      durationMs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[property24 regeocode] unhandled:", msg);
    return NextResponse.json(
      { ok: false, error: `regeocode failed: ${msg}` },
      { status: 500 },
    );
  }
}
