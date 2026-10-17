// Mapbox forward geocoding for scraped external listings. Anchored to the
// Garden Route so Mapbox can't drift a "Centreville" or "Owl Street" listing
// to another province — and every result is bounding-box-guarded on top so a
// silent misresolve to Cape Town / Gqeberha / Durban never lands on the map.
//
// Kept small and pure so the scraper (which counts out-of-area rejects as
// "parked") and the map's geocoder button can both call it.

const MAPBOX_GEOCODE = "https://api.mapbox.com/search/geocode/v6/forward";

// Address contains any of these → already anchored, don't append. Widened
// beyond Knysna itself so a "26 Brenton Hotel" or "Sedgefield main road"
// keeps its own subarea instead of being tail-labelled Knysna.
const GARDEN_ROUTE_ANCHOR =
  /Knysna|Sedgefield|Wilderness|George|Plettenberg|Plett|Brenton|Pezula|Thesen|Simola|Belvidere|Leisure\s+Isle|The\s+Heads|Eastford|Centreville|Sparrebosch|Old\s+Place|Rexford|Hunters\s+Home|Knysna\s+Heights|Western\s+Cape|South\s+Africa/i;

export type LngLat = { lng: number; lat: number };

// Garden Route bounding box — George in the west (~22.30, ~-33.65) through
// Plettenberg Bay in the east (~23.60, ~-34.20), with an inland buffer north
// of the N2. Rejects Cape Town (~18.4), Gqeberha (~25.6), and every other
// misresolve target we'd realistically see from a WordPress-scraped address.
export const GARDEN_ROUTE_BBOX = {
  minLng: 22.3,
  maxLng: 23.6,
  minLat: -34.2,
  maxLat: -33.65,
};

export function inGardenRoute(coords: LngLat): boolean {
  return (
    coords.lng >= GARDEN_ROUTE_BBOX.minLng &&
    coords.lng <= GARDEN_ROUTE_BBOX.maxLng &&
    coords.lat >= GARDEN_ROUTE_BBOX.minLat &&
    coords.lat <= GARDEN_ROUTE_BBOX.maxLat
  );
}

