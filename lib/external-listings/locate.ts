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
//   3. Mapbox. A house-level answer is taken. A street-level answer (the
//      usual case — Mapbox rarely knows Knysna house numbers) is taken
//      unless the listing names an estate or suburb more than 1.2 km
//      away: that's the "middle of Woodbourne Drive" failure. Suburb- or
//      town-level answers are not taken.
//   4. The suburb / estate centroid, stored as geocode_source='centroid'
//      and drawn as a hollow "area only" dot.
//   5. Nothing — the listing stays off the map rather than lying.

import {
  centroidForArea,
  geocodeAddress,
  namedArea,
  inGardenRoute,
  isHiddenAddress,
  isPlaceholderCoord,
  kmBetween,
  type DetailedGeocode,
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
    if (geo && inGardenRoute(geo) && trustMapbox(geo, address, i.suburb, i.headline)) {
      return { coord: { lng: geo.lng, lat: geo.lat }, geocodeSource: "exact", via: "mapbox" };
    }
  }

  const area = centroidForArea(hidden ? null : address, i.suburb, i.headline);
  if (area) return { coord: area, geocodeSource: "centroid", via: "area" };

  return { coord: null, geocodeSource: "centroid", via: "none" };
}

/** Street-level answers further than this from the centre of the estate /
 *  suburb the listing names are the wrong place. Big estates and spread-out
 *  areas get more room. */
export const STREET_TOLERANCE_KM = 1.2;
const WIDE_AREAS = /^(Pezula|Pezula Golf Estate|Pezula Private Estate|Simola|Brenton on Sea|Brenton-on-Sea|Brenton on Lake|Belvidere|Belvedere|Belvidere Estate|Belvedere Estate|Welbedacht|Eastford|Rheenendal|Sedgefield|Plettenberg Bay|Plett|George|Wilderness|Centreville)$/i;
const WIDE_TOLERANCE_KM = 2.5;

export function trustMapbox(
  geo: DetailedGeocode,
  address: string | null | undefined,
  suburb: string | null | undefined,
  headline: string | null | undefined,
): boolean {
  if (geo.level === "house") return true;
  if (geo.level === "area") return false;
  const named = namedArea(address, suburb, headline);
  if (!named) return true;
  const tol = WIDE_AREAS.test(named.name) ? WIDE_TOLERANCE_KM : STREET_TOLERANCE_KM;
  return kmBetween(geo, named.coord) <= tol;
}
