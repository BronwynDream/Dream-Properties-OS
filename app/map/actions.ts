"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const MAPBOX_GEOCODE = "https://api.mapbox.com/search/geocode/v6/forward";

type GeocodeResult = { ok: boolean; geocoded?: number; failed?: number; error?: string };

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

  revalidatePath("/map");
  return { ok: true, geocoded, failed };
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
