import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rebuildDedupAndMatch } from "@/lib/external-listings/dedup";
import { geocodeAddress, mapboxToken } from "@/lib/external-listings/geocode";

export const runtime = "nodejs";
// Vercel Hobby silently clamps to 60s — anything higher gets truncated
// mid-request, taking the JSON response with it. Stay in the plan's cap
// and cover the tail by deferring surplus geocodes to the next run.
export const maxDuration = 60;

// Concurrent fetch pool for listing pages. Dream's site sits behind
// Cloudflare + WordPress — 4 in flight is polite and finishes the 12
// pages in ~3s wall-clock.
const FETCH_CONCURRENCY = 4;
// Geocode budget per run. Mapbox forward-geocode is ~250ms; 8 keeps us
// well under maxDuration and any surplus rides the next run — active=true
// stays intact, so the pin just appears late.
const MAX_GEOCODES_PER_RUN = 8;

// GET/POST /api/sources/dream/refresh
//
// Nightly Dream WordPress scraper. Two callers:
//   1. Vercel Cron — GET with Authorization: Bearer $CRON_SECRET (Vercel
//      sends this header automatically for cron jobs; we verify it in code).
//   2. Admin manual trigger — POST with an authenticated admin session
//      (or a bearer for scripting).
//
// Pipeline:
//   fetch index → discover listing URLs → fetch each → extract fields →
//   upsert on (source='dream_website', source_ref) → mark unseen active=false
//   → geocode new/changed → rebuild dedup + match clusters.
//
// The scraper writes via createServiceClient() so it never gets blocked by
// RLS, even when the cron runs with no user session.
//
// P24 + Private Property adapters will live in sibling routes when their
// feed access opens — they write into the same table with source set to
// 'property24' / 'private_property'. Their pipelines share this endpoint's
// shape: fetch → parse → upsert → geocode → rebuildDedupAndMatch.

const INDEX_URL = "https://www.dreamknysna.co.za/knysna-properties/";
const UA = "DreamOS-Scraper/1.0 (+dreamproperties.app)";

// -----------------------------------------------------------------------------
// Auth
// -----------------------------------------------------------------------------

async function authorised(request: Request): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  // Cron / bearer path.
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (secret && bearer && constantTimeEq(bearer, secret)) return { ok: true };

  // Admin session path.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("app_user")
      .select("role, active")
      .eq("id", user.id)
      .single();
    if (profile?.role === "admin" && profile.active !== false) return { ok: true };
    return { ok: false, status: 403, error: "admin only" };
  }

  return { ok: false, status: 401, error: "unauthorised" };
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}

