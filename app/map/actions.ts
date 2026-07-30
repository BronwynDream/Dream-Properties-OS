"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

import { geocodeAddress, centroidForArea, inGardenRoute } from "@/lib/external-listings/geocode";

const MAPBOX_GEOCODE = "https://api.mapbox.com/search/geocode/v6/forward";

type GeocodeResult = {
  ok: boolean;
  geocoded?: number;
  failed?: number;
  erfSnapped?: number;
  propertiesSnapped?: number;
  listingsSnapped?: number;
  error?: string;
};

// Geocode all properties that have a primary_address but no lat/lng.
// Called by the "Geocode all" button on /map. Admin-only.
export async function geocodeMissingProperties(): Promise<GeocodeResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { ok: false, error: "admin only" };

  const token = (process.env.MAPBOX_SECRET_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "").trim();
  if (!token) return { ok: false, error: "no mapbox token configured" };

  const { data: rows, error } = await supabase
    .from("property")
    .select("id, primary_address")
    .is("lng", null)
    .eq("geo_manual", false)          // never overwrite a hand-placed pin
    .not("primary_address", "is", null);
  if (error) return { ok: false, error: error.message };

  let geocoded = 0;
  let failed = 0;

  for (const p of rows ?? []) {
    const address = (p.primary_address ?? "").trim();
    if (!address || address === "Unknown address") {
      failed++;
      continue;
    }
    // Anchor searches to Knysna / Western Cape so short addresses resolve correctly.
    const q = /Knysna|South Africa|Sedgefield|Brenton|Pezula|Thesen|Simola|Belvidere/i.test(address)
      ? address
      : `${address}, Knysna, South Africa`;

    const url =
      MAPBOX_GEOCODE +
      "?" +
      new URLSearchParams({
        q,
        country: "za",
        proximity: "23.0479,-34.0363", // Knysna town centre
        limit: "1",
        access_token: token,
      });

    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        failed++;
        continue;
      }
      const json = (await res.json()) as {
        features?: { geometry?: { coordinates?: [number, number] } }[];
      };
      const coords = json.features?.[0]?.geometry?.coordinates;
      if (!coords || coords.length < 2) {
        failed++;
        continue;
      }
      const [lng, lat] = coords;
      await supabase
        .from("property")
        .update({
          lng,
          lat,
          // Populate geom too so PostGIS spatial queries stay accurate.
          // Uses PostGIS ST_SetSRID(ST_Point(...), 4326) syntax via raw SQL RPC.
          // Skipping geom sync here — 0015 doesn't add a trigger, and PostgREST
          // can't call ST_Point directly. Geom stays null until we add a helper.
        })
        .eq("id", p.id);
      geocoded++;
    } catch {
      failed++;
    }
  }

  // After geocoding, run the bulk snap-to-cadastre passes so every newly-
  // geocoded property (and every existing property/external_listing without
  // prcl_key) gets bound to its containing cadastral_parcel. Without this,
  // the plan-005 polygon layer renders as pins for anything missing prcl_key.
  //
  // Both RPCs are idempotent (they skip already-snapped rows). Combined call
  // takes seconds even against the full Knysna + George cadastre.
  let erfSnapped = 0;
  let propertiesSnapped = 0;
  let listingsSnapped = 0;
  try {
    const { data: erfData } = await supabase.rpc("snap_all_properties_by_erf");
    const erfRow = Array.isArray(erfData) ? erfData[0] : erfData;
    erfSnapped = Number(erfRow?.snapped ?? 0);

    const { data: containData } = await supabase.rpc("snap_all_to_parcels");
    const containRow = Array.isArray(containData) ? containData[0] : containData;
    propertiesSnapped = Number(containRow?.properties_snapped ?? 0);
    listingsSnapped = Number(containRow?.listings_snapped ?? 0);
  } catch (e) {
    console.error("[geocode-missing] snap RPCs failed:", (e as Error).message);
    // Non-fatal — the geocoding succeeded even if snap didn't. Row-level
    // snapping still runs via the per-erf trigger on future writes.
  }

  revalidatePath("/map");
  return { ok: true, geocoded, failed, erfSnapped, propertiesSnapped, listingsSnapped };
}

