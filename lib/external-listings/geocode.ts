// Mapbox forward geocoding for scraped external listings. Mirrors the pattern
// in app/map/actions.ts (Knysna anchor, proximity centre, country=za) so a
// short address like "26 Brenton Hotel" resolves consistently across the app.
//
// Kept small and pure so both the map action and the scraper can call it.

const MAPBOX_GEOCODE = "https://api.mapbox.com/search/geocode/v6/forward";
const KNYSNA_ANCHOR = /Knysna|South Africa|Sedgefield|Brenton|Pezula|Thesen|Simola|Belvidere|Leisure Isle/i;

export type LngLat = { lng: number; lat: number };

export function mapboxToken(): string {
  return (
    process.env.MAPBOX_SECRET_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    ""
  ).trim();
}

// Anchor short addresses to Knysna so Mapbox doesn't drift to Knysna in
// Cornwall or a random road elsewhere in ZA.
export function anchorForKnysna(address: string): string {
  return KNYSNA_ANCHOR.test(address) ? address : `${address}, Knysna, South Africa`;
}

export async function geocodeAddress(
  address: string,
  opts?: { token?: string; signal?: AbortSignal },
): Promise<LngLat | null> {
  const token = (opts?.token ?? mapboxToken()).trim();
  if (!token) return null;
  const trimmed = (address ?? "").trim();
  if (trimmed.length < 3) return null;

  const url =
    MAPBOX_GEOCODE +
    "?" +
    new URLSearchParams({
      q: anchorForKnysna(trimmed),
      country: "za",
      proximity: "23.0479,-34.0363",
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