async function run(request: Request) {
  const gate = await authorised(request);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  // Top-level try/catch so the client ALWAYS receives JSON. Without this a
  // late throw becomes an HTML error page the RefreshDreamButton can't parse,
  // and the manual trigger fails silently.
  try {
    const service = createServiceClient();
    const runAt = new Date();

    let indexHtml: string;
    try {
      indexHtml = await fetchText(INDEX_URL);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `index fetch failed: ${(e as Error).message}` },
        { status: 502 },
      );
    }

    const listingUrls = extractListingUrls(indexHtml);

    // Zero-state: a WordPress theme change or Cloudflare interstitial would
    // cut this to zero. Return an explicit note so the next Vercel log line
    // says exactly what happened — silence is the wrong signal here.
    if (listingUrls.length === 0) {
      return NextResponse.json({
        ok: true,
        upserted: 0,
        delisted: 0,
        geocoded: 0,
        clustered: 0,
        matched: 0,
        groups: 0,
        errors: [],
        note: "no listing links found at index — selector may be stale",
      });
    }

    const errors: string[] = [];
    const parsed: DreamListing[] = [];

    // Concurrent fetch pool — small worker set drains the URL queue.
    const urlQueue = [...listingUrls];
    async function worker() {
      for (;;) {
        const url = urlQueue.shift();
        if (!url) return;
        try {
          const html = await fetchText(url);
          const item = parseDreamListing(url, html);
          if (item.source_ref) parsed.push(item);
        } catch (e) {
          errors.push(`${url}: ${(e as Error).message}`);
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, listingUrls.length) }, () =>
        worker(),
      ),
    );

    // Upsert every parsed listing on (source, source_ref).
    let upserted = 0;
    const seenIds = new Set<string>();
    const geocodeQueue: { id: string; address: string }[] = [];

    for (const item of parsed) {
      const existing = await service
        .from("external_listing")
        .select("id, address_raw, lat, lng")
        .eq("source", "dream_website")
        .eq("source_ref", item.source_ref)
        .maybeSingle();

      const patch: Record<string, unknown> = {
        source: "dream_website",
        source_ref: item.source_ref,
        url: item.url,
        headline: item.headline,
        address_raw: item.address_raw,
        suburb: item.suburb,
        price: item.price,
        bedrooms: item.bedrooms,
        bathrooms: item.bathrooms,
        property_type: item.property_type,
        agency_name: "Dream Properties",
        image_url: item.image_url,
        raw: item.raw,
        last_seen: runAt.toISOString(),
        active: true,
      };

      const prior = existing.data;
      const addressChanged =
        !prior || (prior.address_raw ?? "") !== (item.address_raw ?? "");
      const missingCoords = !prior || prior.lat == null || prior.lng == null;

      const { data: upsertRow, error: upErr } = await service
        .from("external_listing")
        .upsert(patch, { onConflict: "source,source_ref" })
        .select("id")
        .single();
      if (upErr || !upsertRow) {
        errors.push(`${item.source_ref}: upsert failed: ${upErr?.message ?? "no id"}`);
        continue;
      }
      seenIds.add(upsertRow.id);
      upserted++;

      if ((addressChanged || missingCoords) && item.address_raw) {
        geocodeQueue.push({ id: upsertRow.id, address: item.address_raw });
      }
    }

    // Delist anything that was previously active but wasn't seen this run.
    // Fetching the current active set + deactivating the diff is more reliable
    // than a PostgREST NOT IN over quoted strings.
    let delisted = 0;
    if (parsed.length > 0) {
      const { data: activeNow } = await service
        .from("external_listing")
        .select("id")
        .eq("source", "dream_website")
        .eq("active", true);
      const toDelist = (activeNow ?? [])
        .filter((r: { id: string }) => !seenIds.has(r.id))
        .map((r: { id: string }) => r.id);
      if (toDelist.length > 0) {
        const { error: delErr } = await service
          .from("external_listing")
          .update({ active: false })
          .in("id", toDelist);
        if (delErr) errors.push(`delist failed: ${delErr.message}`);
        else delisted = toDelist.length;
      }
    }

    // Geocode new/changed rows via Mapbox — capped so we can't blow the
    // Hobby maxDuration on a first-time run that geocodes every listing.
    // Surplus rows keep active=true; the next run picks them up because
    // their lat/lng are still null (missingCoords => back in the queue).
    let geocoded = 0;
    let deferredGeocode = 0;
    const token = mapboxToken();
    if (!token) {
      errors.push("no mapbox token — new rows landed without coordinates");
    } else {
      const toGeocode = geocodeQueue.slice(0, MAX_GEOCODES_PER_RUN);
      deferredGeocode = Math.max(0, geocodeQueue.length - toGeocode.length);
      for (const g of toGeocode) {
        const coords = await geocodeAddress(g.address, { token });
        if (!coords) continue;
        const { error: gErr } = await service
          .from("external_listing")
          .update({ lat: coords.lat, lng: coords.lng })
          .eq("id", g.id);
        if (gErr) errors.push(`geocode save ${g.id}: ${gErr.message}`);
        else geocoded++;
      }
    }

    // Cluster + match. Wrapped so a dedup failure logs to errors[] and
    // partial results still come back — the ledger and pins are already
    // written; dedup can catch up next run.
    let dedupSummary: { clustered: number; matched: number; groups: number } = {
      clustered: 0,
      matched: 0,
      groups: 0,
    };
    try {
      dedupSummary = await rebuildDedupAndMatch(service);
    } catch (e) {
      errors.push(`dedup failed: ${(e as Error).message}`);
    }

    return NextResponse.json({
      ok: true,
      upserted,
      delisted,
      geocoded,
      deferredGeocode,
      ...dedupSummary,
      errors,
    });
  } catch (e) {
    // Last-resort JSON envelope. Any throw from the branches above lands
    // here so RefreshDreamButton can render the error inline instead of
    // failing to parse an HTML 500 page.
    return NextResponse.json(
      { ok: false, error: (e as Error).message ?? String(e) },
      { status: 500 },
    );
  }
}

