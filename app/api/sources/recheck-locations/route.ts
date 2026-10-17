import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { locateListing, trustMapbox, toleranceFor } from "@/lib/external-listings/locate";
import {
  centroidForArea,
  geocodeAddress,
  isHiddenAddress,
  isPlaceholderCoord,
  kmBetween,
  namedArea,
  type LngLat,
} from "@/lib/external-listings/geocode";
import { rebuildDedupAndMatch } from "@/lib/external-listings/dedup";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/sources/recheck-locations   (admin, 2026-10-17)
//
// One-off backfill after the location rules were tightened
// (lib/external-listings/locate.ts). Deliberately conservative: the first
// dry run of a "recompute everything" version wanted to move 163 of 262
// pins, many of them good Property24 pins whose source the stored page
// can't prove. So this only touches pins that are demonstrably wrong:
//
//   a. hidden address ("Contact agent…") or P24's placeholder point
//      → the suburb / estate the listing names, area-only;
//   b. already area-only, or sitting on an OLD centroid value
//      → the corrected centroid;
//   c. sitting on Mapbox's own answer for the address (so Mapbox put it
//      there) when that answer is one we no longer trust — a street
//      centre far from the named estate, or a suburb / town point
//      → area-only (52 Woodbourne Dr → Fernwood Estate);
//   d. no coordinate at all → the full chain;
//   e. well outside the estate / suburb its own address names (further
//      than the street tolerance) → that area, area-only. Catches the
//      52 Woodbourne Dr pin whatever put it there;
//   f. no house number and no area in the "address" (Dream-website house
//      names: "Sandpoint", "Gael") → off the map; nothing places them.
//
// Hand-placed pins (geo_manual) are never touched. Everything else —
// portal pins, erf pins, trusted Mapbox pins — is left exactly as it is.
//
//   ?dry=1         report what would move; write nothing
//   ?after=<id>    resume after this id (the response's `next`)

const PAGE = 25;
const BUDGET_MS = 50_000;

// The hand-typed centroid table before 2026-10-17. A pin on one of these
// was placed by the old fallback, whatever its geocode_source says.
const OLD_CENTROIDS: LngLat[] = [
  [23.0479, -34.0363], [23.048, -34.038], [23.0453, -34.0412], [23.038, -34.045], [23.028, -34.05],
  [23.04, -34.045], [23.055, -34.038], [23.085, -34.058], [23.05, -34.025], [23.0725, -34.049],
  [23.081, -34.081], [22.976, -34.03], [23.0227, -34.08], [23.108, -34.07], [23.1, -34.055],
  [23.095, -34.055], [23.04, -33.982], [23.043, -34.048], [22.986, -34.008], [22.995, -34.018],
  [22.81, -34.025], [23.376, -34.053], [22.46, -33.963], [22.58, -33.99],
].map(([lng, lat]) => ({ lng, lat }));
const onOldCentroid = (c: LngLat) => OLD_CENTROIDS.some((o) => kmBetween(o, c) < 0.005);

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
    let done = false;

  while (Date.now() - started < BUDGET_MS) {
    let q = supabase
      .from("external_listing")
      .select("id, source, address_raw, suburb, headline, lat, lng, geocode_source, geo_manual")
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

      const prev = r.lat != null && r.lng != null ? { lat: Number(r.lat), lng: Number(r.lng) } : null;
      const area = (addr: string | null) => {
        const c = centroidForArea(addr, r.suburb, r.headline);
        return { coord: c, geocodeSource: "centroid" as const, via: c ? "area" : "none" };
      };

      let located: { coord: LngLat | null; geocodeSource: "exact" | "centroid"; via: string } | null = null;
      if (!prev) {
        located = await locateListing({ address: r.address_raw, suburb: r.suburb, headline: r.headline });          // d
      } else if (isHiddenAddress(r.address_raw) || isPlaceholderCoord(prev)) {
        located = area(null);                                                                                         // a
      } else if (r.geocode_source === "centroid" || onOldCentroid(prev)) {
        located = area(r.address_raw);                                                                               // b
      } else if (r.address_raw && !/\d/.test(r.address_raw) && !namedArea(r.address_raw, r.suburb, r.headline)) {
        located = { coord: null, geocodeSource: "centroid", via: "none" };                                           // f
      } else if (r.address_raw && (() => {
        const n = namedArea(r.address_raw, r.suburb, r.headline);
        return n != null && kmBetween(prev, n.coord) > toleranceFor(n.name);
      })()) {
        located = area(r.address_raw);                                                                               // e
      } else if (r.address_raw) {
        const geo = await geocodeAddress(r.address_raw, { suburb: r.suburb });
        // The stored pin is Mapbox's answer (allowing for the erf snap
        // having nudged it to the parcel centre) and we no longer trust it.
        if (geo && kmBetween(geo, prev) < 0.12 && !trustMapbox(geo, r.address_raw, r.suburb, r.headline)) {
          located = area(r.address_raw);                                                                             // c
        }
      }
      if (!located) {
        unchanged++;
        continue;
      }

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
    moved: moves.length,
    moves,
    ms: Date.now() - started,
  });
}