// Admin-only manual pin move — called by the "Adjust pin" control in the
// map preview panel. Setting geo_manual=true immunises the row against
// every automated geocoder from this point on: the Mapbox forward-geocode
// action above already filters it out, and the future Lightstone re-geocode
// must do the same (see 0027_property_geo_manual.sql comment).
export async function savePropertyPin(
  propertyId: string,
  lng: number,
  lat: number,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile?.active === false) {
    return { ok: false, error: "admin only" };
  }

  if (!propertyId) return { ok: false, error: "propertyId required" };
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return { ok: false, error: "invalid coordinates" };
  }

  const { error } = await supabase
    .from("property")
    .update({ lng, lat, geo_manual: true })
    .eq("id", propertyId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/map");
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true };
}

// Manually link one or more external market listings to an OS property. Used
// by the "Link to property..." button on the map's market-listing panel when
// the auto-matcher didn't catch a pair (e.g. address text differs enough that
// the address matcher missed it, or geo-proximity was outside the threshold).
//
// Admin-only. Bumps the pin/panel via revalidatePath("/map") + the specific
// property page.
export async function linkExternalListingsToProperty(
  externalIds: string[],
  propertyId: string,
): Promise<{ ok: boolean; error?: string; linked?: number }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile?.active === false) {
    return { ok: false, error: "admin only" };
  }

  if (!propertyId) return { ok: false, error: "propertyId required" };
  if (!Array.isArray(externalIds) || externalIds.length === 0) {
    return { ok: false, error: "no externalIds" };
  }

  const { error, count } = await supabase
    .from("external_listing")
    .update({ matched_property_id: propertyId }, { count: "exact" })
    .in("id", externalIds);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/map");
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true, linked: count ?? externalIds.length };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Create a fresh OS property row from an external listing (or a set of
// external listings from the same dedup group) and link them all to it.
// Used from the map's market-listing panel when the pin has no OS home
// yet AND no existing property is a plausible match — instead of
// forcing the operator to hop to a separate "new property" flow, they
// pick "Create new OS property" and land straight on the fresh record.
//
// Copies address_raw + coords + suburb (best-effort lookup by name)
// from the first external listing. Extent + title deed left blank —
// those come later from Muni / Lightstone.
export async function createPropertyFromExternalListings(
  externalIds: string[],
): Promise<{ ok: boolean; error?: string; propertyId?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const { data: me } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin" || me.active === false) {
    return { ok: false, error: "admin only" };
  }
  if (!Array.isArray(externalIds) || externalIds.length === 0) {
    return { ok: false, error: "no externalIds" };
  }

  const { data: externals } = await supabase
    .from("external_listing")
    .select("id, address_raw, headline, suburb, lat, lng")
    .in("id", externalIds);
  const rows = (externals ?? []) as any[];
  if (rows.length === 0) return { ok: false, error: "external listing(s) not found" };

  // Address candidate: prefer address_raw from any row; else headline.
  const seed = rows.find((r) => r.address_raw) ?? rows[0];
  const primaryAddress: string =
    (seed.address_raw ?? seed.headline ?? "").trim() || "Untitled market listing";
  const seedLat = rows.find((r) => r.lat != null && r.lng != null);
  const suburbName: string | null = (rows.find((r) => r.suburb)?.suburb ?? null);

  // Suburb id lookup by name — case-insensitive; null if we don't know it.
  let suburbId: string | null = null;
  if (suburbName) {
    const { data: s } = await supabase
      .from("suburb")
      .select("id")
      .ilike("name", suburbName)
      .maybeSingle();
    suburbId = (s as any)?.id ?? null;
  }

  const { data: newProp, error: insErr } = await supabase
    .from("property")
    .insert({
      primary_address: primaryAddress,
      suburb_id: suburbId,
      lat: seedLat?.lat ?? null,
      lng: seedLat?.lng ?? null,
    })
    .select("id")
    .single();
  if (insErr || !newProp) return { ok: false, error: insErr?.message ?? "insert failed" };

  // Link every external listing in the set to the new property.
  const { error: linkErr } = await supabase
    .from("external_listing")
    .update({ matched_property_id: newProp.id })
    .in("id", externalIds);
  if (linkErr) return { ok: false, error: `linked failed: ${linkErr.message}` };

  revalidatePath("/map");
  revalidatePath("/properties");
  revalidatePath(`/properties/${newProp.id}`);
  return { ok: true, propertyId: newProp.id };
}

