// lib/external-listings/property24.ts
// Firecrawl client for Property24 Knysna scrape. Pure library — the route
// handler orchestrates and persists.
//
// Rate discipline: 1 detail scrape per second (Firecrawl free tier is
// ~5 req/min; paid tiers higher; conservative default). Retries on 429
// with backoff. Errors logged and returned as null so the caller can
// carry on with the remaining URLs.

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

/**
 * Parse a Property24 detail-page URL to extract the numeric listing id.
 *
 * Real P24 detail URL structure (verified 2026-07-26):
 *   /for-sale/<suburb-slug>/<town>/<province>/<suburb-code>/<listing-id>
 * Example:
 *   /for-sale/brenton-on-sea/knysna/western-cape/7467/117436137
 *   ↑              ↑              ↑         ↑          ↑
 *   /for-sale      suburb-slug    town      province   suburb-code  listing-id
 *
 * Suburb landing pages are 5 segments (no listing-id trailing); we skip
 * those. Query string is ignored.
 */
export function parseListingIdFromUrl(url: string): string | null {
  const clean = url.split("?")[0].split("#")[0];
  const m = clean.match(/\/for-sale\/[^/]+\/[^/]+\/[^/]+\/\d+\/(\d+)(?:\/|$)/);
  return m?.[1] ?? null;
}

/**
 * A URL belongs to the Knysna area when its town segment (3rd path segment
 * after /for-sale) is "knysna". Sedgefield / Plettenberg Bay have their own
 * area codes (324 / 325) — those are separate scraper targets, not scoped
 * to Knysna's index.
 */
export function isKnysnaAreaUrl(url: string): boolean {
  const clean = url.split("?")[0].split("#")[0];
  return /\/for-sale\/[^/]+\/knysna\/western-cape\/\d+\/\d+(?:\/|$)/.test(clean);
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
      price: {
        type: "number",
        description: "Asking price in Rand as a plain integer, no symbols",
      },
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
      // NOTE: lat/lng deliberately NOT requested. P24 embeds coords in
      // JS data attributes for their own map widget — not visible text.
      // Firecrawl's LLM extract would hallucinate ~50% of the time
      // (e.g. Simola listing landing near Wilderness, ~50km off). We
      // geocode via Mapbox in the route handler instead.
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = await firecrawlScrape(apiKey, url, ["markdown"], schema);
  } catch (e) {
    console.error(`[property24] detail scrape ${sourceRef} failed:`, (e as Error).message);
    return null;
  }

  const extracted = data.extract ?? {};

  // lat/lng deliberately left null here. Firecrawl's LLM extract on P24
  // pages hallucinates coordinates half the time (they aren't in visible
  // text — embedded in JS data attributes for P24's own map widget).
  // The route handler geocodes address_raw + suburb via Mapbox to get
  // real coordinates before upsert.
  const lat: number | null = null;
  const lng: number | null = null;

  // Price sanity: 0 is always a scrape failure for a real listing. Store null
  // instead of a nonsense R0 pin label.
  let price: number | null = null;
  if (extracted.price != null) {
    const n = Math.round(Number(extracted.price));
    if (Number.isFinite(n) && n > 0) price = n;
    else console.warn(`[property24] rejecting non-positive price for ${sourceRef}: ${extracted.price}`);
  }

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