// Area centroids: where a listing goes when we only know its suburb or
// estate. Re-verified 2026-10-17 against Google's own suburb / estate
// points (the earlier hand-typed table had Leisure Isle 2.5 km off in the
// lagoon and Fernwood 2 km off near Sparrebosch). A pin placed here is
// stored with geocode_source = 'centroid' and drawn as a hollow "area
// only" dot, so it never claims to be the house.
//
// Matching is longest-name-first (so "Pezula Private Estate" beats
// "Pezula", "Knysna Heights" beats "Knysna"), across the address, the
// headline ("4 Bedroom House for Sale in Fernwood Estate") and the
// suburb. The bare town "Knysna" is the last resort. "Knysna Rural" has
// no centroid on purpose: a farm somewhere in the district is not in town.
export const GARDEN_ROUTE_CENTROIDS: Record<string, LngLat> = {
  "Knysna":                   { lng: 23.0465, lat: -34.0351 },
  "Knysna Central":           { lng: 23.0503, lat: -34.0396 },
  "Knysna Quays":             { lng: 23.0450, lat: -34.0406 },
  "Knysna Heights":           { lng: 23.0302, lat: -34.0311 },
  "Knysna Lifestyle Estate":  { lng: 23.0140, lat: -34.0275 },
  "Hunters Home":             { lng: 23.0801, lat: -34.0575 },
  "Hunters Estate":           { lng: 23.0783, lat: -34.0527 },
  "Old Place":                { lng: 23.0712, lat: -34.0382 },
  "Paradise":                 { lng: 23.0355, lat: -34.0347 },
  "Rexford":                  { lng: 23.0779, lat: -34.0639 },
  "Welbedacht Estate":        { lng: 23.0188, lat: -34.0371 },
  "Welbedacht":               { lng: 23.0118, lat: -34.0298 },
  "Hudson Heights":           { lng: 23.050,  lat: -34.025  },
  "Leisure Isle":             { lng: 23.0597, lat: -34.0675 },
  "Leisure Island":           { lng: 23.0597, lat: -34.0675 },
  "The Heads":                { lng: 23.0623, lat: -34.0768 },
  "Belvidere Estate":         { lng: 22.9967, lat: -34.0449 },
  "Belvedere Estate":         { lng: 22.9967, lat: -34.0449 },
  "Belvidere":                { lng: 22.9967, lat: -34.0449 },
  "Belvedere":                { lng: 22.9967, lat: -34.0449 },
  "Brenton on Sea":           { lng: 23.0252, lat: -34.0714 },
  "Brenton-on-Sea":           { lng: 23.0252, lat: -34.0714 },
  "Brenton on Lake":          { lng: 23.0291, lat: -34.0604 },
  "Pezula Private Estate":    { lng: 23.1060, lat: -34.0656 },
  "Pezula Golf Estate":       { lng: 23.0877, lat: -34.0721 },
  "Pezula":                   { lng: 23.0877, lat: -34.0721 },
  "Sparrebosch":              { lng: 23.0935, lat: -34.0720 },
  "Fernwood Estate":          { lng: 23.0824, lat: -34.0696 },
  "Fernwood":                 { lng: 23.0824, lat: -34.0696 },
  "Simola":                   { lng: 23.0303, lat: -34.0040 },
  "Thesen Islands":           { lng: 23.0535, lat: -34.0487 },
  "Thesen Island":            { lng: 23.0535, lat: -34.0487 },
  "Thesen":                   { lng: 23.0535, lat: -34.0487 },
  "Eastford Country Estate":  { lng: 23.0202, lat: -34.0182 },
  "Eastford Downs":           { lng: 23.0127, lat: -34.0188 },
  "Eastford Glen":            { lng: 23.0286, lat: -34.0198 },
  "Eastford Vale":            { lng: 23.0286, lat: -34.0199 },
  "Eastford":                 { lng: 23.0220, lat: -34.0328 },
  "Estuary Heights":          { lng: 23.0185, lat: -34.0325 },
  "Westford Bridge":          { lng: 22.9872, lat: -34.0203 },
  "Costa Sarda":              { lng: 23.0600, lat: -34.0358 },
  // The River Club's own road: "River Club Road" listings are often
  // labelled Simola by agents, but the club is off Sun Valley Drive.
  "Knysna River Club":        { lng: 23.0622, lat: -34.0386 },
  "River Club Road":          { lng: 23.0622, lat: -34.0386 },
  "River Club":               { lng: 23.0622, lat: -34.0386 },
  "Fisher Haven":             { lng: 23.0771, lat: -34.0502 },
  "Green Pastures":           { lng: 23.0357, lat: -34.0219 },
  "Greenfields":              { lng: 23.0674, lat: -34.0311 },
  "Heuwelkruin":              { lng: 23.0377, lat: -34.0309 },
  "Hornlee West":             { lng: 23.0935, lat: -34.0509 },
  "Hornlee":                  { lng: 23.0935, lat: -34.0509 },
  "Kanonkop":                 { lng: 23.0213, lat: -34.0355 },
  "Lelieskloof":              { lng: 23.0500, lat: -34.0286 },
  "Narnia":                   { lng: 23.0202, lat: -34.0335 },
  "Blaricum Heights":         { lng: 23.0562, lat: -34.0082 },
  "Tides End":                { lng: 23.0640, lat: -34.0388 },
  "Rheenendal":               { lng: 22.9344, lat: -33.9491 },
  "Centreville":              { lng: 22.995,  lat: -34.018  },
  "Sedgefield":               { lng: 22.8152, lat: -34.0185 },
  "Plettenberg Bay":          { lng: 23.3714, lat: -34.0620 },
  "Plett":                    { lng: 23.3714, lat: -34.0620 },
  "George":                   { lng: 22.46,   lat: -33.963  },
  "Wilderness":               { lng: 22.58,   lat: -33.99   },
};

// Names that must never fall through to the town centre.
const NO_CENTROID = /\bKnysna\s+Rural\b/i;

const CENTROID_NAMES = Object.keys(GARDEN_ROUTE_CENTROIDS)
  .filter((n) => n !== "Knysna")
  .sort((a, b) => b.length - a.length);

// "Belvidere Street, Hornlee" is in Hornlee, not Belvidere: a name followed
// by a street word is a street, not the area.
const STREET_WORD = "(?:street|st|road|rd|drive|dr|avenue|ave|lane|ln|close|cl|crescent|cres|way|place|pl)\\b";
function nameRe(name: string): RegExp {
  return new RegExp(`\\b${name.replace(/[-\s]+/g, "[-\\s]+")}\\b(?![\\s.]+${STREET_WORD})`, "i");
}

/** The most specific estate / suburb a listing names, if any. */
export function namedArea(
  address: string | null | undefined,
  suburb: string | null | undefined,
  headline?: string | null,
): { name: string; coord: LngLat } | null {
  const texts = [address, headline, suburb].filter((t): t is string => !!t && t.trim().length > 0);
  for (const t of texts) {
    for (const name of CENTROID_NAMES) {
      if (nameRe(name).test(t)) return { name, coord: GARDEN_ROUTE_CENTROIDS[name] };
    }
  }
  return null;
}

/** Where a listing goes when all we know is its area. Specific estates and
 *  suburbs first (address, then headline, then suburb), the town last. */