// -----------------------------------------------------------------------------
// Fetch helper (no cache, browser-y user agent so WordPress doesn't 403)
// -----------------------------------------------------------------------------
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// -----------------------------------------------------------------------------
// Extract listing URLs from the WordPress index page.
// Dream's theme renders each listing under
//   https://www.dreamknysna.co.za/knysna-properties/<slug>/
// where <slug> is a lowercase alphanumeric+hyphen WordPress permalink
// ("a-home-of-quiet-distinction", "beyond-rare", ...).
//
// We MUST exclude:
//   - the bare index (/knysna-properties/) itself
//   - pagination (/knysna-properties/page/N/)
//   - anchor or query-string variants
// -----------------------------------------------------------------------------
function extractListingUrls(html: string): string[] {
  const bySlug = new Map<string, string>();
  const re =
    /href=["'](https?:\/\/(?:www\.)?dreamknysna\.co\.za\/knysna-properties\/([a-z0-9][a-z0-9-]*)\/?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const slug = m[2];
    if (!slug) continue;             // bare index guarded by regex + this
    if (slug === "page") continue;   // pagination
    if (bySlug.has(slug)) continue;  // www / non-www duplicates → keep first
    // Normalise to always end with a slash — dedupes href variants.
    const url = m[1].endsWith("/") ? m[1] : `${m[1]}/`;
    bySlug.set(slug, url);
  }
  return Array.from(bySlug.values());
}

// -----------------------------------------------------------------------------
// Parse a single Dream listing page.
// -----------------------------------------------------------------------------
export type DreamListing = {
  source_ref: string;
  url: string;
  headline: string | null;
  address_raw: string | null;
  suburb: string | null;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  property_type: string | null;
  image_url: string | null;
  raw: Record<string, unknown>;
};

function parseDreamListing(url: string, html: string): DreamListing {
  const slug = url
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .pop() ?? url;

  const headline = firstMatch(html, /<meta property="og:title" content="([^"]+)"/i)
    ?? firstMatch(html, /<title>([^<]+)<\/title>/i);

  // Price: match "R 2,730,000" or "R2 730 000". Take the first that appears
  // in the visible body (not the head), by cropping the head off.
  const body = html.split(/<body[^>]*>/i)[1] ?? html;
  const priceMatch = body.match(/R\s?[0-9][0-9,\s.]{4,}/);
  const price = priceMatch ? parsePriceZAR(priceMatch[0]) : null;

  // Collect every uploaded image on the page. Dream's uploaded photos live
  // under /wp-content/uploads/ and are keyed by the sale property's real
  // address (e.g. "26-Brenton-Hotel-11.jpg"). Meta/og tags are decorative on
  // most listings and rarely include a usable street address, so the image
  // filenames are the reliable address source.
  const listingImages = collectListingImages(html);

  // Address extraction — priority:
  //   1. meta description / h1 / og:title if they start with a street number
  //      (kept for future editorial changes on the site).
  //   2. First listing image whose filename parses to a valid address pattern.
  const metaDesc = firstMatch(html, /<meta name="description" content="([^"]+)"/i);
  const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);

  let addressImage: string | null = null;
  let addressFromImage: string | null = null;
  for (const img of listingImages) {
    const cand = addressFromImageFilename(img);
    if (cand) {
      addressImage = img;
      addressFromImage = cand;
      break;
    }
  }

  const address_raw =
    pickAddressCandidate(metaDesc) ??
    pickAddressCandidate(stripTags(h1)) ??
    pickAddressCandidate(headline) ??
    addressFromImage;

  // Prefer the image the address came from — that's the actual property
  // photo, not whatever WordPress picked for og:image (often the same, but
  // when they differ, the filename-derived one is the right choice).
  const image_url =
    addressImage ??
    firstMatch(html, /<meta property="og:image" content="([^"]+)"/i) ??
    listingImages[0] ??
    firstMatch(html, /<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|webp))"/i);

  // Suburb sniff — Knysna suburb names Dream typically uses.
  const suburb = suburbFromText([address_raw, metaDesc, h1, headline].filter(Boolean).join(" "));

  const bedrooms = numberAfter(body, /(\d+)\s*(?:bed|bedroom)/i);
  const bathrooms = numberAfter(body, /(\d+)\s*(?:bath|bathroom)/i);
  const property_type = propertyTypeFromText([headline, metaDesc, body].filter(Boolean).join(" "));

  return {
    source_ref: slug,
    url,
    headline: cleanText(headline),
    address_raw: cleanText(address_raw),
    suburb,
    price,
    bedrooms,
    bathrooms,
    property_type,
    image_url,
    raw: {
      metaDesc,
      priceMatch: priceMatch?.[0] ?? null,
      h1: cleanText(h1),
      addressImage,
      imageCount: listingImages.length,
    },
  };
}

// -----------------------------------------------------------------------------
// Small parsing helpers
// -----------------------------------------------------------------------------

function firstMatch(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m?.[1] ?? null;
}

function stripTags(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > 0 ? t : null;
}

