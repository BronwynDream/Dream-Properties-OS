// lib/external-listings/property24.ts
// Firecrawl client for Property24 Knysna scrape. Pure library — the route
// handler orchestrates and persists.
//
// Rate discipline: 1 detail scrape per second (Firecrawl free tier is
// ~5 req/min; paid tiers higher; conservative default). Retries on 429
// with backoff. Errors logged and returned as null so the caller can
// carry on with the remaining URLs.

// Price extraction is JSON-LD-only. The LLM and markdown-regex fallbacks
// were removed 2026-07-31 after both produced provably wrong prices on
// production data:
//   - LLM extract returned the listing ID as price on POR listings
//     (Fernwood Estate 117227622 and Simola 117117095 both shipped with
//     price === source_ref, i.e. the URL's listing-id segment).
//   - Markdown regex picked up "R 130 304 000" for a 130,304 m² Uitzicht
//     farm (size-as-price via some page rendering that prefixed the size
//     with R). Not fixed by PR #50's JSON-LD switch because JSON-LD
//     returned coord-only for that row.
// If P24 doesn't ship a priceCurrency:ZAR offer node, we now show "Price
// on request" — honest — instead of a hallucinated number.

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape";

export type Property24Listing = {
  sourceRef: string; // listing id parsed from URL
  url: string;
  headline: string | null;
  addressRaw: string | null;
  suburb: string | null;
  price: number | null; // in Rand, integer
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string | null;
  agencyName: string | null;
  imageUrl: string | null;
  lat: number | null;
  lng: number | null;
  raw: unknown; // full Firecrawl response for later re-parsing
};

async function firecrawlScrape(
  apiKey: string,
  url: string,
  formats: string[],
  extractSchema?: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = { url, formats };
  if (extractSchema) {
    body.formats = [...formats, "extract"];
    body.extract = { schema: extractSchema };
  }
  const res = await fetch(FIRECRAWL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firecrawl ${res.status}: ${t.slice(0, 300)}`);
  }
  return (await res.json())?.data ?? {};
}

// Property24 URL prefixes we consider "for sale" detail pages. P24 splits
// its inventory across separate URL branches by property type — a single
// "/for-sale/" index only lists houses. Plots, apartments, and commercial
// each have their own root. Bronwyn spotted this 2026-07-30 when six+
// Pezula plots were missing from the OS map.
export const P24_FOR_SALE_PREFIXES = [
  "for-sale",                     // Houses (dominant)
  "vacant-land-plot-for-sale",    // Plots — the Pezula gap
  "apartments-flats-for-sale",    // Sectional title / apartments
  "commercial-property-for-sale", // Commercial (hotels etc.)
];

const PREFIX_ALT = P24_FOR_SALE_PREFIXES.join("|");

/**
 * Parse a Property24 detail-page URL to extract the numeric listing id.
 *
 * Real P24 detail URL structure (verified 2026-07-26):
 *   /<prefix>/<suburb-slug>/<town>/<province>/<suburb-code>/<listing-id>
 * where <prefix> is one of P24_FOR_SALE_PREFIXES.
 * Examples:
 *   /for-sale/brenton-on-sea/knysna/western-cape/7467/117436137
 *   /vacant-land-plot-for-sale/pezula/knysna/western-cape/12138/117200000
 *
 * Suburb landing pages are 5 segments (no listing-id trailing); we skip
 * those. Query string is ignored.
 */
export function parseListingIdFromUrl(url: string): string | null {
  const clean = url.split("?")[0].split("#")[0];
  const re = new RegExp(`\\/(?:${PREFIX_ALT})\\/[^/]+\\/[^/]+\\/[^/]+\\/\\d+\\/(\\d+)(?:\\/|$)`);
  const m = clean.match(re);
  return m?.[1] ?? null;
}

/**
 * A URL belongs to the Knysna area when its town segment (3rd path segment
 * after any of the sale prefixes) is "knysna". Sedgefield / Plettenberg Bay
 * have their own area codes (324 / 325) — those are separate scraper
 * targets, not scoped to Knysna's index.
 */
export function isKnysnaAreaUrl(url: string): boolean {
  const clean = url.split("?")[0].split("#")[0];
  const re = new RegExp(`\\/(?:${PREFIX_ALT})\\/[^/]+\\/knysna\\/western-cape\\/\\d+\\/\\d+(?:\\/|$)`);
  return re.test(clean);
}

/**
 * Normalise a link discovered on Firecrawl's `links` output to an absolute
 * URL against a base page. Firecrawl usually returns absolute URLs, but
 * some sites emit relative hrefs and Firecrawl passes them through as-is.
 * Passing a relative path back to /v1/scrape as `url` earns a Firecrawl
 * 400: "The string did not match the expected pattern". Guard here.
 *
 * Returns null for anything that isn't a Property24 URL (external ads,
 * social links, mailto:, javascript:, etc.).
 */
export function toAbsoluteProperty24Url(link: string, baseUrl: string): string | null {
  const trimmed = link.trim();
  if (!trimmed) return null;
  // Filter obvious non-URLs early.
  if (/^(mailto:|tel:|javascript:|#)/i.test(trimmed)) return null;
  try {
    const abs = new URL(trimmed, baseUrl).toString();
    // Only keep Property24 host — cross-site links (analytics, ad networks)
    // aren't listings and shouldn't be scraped.
    if (!/^https?:\/\/(www\.)?property24\.com\//i.test(abs)) return null;
    return abs;
  } catch {
    return null;
  }
}

/**
 * Walk the Knysna index pages until we stop finding new listing links.
 * Returns a de-duplicated array of detail URLs.
 */
export async function scrapeListingIndex(
  apiKey: string,
  baseUrl: string,
  opts: { maxPages?: number } = {},
): Promise<string[]> {
  const maxPages = opts.maxPages ?? 20;
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const pageUrl = page === 1 ? baseUrl : `${baseUrl}?Page=${page}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      data = await firecrawlScrape(apiKey, pageUrl, ["links"]);
    } catch (e) {
      console.error(`[property24] index page ${page} failed:`, (e as Error).message);
      break;
    }
    const links = (data.links ?? []) as string[];
    // Four guards on discovered links:
    //   1. absolute-URL — Firecrawl can emit relative hrefs; those would
    //      400 when passed back to /v1/scrape.
    //   2. property24 host — filters ad / analytics / social outbound.
    //   3. Knysna-area town segment — the index sometimes surfaces cross-
    //      region promos (agent bios, featured national listings). We
    //      only want Knysna Muni properties.
    //   4. Query-string strip — P24 emits ?plId=X&imgFocus=2/3/4 variants
    //      of the same listing; strip so dedup collapses them.
    const detailLinks: string[] = [];
    for (const l of links) {
      const abs = toAbsoluteProperty24Url(l, pageUrl);
      if (!abs) continue;
      const clean = abs.split("?")[0].split("#")[0];
      if (parseListingIdFromUrl(clean) != null && isKnysnaAreaUrl(clean)) {
        detailLinks.push(clean);
      }
    }
    console.log(
      `[property24] page ${page}: ${links.length} raw links → ${detailLinks.length} Knysna detail URLs`,
    );
    const before = seen.size;
    for (const l of detailLinks) seen.add(l);
    // Stop when a page adds no new detail links (past the last real page).
    if (seen.size === before) {
      console.log(`[property24] index exhausted at page ${page} (${seen.size} listings)`);
      break;
    }
    // Be polite between index pages.
    await new Promise((r) => setTimeout(r, 700));
  }
  return Array.from(seen);
}

