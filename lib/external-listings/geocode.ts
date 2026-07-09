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

// Rough centroids for the estates and towns Dream sells across. Used as a
// last-resort fallback when Mapbox can't resolve an estate-code address
// like "F24 Thesen" or "B4 Pezula Private Estate" but the area is known.
// Coordinates are approximate — good enough to land the pin in the right
// polygon on the map; the geocode itself is exact when it succeeds.
// Rough centroids for estates + towns Dream sells across. Aliased entries
// (e.g. "Thesen" → same coords as "Thesen Islands") let the address-string
// scanner catch filename-abbreviated forms like "F24 Thesen" without
// needing the full estate name in the address.
export const GARDEN_ROUTE_CENTROIDS: Record<string, LngLat> = {
  "Knysna":              { lng: 23.0479, lat: -34.0363 },
  "Leisure Isle":        { lng: 23.0725, lat: -34.049  },
  "The Heads":           { lng: 23.081,  lat: -34.081  },
  "Belvidere":           { lng: 22.976,  lat: -34.03   },
  "Brenton on Sea":      { lng: 23.0227, lat: -34.08   },
  "Brenton":             { lng: 23.0227, lat: -34.08   },
  "Pezula Private Estate": { lng: 23.108, lat: -34.07  },
  "Pezula":              { lng: 23.108,  lat: -34.07   },
  "Simola":              { lng: 23.04,   lat: -33.982  },
  "Thesen Islands":      { lng: 23.043,  lat: -34.048  },
  "Thesen":              { lng: 23.043,  lat: -34.048  },
  "Eastford Glen":       { lng: 22.986,  lat: -34.008  },
  "Eastford":            { lng: 22.986,  lat: -34.008  },
  "Centreville":         { lng: 22.995,  lat: -34.018  },
  "Sedgefield":          { lng: 22.81,   lat: -34.025  },
  "Plettenberg Bay":     { lng: 23.376,  lat: -34.053  },
  "Plett":               { lng: 23.376,  lat: -34.053  },
  "George":              { lng: 22.46,   lat: -33.963  },
  "Wilderness":          { lng: 22.58,   lat: -33.99   },
};

// Look up a centroid by suburb name first (most reliable — the scraper has
// already picked the closest match from KNYSNA_SUBURBS), then fall through
// to scanning the address string for any known area name.
export function centroidForArea(
  address: string | null | undefined,
  suburb: string | null | undefined,
): LngLat | null {
  if (suburb) {
    const hit = GARDEN_ROUTE_CENTROIDS[suburb];
    if (hit) return hit;
  }
  if (address) {
    for (const [name, coords] of Object.entries(GARDEN_ROUTE_CENTROIDS)) {
      const re = new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (re.test(address)) return coords;
    }
  }
  return null;
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

export async function geocodeAddress(
  address: string,
  opts?: {
    token?: string;
    signal?: AbortSignal;
    suburb?: string | null;
  },
): Promise<LngLat | null> {
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
      features?: { geometry?: { coordinates?: [number, number] } }[];
    };
    const coords = json.features?.[0]?.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    const [lng, lat] = coords;
    if (typeof lng !== "number" || typeof lat !== "number") return null;
    return { lng, lat };
  } catch {
    return null;
  }
}
