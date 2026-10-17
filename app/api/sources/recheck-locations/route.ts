import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseJsonLdCoords } from "@/lib/external-listings/property24";
import { locateListing } from "@/lib/external-listings/locate";
import { inGardenRoute, isHiddenAddress, isPlaceholderCoord } from "@/lib/external-listings/geocode";
import { rebuildDedupAndMatch } from "@/lib/external-listings/dedup";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/sources/recheck-locations   (admin, 2026-10-17)
//
// One-off backfill after the location rules were tightened
// (lib/external-listings/locate.ts). Re-runs every active external
// listing through the shared chain using what we already have — the
// stored Property24 page (its JSON-LD coordinate), the erf lookup,
// house-level Mapbox, then the area centroid — and moves the pins that
// were wrong. Nothing is re-scraped.
//
//   ?dry=1         report what would move; write nothing
//   ?after=<id>    resume after this id (the response's `next`)
//
// Works in pages of 25 within a 50 s budget; call again with `next`
// until `done` is true. Rows whose stored coordinate already agrees
// (within ~60 m — the erf snap moves pins to the parcel centre) are left
// alone, as are pins placed by hand (geo_manual). Rows with a portal coordinate that does
// NOT match the stored page are left alone too — a person or a later
// scrape put them there, and this backfill has no better answer.

const PAGE = 25;
const BUDGET_MS = 50_000;

async function isAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("app_user").select("role, active").eq("id", user.id).single();
  return data?.role === "admin" && data.active !== false;
}

type Move = {
  id: string;
  address: string | null;
  suburb: string | null;
  from: { lat: number | null; lng: number | null; source: string };
  to: { lat: number | null; lng: number | null; source: string };
  via: string;
  km: number | null;
};

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dLat = (a.lat - b.lat) * 111;
  const dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.round(Math.sqrt(dLat * dLat + dLng * dLng) * 100) / 100;
};

export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "admin only" }, { status: 403 });

  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";
  let after = url.searchParams.get("after") ?? "";
  const started = Date.now();
  const supabase = createServiceClient();

  const moves: Move[] = [];
  let scanned = 0;
  let unchanged = 0;
  let keptPortal = 0;
  let done = false;

  while (Date.now() - started < BUDGET_MS) {
    let q = supabase
      .from("external_listing")
      .select("id, source, address_raw, suburb, headline, lat, lng, geocode_source, geo_manual, raw")
      .eq("active", true)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (after) q = q.gt("id", after);
    const { data: rows, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows || rows.length === 0) {
      done = true;
      break;
    }

    for (const r of rows) {
      if (Date.now() - started >= BUDGET_MS) break;
      after = r.id;
      scanned++;
      // A person placed this pin by hand. Never second-guess that.
      if (r.geo_manual === true) {
        unchanged++;
        continue;
      }

      let portal: { lat: number; lng: number } | null = null;
      if (r.source === "property24" && r.raw) {
        const html = typeof r.raw.rawHtml === "string" ? r.raw.rawHtml : typeof r.raw.html === "string" ? r.raw.html : "";
        if (html) portal = parseJsonLdCoords(html);
      }

      const prev = r.lat != null && r.lng != null ? { lat: Number(r.lat), lng: Number(r.lng) } : null;

      // Stored coordinate differs from the stored page's: someone (a
      // manual paste, the JSON-LD re-scrape) moved it since. Leave it.
      const portalUsable =
        portal != null && inGardenRoute(portal) && !isPlaceholderCoord(portal) && !isHiddenAddress(r.address_raw);
      if (portalUsable && prev && km(portal!, prev) > 0.06) {
        keptPortal++;
        continue;
      }

      const located = await locateListing({
        address: r.address_raw,
        suburb: r.suburb,
        headline: r.headline,
        portalCoord: portal,
      });
      const next = located.coord;
      const same =
        (prev == null && next == null) ||
        (prev != null && next != null && km(prev, next) <= 0.06 && (r.geocode_source ?? "exact") === located.geocodeSource);
      if (same) {
        unchanged++;
        continue;
      }

      moves.push({
        id: r.id,
        address: r.address_raw,
        suburb: r.suburb,
        from: { lat: prev?.lat ?? null, lng: prev?.lng ?? null, source: r.geocode_source ?? "exact" },
        to: { lat: next?.lat ?? null, lng: next?.lng ?? null, source: located.geocodeSource },
        via: located.via,
        km: prev && next ? km(prev, next) : null,
      });

      if (!dry) {
        const moved = !(prev && next && km(prev, next) <= 0.06);
        const patch: Record<string, unknown> = {
          lat: next?.lat ?? null,
          lng: next?.lng ?? null,
          geocode_source: located.geocodeSource,
        };
        // Re-snap to the erf only when the pin actually moved.
        if (moved) patch.prcl_key = null;
        const { error: upErr } = await supabase.from("external_listing").update(patch).eq("id", r.id);
        if (upErr) console.error(`[recheck-locations] ${r.id}: ${upErr.message}`);
      }
    }
    if (rows.length < PAGE && after === rows[rows.length - 1].id) {
      done = true;
      break;
    }
  }

  // Pins moved, so the "same listing on two portals" groups may have too.
  let dedup: unknown = null;
  if (done && !dry) dedup = await rebuildDedupAndMatch(supabase).catch((e) => ({ error: String(e) }));

  return NextResponse.json({
    ok: true,
    dedup,
    dry,
    done,
    next: done ? null : after,
    scanned,
    unchanged,
    keptPortal,
    moved: moves.length,
    moves,
    ms: Date.now() - started,
  });
}