/**
 * Scrape one detail page. Uses Firecrawl's extract mode with an explicit
 * schema so we get typed fields back — cheaper than parsing markdown
 * ourselves and more robust to layout changes on Property24.
 *
 * POPIA: the schema deliberately does NOT request owner name / contact
 * info even if visible on the page — those never enter our system.
 */
export async function scrapeListingDetail(
  apiKey: string,
  url: string,
): Promise<Property24Listing | null> {
  const sourceRef = parseListingIdFromUrl(url);
  if (!sourceRef) return null;

  const schema = {
    type: "object",
    properties: {
      headline: { type: "string", description: "The listing's headline / title" },
      address: { type: "string", description: "Street address as displayed" },
      suburb: { type: "string", description: "Suburb name only" },
      bedrooms: { type: "number" },
      bathrooms: { type: "number" },
      property_type: {
        type: "string",
        description: "House / Apartment / Estate / Vacant Land / etc.",
      },
      agency_name: {
        type: "string",
        description: "The estate agency marketing the listing",
      },
      image_url: { type: "string", description: "The primary hero image URL" },
      // NOTE: price + lat/lng deliberately NOT requested. Both come from
      // schema.org JSON-LD (parsed below from rawHtml). Firecrawl's LLM
      // extract hallucinates on both — coords ~50% off, price returned as
      // the listing-id segment of the URL on POR listings.
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    // Request rawHtml alongside markdown — we parse the schema.org
    // RealEstateListing JSON-LD block for coords (verified 2026-07-30
    // via the inspect-p24-html diagnostic; P24 ships a full Place.geo
    // with latitude/longitude in every listing detail page). rawHtml
    // preserves <script> tags; the default 'html' format strips them.
    data = await firecrawlScrape(apiKey, url, ["markdown", "rawHtml"], schema);
  } catch (e) {
    console.error(`[property24] detail scrape ${sourceRef} failed:`, (e as Error).message);
    return null;
  }

  const extracted = data.extract ?? {};

  // Coords from schema.org RealEstateListing JSON-LD. This is P24's
  // canonical source-of-truth — the same coords render their own map
  // widget — so it's cadastrally accurate by construction. Replaces the
  // fragile Mapbox-geocode + Muni-ERF-lookup chain (both of which
  // covered maybe 30-50% of listings; JSON-LD covers ~all of them).
  const rawHtml: string =
    typeof data.rawHtml === "string"
      ? data.rawHtml
      : typeof data.html === "string"
        ? data.html
        : "";
  const jsonLd = parseJsonLdFields(rawHtml);
  const lat: number | null = jsonLd.coords?.lat ?? null;
  const lng: number | null = jsonLd.coords?.lng ?? null;

  // Price is JSON-LD-only. If P24 didn't ship a priceCurrency:ZAR offer
  // on this page, we return null — the listing is treated as "Price on
  // request". Fallback extractors (LLM + markdown regex) both produced
  // demonstrably wrong prices in production; see the file header for the
  // two specific bugs that motivated this.
  const price: number | null = jsonLd.price;

  return {
    sourceRef,
    url,
    headline: extracted.headline ?? null,
    addressRaw: extracted.address ?? null,
    suburb: extracted.suburb ?? null,
    price,
    bedrooms: extracted.bedrooms != null ? Math.round(Number(extracted.bedrooms)) : null,
    bathrooms: extracted.bathrooms != null ? Math.round(Number(extracted.bathrooms)) : null,
    propertyType: extracted.property_type ?? null,
    agencyName: extracted.agency_name ?? null,
    imageUrl: extracted.image_url ?? null,
    lat,
    lng,
    raw: data,
  };
}

// Pull structured fields from Property24's schema.org RealEstateListing
// JSON-LD block. Every P24 detail page ships a
//   <script type="application/ld+json"> { "@graph": [ ... ] } </script>
// containing a Place with { "@type": "Place", "latitude": -34.06,
// "longitude": 23.08 } and an Offer with { "price": "6995000",
// "priceCurrency": "ZAR" } — verified via the inspect-p24-html
// diagnostic on the Rexford 4-bed listing.
//
// Recursive walk for coord and price nodes — more resilient than
// matching a specific nesting path (P24 has changed shape before).
//
// Coord sanity-guarded to Garden Route bbox. Price sanity-guarded to
// ZAR currency and >100k (rejects tiny numbers that might be per-m²
// rates, deposit amounts, or similar).
export function parseJsonLdFields(rawHtml: string): {
  coords: { lat: number; lng: number } | null;
  price: number | null;
} {
  const empty = { coords: null, price: null };
  if (!rawHtml) return empty;
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let coords: { lat: number; lng: number } | null = null;
  let price: number | null = null;
  while ((m = re.exec(rawHtml)) !== null) {
    const body = (m[1] ?? "").trim();
    if (!body) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    if (!coords) coords = findLatLng(parsed);
    if (price == null) price = findZarPrice(parsed);
    if (coords && price != null) break;
  }
  return { coords, price };
}

// Back-compat alias — the earlier signature only returned coords, and
// there might be external callers or tests using it. Delegate.
export function parseJsonLdCoords(rawHtml: string): { lat: number; lng: number } | null {
  return parseJsonLdFields(rawHtml).coords;
}

// Recursive walk for the first ZAR-denominated price on any object.
// P24's Offer nodes look like { "@type": "Offer", "price": "26000000",
// "priceCurrency": "ZAR" }. Guard against confusing floorSize or other
// numeric fields — require priceCurrency: ZAR on the same object.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findZarPrice(node: any): number | null {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (const el of node) {
      const hit = findZarPrice(el);
      if (hit != null) return hit;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const currency = typeof node.priceCurrency === "string"
    ? node.priceCurrency.toUpperCase()
    : null;
  const priceVal = node.price;
  if (currency === "ZAR" && (typeof priceVal === "number" || typeof priceVal === "string")) {
    const n = Number(priceVal);
    if (Number.isFinite(n) && n >= 100_000 && n <= 1_000_000_000) {
      return Math.round(n);
    }
  }
  for (const key of Object.keys(node)) {
    const hit = findZarPrice(node[key]);
    if (hit != null) return hit;
  }
  return null;
}

// Recursive walk for the first { latitude, longitude } pair on any
// object in the tree. Case-sensitive on the property names — schema.org
// spec is lowercase and P24 follows it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findLatLng(node: any): { lat: number; lng: number } | null {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (const el of node) {
      const hit = findLatLng(el);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  if (
    (typeof node.latitude === "number" || typeof node.latitude === "string") &&
    (typeof node.longitude === "number" || typeof node.longitude === "string")
  ) {
    const lat = Number(node.latitude);
    const lng = Number(node.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && isGardenRouteLatLng(lat, lng)) {
      return { lat, lng };
    }
  }
  for (const key of Object.keys(node)) {
    const hit = findLatLng(node[key]);
    if (hit) return hit;
  }
  return null;
}

// Same Garden Route bbox used in geocode.ts inGardenRoute — kept local
// here so parseJsonLdCoords stays a pure function without an import
// cycle if this file is reused server-side later.
function isGardenRouteLatLng(lat: number, lng: number): boolean {
  return lat >= -34.3 && lat <= -33.5 && lng >= 22.5 && lng <= 24.0;
}