// Manual coord override for an external listing — used when
// re-geocoding still returns a wrong answer (Mapbox result cached or
// address genuinely ambiguous). Admin pastes the real coords
// (right-click on Google Maps → copy → paste here) and the pin snaps.
export async function setExternalListingCoords(
  externalListingId: string,
  lng: number,
  lat: number,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const { data: me } = await supabase.from("app_user").select("role, active").eq("id", user.id).single();
  if (me?.role !== "admin" || me.active === false) return { ok: false, error: "admin only" };
  if (!externalListingId) return { ok: false, error: "externalListingId required" };
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { ok: false, error: "invalid lng/lat" };
  // Garden Route bbox check — refuse anything wildly off, so a typo
  // (23 vs -34, wrong sign) doesn't drop the pin in Botswana.
  if (lng < 22.5 || lng > 24.0 || lat < -34.3 || lat > -33.5) {
    return { ok: false, error: `coords out of Garden Route bbox: ${lat}, ${lng}` };
  }
  const { error } = await supabase
    .from("external_listing")
    .update({ lat, lng })
    .eq("id", externalListingId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/map");
  return { ok: true };
}

// Re-geocode a single external_listing. Used when an operator spots a
// pin visibly in the wrong place (e.g. "8 Grey St, Knysna Central"
// ending up at Pezula because Mapbox picked the wrong Grey Street).
// Same rules as the batched regeocode endpoint: bias to Knysna, verify
// result is in the Garden Route bbox, fall back to a suburb centroid if
// address geocode fails.
export async function regeocodeExternalListing(
  externalListingId: string,
): Promise<{ ok: boolean; error?: string; lng?: number; lat?: number; source?: "address" | "centroid" | "unchanged" }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const { data: me } = await supabase.from("app_user").select("role, active").eq("id", user.id).single();
  if (me?.role !== "admin" || me.active === false) return { ok: false, error: "admin only" };
  if (!externalListingId) return { ok: false, error: "externalListingId required" };

  const { data: row } = await supabase
    .from("external_listing")
    .select("id, address_raw, suburb, lat, lng")
    .eq("id", externalListingId)
    .single();
  if (!row) return { ok: false, error: "listing not found" };

  const address = ((row as any).address_raw ?? "").trim();
  const suburb = (row as any).suburb ?? null;

  let coord: { lng: number; lat: number } | null = null;
  let source: "address" | "centroid" = "address";

  if (address.length > 2) {
    const geo = await geocodeAddress(address, { suburb });
    if (geo && inGardenRoute(geo)) coord = geo;
  }
  if (!coord) {
    const centroid = centroidForArea(address, suburb);
    if (centroid) {
      coord = centroid;
      source = "centroid";
    }
  }
  if (!coord) return { ok: false, error: "geocode failed — no address, no suburb centroid" };

  const prevLat = (row as any).lat != null ? Number((row as any).lat) : null;
  const prevLng = (row as any).lng != null ? Number((row as any).lng) : null;
  const unchanged =
    prevLat != null && prevLng != null &&
    Math.abs(prevLat - coord.lat) < 0.00001 &&
    Math.abs(prevLng - coord.lng) < 0.00001;

  if (unchanged) {
    return { ok: true, lng: coord.lng, lat: coord.lat, source: "unchanged" };
  }

  const { error: updErr } = await supabase
    .from("external_listing")
    .update({ lat: coord.lat, lng: coord.lng })
    .eq("id", externalListingId);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/map");
  return { ok: true, lng: coord.lng, lat: coord.lat, source };
}