function parsePriceZAR(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function numberAfter(s: string, re: RegExp): number | null {
  const m = s.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// Address candidate: text starts with a house number, has 2–8 words, no
// full sentences. Trims trailing sentence text.
function pickAddressCandidate(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  // Grab the first sentence-ish chunk before a period / comma clause end.
  const chunk = t.split(/(?:\.|\s\|\s|\s—\s|\s-\s{2,})/)[0].trim();
  if (/^\d+\s+[A-Za-z]/.test(chunk) && chunk.length <= 80) return chunk;
  return null;
}

// Non-listing image filenames — logos, icons, template placeholders. These
// live under wp-content/uploads too but never encode a property address.
const NON_LISTING_ASSET = /(logo|icon|placeholder|avatar|favicon)/i;

// Every listing photo URL on the page. Dream uploads them under
// wp-content/uploads/YYYY/MM/... — regex the raw HTML rather than parse
// DOM structure so a theme change doesn't silently break the collector.
function collectListingImages(html: string): string[] {
  const set = new Set<string>();
  const re =
    /https?:\/\/(?:www\.)?dreamknysna\.co\.za\/wp-content\/uploads\/[^"'\s)]+\.(?:jpg|jpeg|png|webp)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = m[0];
    const filename = url.split("/").pop() ?? "";
    if (NON_LISTING_ASSET.test(filename)) continue;
    set.add(url);
  }
  return Array.from(set);
}

// Address-like filename patterns. Match against the cleaned stem.
const STREET_NUMBER_PATTERN = /^\d+\s+[A-Za-z]/;
const STAND_CODE_PATTERN    = /^[A-Za-z]{1,2}\d+\s+[A-Za-z]/;
const BARE_PLACE_NAME       = /^[A-Za-z]+(?:\s+[A-Za-z]+)*$/;

// Derive a street address from a Dream upload URL. Filenames are keyed
// on the sale property's address by the agent when they upload — e.g.
//   26-Brenton-Hotel-11.jpg    → "26 Brenton Hotel"
//   B4-Pezula-Private-Estate-1 → "B4 Pezula Private Estate"
//   Centreville-11.jpg         → "Centreville"
// Rules: strip extension, strip trailing "-Annotated" AND trailing photo
// index (looped so "-Annotated-3" strips both), convert dashes/underscores
// to spaces, collapse whitespace. Accept the result if it matches a
// street-number, an estate stand-code, or a bare place name (≥4 chars).
function addressFromImageFilename(url: string | null | undefined): string | null {
  if (!url) return null;
  const file = url.split("/").pop() ?? "";
  let cleaned = file.replace(/\.(?:jpg|jpeg|png|webp)$/i, "");

  // Strip trailing "-Annotated" and "-NNN" in either order, up to 3 rounds
  // so "-Annotated-3" collapses to the base.
  for (let i = 0; i < 3; i++) {
    const prev = cleaned;
    cleaned = cleaned
      .replace(/-Annotated$/i, "")
      .replace(/-\d{1,3}$/, "");
    if (cleaned === prev) break;
  }

  cleaned = cleaned
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length > 60) return null;

  if (STREET_NUMBER_PATTERN.test(cleaned)) return cleaned;
  if (STAND_CODE_PATTERN.test(cleaned)) return cleaned;
  if (cleaned.length >= 4 && BARE_PLACE_NAME.test(cleaned)) return cleaned;

  return null;
}

const KNYSNA_SUBURBS = [
  "Leisure Isle",
  "The Heads",
  "Belvidere",
  "Brenton",
  "Brenton on Sea",
  "Pezula",
  "Simola",
  "Thesen Islands",
  "Old Place",
  "Paradise",
  "Rexford",
  "Hunters Home",
  "Knysna Heights",
  "Sedgefield",
  "Sparrebosch",
  "Eastford",
];
function suburbFromText(hay: string): string | null {
  if (!hay) return null;
  for (const s of KNYSNA_SUBURBS) {
    if (new RegExp(`\\b${s.replace(/\s+/g, "\\s+")}\\b`, "i").test(hay)) return s;
  }
  return null;
}

const PROPERTY_TYPES: [RegExp, string][] = [
  [/\bapartment\b|\bflat\b/i, "apartment"],
  [/\bpenthouse\b/i, "penthouse"],
  [/\btownhouse\b/i, "townhouse"],
  [/\bvacant land\b|\bplot\b|\bstand\b|\berf\b/i, "vacant_land"],
  [/\bhouse\b|\bhome\b|\bvilla\b|\bresidence\b/i, "house"],
  [/\bfarm\b|\bsmallholding\b|\bagricultural\b/i, "farm"],
  [/\bcommercial\b|\bretail\b|\boffice\b/i, "commercial"],
];
function propertyTypeFromText(hay: string): string | null {
  for (const [re, code] of PROPERTY_TYPES) if (re.test(hay)) return code;
  return null;
}

function constantTimeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
