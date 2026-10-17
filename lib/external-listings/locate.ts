// One place that decides where a listing goes on the map (2026-10-17).
//
// Before this, the Property24 scraper, the Dream-website scraper, the bulk
// re-geocode and the map's per-listing "re-geocode" button each had their
// own copy of the chain, and none of them could tell a house-level answer
// from a street-level one. Simon spotted the result: a Fernwood Estate
// house drawn on Leisure Isle, because "52 Woodbourne Dr" resolved to the
// middle of Woodbourne Drive.
//
// The chain, in order of trust:
//   1. The portal's own coordinate (Property24 JSON-LD) — unless the
//      address is hidden ("Contact agent for street address"), in which
//      case P24 ships one placeholder point for all of Knysna.
//   2. The municipal erf lookup (address → cadastral centroid).
//   3. Mapbox, house-level answers only (see geocodeAddress).
//   4. The suburb / estate centroid, stored as geocode_source='centroid'
//      and drawn as a hollow "area only" dot.
//   5. Nothing — the listing stays off the map rather than lying.

import {
  centroidForArea,
  geocodeAddress,
  inGardenRoute,
  isHiddenAddress,
  isPlaceholderCoord,
  type LngLat,
} from "./geocode";
import { findErfCentroidByAddress } from "./erfLookup";

export type LocateInput = {
  address: string | null | undefined;
  suburb?: string | null;
  headline?: string | null;
  /** The portal's own coordinate, when it published one. */
  portalCoord?: LngLat | null;
  token?: string;
  /** Skip the municipal erf lookup (it costs a database round trip). */
  skipErf?: boolean;
};

export type LocateResult = {
  coord: LngLat | null;
  geocodeSource: "exact" | "centroid";
  via: "portal" | "erf" | "mapbox" | "area" | "none";
};

export async function locateListing(i: LocateInput): Promise<LocateResult> {
  const address = (i.address ?? "").trim();
  const hidden = isHiddenAddress(address);

  if (!hidden && i.portalCoord && inGardenRoute(i.portalCoord) && !isPlaceholderCoord(i.portalCoord)) {
    return { coord: i.portalCoord, geocodeSource: "exact", via: "portal" };
  }

  if (!hidden && address.length > 2) {
    if (!i.skipErf) {
      const combined = i.suburb ? `${address}, ${i.suburb}` : address;
      const erf = await findErfCentroidByAddress(combined).catch(() => null);
      if (erf && inGardenRoute({ lng: erf.lng, lat: erf.lat })) {
        return { coord: { lng: erf.lng, lat: erf.lat }, geocodeSource: "exact", via: "erf" };
      }
    }
    const geo = await geocodeAddress(address, { suburb: i.suburb, token: i.token });
    if (geo && inGardenRoute(geo)) return { coord: geo, geocodeSource: "exact", via: "mapbox" };
  }

  const area = centroidForArea(hidden ? null : address, i.suburb, i.headline);
  if (area) return { coord: area, geocodeSource: "centroid", via: "area" };

  return { coord: null, geocodeSource: "centroid", via: "none" };
}