export function centroidForArea(
  address: string | null | undefined,
  suburb: string | null | undefined,
  headline?: string | null,
  opts?: { specificOnly?: boolean },
): LngLat | null {
  const texts = [address, headline, suburb].filter((t): t is string => !!t && t.trim().length > 0);
  for (const t of texts) {
    for (const name of CENTROID_NAMES) {
      if (nameRe(name).test(t)) return GARDEN_ROUTE_CENTROIDS[name];
    }
  }
  if (opts?.specificOnly) return null;
  if (texts.some((t) => NO_CENTROID.test(t))) return null;
  if (texts.some((t) => /\bKnysna\b/i.test(t))) return GARDEN_ROUTE_CENTROIDS["Knysna"];
  return null;
}

/** "Contact agent for street address" and friends: the portal is hiding the
 *  address, so any coordinate it ships is a placeholder, not the house. */
export function isHiddenAddress(address: string | null | undefined): boolean {
  const a = (address ?? "").trim();
  if (!a) return true;
  return /contact\s+(the\s+)?(agent|broker|seller|owner|agency)|not\s+specified|address\s+(withheld|on\s+request|available\s+on\s+request)|^(n\/?a|tba|tbc|-)$/i.test(a);
}

// Property24 pins every hidden-address Knysna listing on this one point.
const PLACEHOLDER_COORDS: LngLat[] = [{ lat: -34.026746, lng: 23.084946 }];
export function isPlaceholderCoord(c: LngLat): boolean {
  return PLACEHOLDER_COORDS.some((p) => Math.abs(p.lat - c.lat) < 0.00005 && Math.abs(p.lng - c.lng) < 0.00005);
}

export function mapboxToken(): string {
  return (
    process.env.MAPBOX_SECRET_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    ""
  ).trim();
}

// Loosened anchor. A George or Plett listing shouldn't be dragged to
// Knysna — when the scraper has extracted a suburb we anchor with it;
// otherwise we anchor with "Garden Route, Western Cape" so Mapbox has a
// region hint without forcing a single town.
export function anchorForGardenRoute(
  address: string,
  suburb?: string | null,
): string {
  const a = (address ?? "").trim();
  if (GARDEN_ROUTE_ANCHOR.test(a)) return a;
  if (suburb && suburb.trim().length > 0) {
    return `${a}, ${suburb.trim()}, Western Cape, South Africa`;
  }
  return `${a}, Garden Route, Western Cape, South Africa`;
}

export function kmBetween(a: LngLat, b: LngLat): number {
  const dLat = (a.lat - b.lat) * 111;
  const dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** How precise a Mapbox answer is. Mapbox rarely knows Knysna house
 *  numbers, so most good answers are "street"; "area" means it fell back
 *  to a suburb, town or postcode. */
export type GeocodeLevel = "house" | "street" | "area";
export type DetailedGeocode = LngLat & { level: GeocodeLevel };

/** Mapbox's answer for an address plus how precise it is. Callers decide
 *  what to trust (see lib/external-listings/locate.ts). */
export async function geocodeAddress(
  address: string,
  opts?: {
    token?: string;
    signal?: AbortSignal;
    suburb?: string | null;
  },
): Promise<DetailedGeocode | null> {
  const token = (opts?.token ?? mapboxToken()).trim();
  if (!token) return null;
  const trimmed = (address ?? "").trim();
  if (trimmed.length < 3) return null;

  const url =
    MAPBOX_GEOCODE +
    "?" +
    new URLSearchParams({
      q: anchorForGardenRoute(trimmed, opts?.suburb),
      country: "za",
      proximity: "23.0479,-34.0363",   // tie-break bias to Knysna centre
      limit: "1",
      access_token: token,
    });

  try {
    const res = await fetch(url, { cache: "no-store", signal: opts?.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      features?: {
        geometry?: { coordinates?: [number, number] };
        properties?: {
          feature_type?: string;
          match_code?: { address_number?: string; street?: string; confidence?: string };
        };
      }[];
    };
    const f = json.features?.[0];
    const coords = f?.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    const [lng, lat] = coords;
    if (typeof lng !== "number" || typeof lat !== "number") return null;
    const type = f?.properties?.feature_type;
    const mc = f?.properties?.match_code;
    let level: GeocodeLevel;
    if ((type === "address" || type === "secondary_address") && mc?.address_number !== "unmatched" && mc?.street !== "unmatched" && mc?.confidence !== "low") {
      level = "house";
    } else if (type === "street" || type === "address" || type === "secondary_address") {
      level = "street";
    } else {
      level = "area";
    }
    return { lng, lat, level };
  } catch {
    return null;
  }
}
