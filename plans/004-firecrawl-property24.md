# Plan 004: Firecrawl Property24 scraper as a new `external_listing` source

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f3b6711..HEAD -- app/api/sources lib/external-listings supabase/migrations vercel.json`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `f3b6711`, 2026-07-26

## Why this matters

Dream's `/map` merges Dream-owned listings with external listings from other
portals into unified pins so the agency can see the whole Knysna market at a
glance. The `external_listing` table + dedup pipeline already handle
`dream_website`, `property24`, and `private_property` as sources
(`supabase/migrations/0025_external_listing.sql:18-22`) — but only
`dream_website` actually has a scraper wired
(`app/api/sources/dream/refresh/route.ts`). The `property24` and
`private_property` enum values are placeholders.

Bronwyn wants Property24's Knysna-area listings to render on the map next to
Dream's. That surfaces competitor activity (Pam Golding's new Pezula listing
appears immediately), highlights properties Dream should be pitching for
joint mandates, and — over time — feeds a comparable-sales model.

Approach: use **Firecrawl** (hosted scrape API) rather than a bespoke HTML
parser. Firecrawl handles the two hardest bits (headless browser + JS
rendering + LLM-structured extraction) as a single API call. Trade-off:
per-scrape cost, external dependency. Acceptable at Dream's volume
(~200-400 Knysna listings, weekly refresh = ~1600 scrapes/month).

## Current state

### Existing scraper pattern

`app/api/sources/dream/refresh/route.ts` (807 lines) is the exemplar to
match. The pattern:

- POST endpoint, bearer-token auth via `CRON_SECRET`
- Uses `createServiceClient()` (bypasses RLS)
- Constant-time comparison for the bearer token (`constantTimeEq` at
  line 802-806 — reuse this helper's shape)
- Upserts to `external_listing` on the unique key `(source, source_ref)`
- Updates `last_seen` on each seen row, `active = false` on rows not seen
  in the current run (sunset the delisted)
- Calls `dedupExternalListings()` from `lib/external-listings/dedup.ts` after
  the fetch
- Optionally calls `geocodeExternalListings()` from
  `lib/external-listings/geocode.ts` for rows missing coords

Read this file before writing 004's route — you'll match its structure closely.

### `external_listing` schema (from migration 0025)

Columns relevant to this scraper:

```sql
source                 listing_source not null,   -- must be 'property24'
source_ref             text not null,             -- Property24's listing id (numeric string)
url                    text,                      -- canonical detail URL
headline               text,
address_raw            text,
suburb                 text,
price                  numeric(14,2),
bedrooms               int,
bathrooms              int,
property_type          text,
agency_name            text,
image_url              text,
lat                    numeric(8,6),
lng                    numeric(9,6),
raw                    jsonb,                     -- store the full Firecrawl JSON here
first_seen             timestamptz default now(),
last_seen              timestamptz default now(),
active                 boolean default true,
unique (source, source_ref)
```

RLS: staff read, admin write; service role bypasses. The scraper writes via
`createServiceClient()` — no user session needed for the Vercel cron path.

### Existing cron shape

`vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/sources/dream/refresh",
      "schedule": "0 3 * * *"
    },
    {
      "path": "/api/muni/import",
      "schedule": "0 4 * * 1"
    }
  ]
}
```

Property24 refresh will be a third entry. Weekly (Mondays 05:00 UTC =
07:00 SAST) balances freshness vs Firecrawl spend.

### Firecrawl API essentials

Docs: https://docs.firecrawl.dev

- Auth: `Authorization: Bearer $FIRECRAWL_API_KEY`
- Base URL: `https://api.firecrawl.dev/v1`
- Two relevant endpoints:
  - `POST /scrape` — single URL, returns markdown / HTML / structured extract
  - `POST /crawl` — asynchronous multi-page crawl (polling required)
- The `formats: ['extract']` mode with a JSON schema returns LLM-parsed
  structured data. Costs more than plain markdown scrape.
- Rate limits vary by plan; free tier is ~5 req/min; paid starts higher.
  Executor should confirm the current plan with Simon before running any
  full crawl.

### Property24 URL structure

Search results:
`https://www.property24.com/for-sale/knysna/western-cape/468`
(paginated via `?Page=2`, `?Page=3` ...)

Detail page:
`https://www.property24.com/for-sale/<slug>/<suburb>/knysna/<listing_id>`
where `<listing_id>` is the source_ref we store.

### Dream design language + POPIA

The map render is entirely handled by `app/map/MapView.tsx` — this plan
touches NO map code. New Property24 pins will render automatically once
the rows exist in `external_listing`.

POPIA: Property24's public site displays agency and listing info but not
owner PII. The scraper allow-lists only the fields in the `external_listing`
schema above — do NOT extract owner names, phone numbers, or private
correspondence even if the LLM extract mode returns them incidentally.

## Repo conventions to honor

- Migration files: `supabase/migrations/NNNN_short.sql`, idempotent, opens
  with a comment block explaining the change. Next number is `0044` (0043
  is claimed by plan 002 — check `ls supabase/migrations/` after 002 lands
  and increment if needed).
- API route pattern: `app/api/<domain>/<action>/route.ts`, export `POST` for
  cron-triggered work + `GET` for read-only inspection where useful.
- Service-role helper: `import { createServiceClient } from "@/lib/supabase/service"`.
- `constantTimeEq` for bearer token comparison — copy the shape from
  `app/api/sources/dream/refresh/route.ts:802-806`. Do NOT `===` compare
  secrets.
- Env vars: read directly via `process.env.FIRECRAWL_API_KEY`, `process.env.CRON_SECRET`.
- Structured logging: use `console.log` prefixed with `[property24]` for
  info, `console.error` for failures. Matches `[muni]`, `[intake]`, `[dream]`
  conventions in the codebase.
- Timeouts: existing scrapers use `AbortController` for per-request caps
  (see the `dream/refresh` route for the pattern).

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |
| Lint      | `npm run lint`      | exit 0              |
| Build     | `npm run build`     | exit 0 (accept `/login` prerender warning) |
| Env       | Add `FIRECRAWL_API_KEY` to Vercel + `.env.local` | Vercel dashboard confirms |
| Migration | Apply new SQL via Supabase Studio                | Query returns success |
| Smoke     | `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://dreamproperties.app/api/sources/property24/refresh` | returns `{ ok: true, ... }` |

## Scope

**In scope** (create or modify only these):

- `app/api/sources/property24/refresh/route.ts` (create) — the endpoint
- `lib/external-listings/property24.ts` (create) — Firecrawl client + parsing helpers
- `vercel.json` — add the third cron entry
- `.env.example` — document `FIRECRAWL_API_KEY` (also add the four missing vars from the audit's housekeeping bundle: `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `OPENROUTER_API_KEY` — one-line-each while you're editing this file)
- `app/map/RefreshMuniButton.tsx` — this admin button exists; add a sibling
  `RefreshProperty24Button.tsx` following the same shape, mounted next to
  the Muni refresh button (grep `RefreshMuniButton` for its call sites)

**Out of scope** (do NOT touch):

- `app/map/MapView.tsx` — no map changes; new pins render via existing
  external_listing rendering
- `lib/external-listings/dedup.ts` or `lib/external-listings/geocode.ts` —
  reuse as-is; if a bug surfaces in dedup for Property24 rows, that's a
  separate follow-up plan
- The `listing_source` enum — `property24` already exists; no migration needed
  for the enum itself
- `app/api/sources/dream/refresh/route.ts` — the Dream scraper stays exactly
  as it is

## Git workflow

- Branch: `advisor/004-firecrawl-property24`
- Commit style: match repo. Suggest 3 commits: (1) library + route, (2) cron
  + env, (3) admin refresh button. Keeps review scoped.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Establish Firecrawl auth + prove scrape works

**Manual pre-work Simon must complete before Step 2**:

1. Sign up at firecrawl.dev, obtain an API key.
2. Add `FIRECRAWL_API_KEY` to Vercel env (Production + Preview + Development).
3. Add the same key to local `.env.local` for dev testing.

**Executor sanity check** (curl from your dev machine):

```
curl -X POST https://api.firecrawl.dev/v1/scrape \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.property24.com/for-sale/knysna/western-cape/468",
    "formats": ["links", "markdown"]
  }'
```

Expected: `200` with a JSON body containing `data.links[]` (array of URLs)
and `data.markdown` (page content). If this fails, STOP and escalate — the
whole plan blocks on Firecrawl reachability.

### Step 2: Create `lib/external-listings/property24.ts`

A pure library — no Supabase access, no side effects. Exports two functions:

- `scrapeListingIndex(cityUrl: string): Promise<string[]>` — returns the
  set of detail-page URLs found on the paginated Knysna sales index
- `scrapeListingDetail(url: string): Promise<Property24Listing | null>` —
  scrapes one detail page and returns a normalised object (or null if the
  page has been delisted / redirects)

Target shape:

```ts
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
  sourceRef: string;       // listing id parsed from URL
  url: string;
  headline: string | null;
  addressRaw: string | null;
  suburb: string | null;
  price: number | null;    // in Rand, integer
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string | null;
  agencyName: string | null;
  imageUrl: string | null;
  lat: number | null;
  lng: number | null;
  raw: unknown;            // full Firecrawl response for later re-parsing
};

async function firecrawlScrape(
  apiKey: string,
  url: string,
  formats: string[],
  extractSchema?: unknown,
): Promise<any> {
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
 * URL shape: https://www.property24.com/for-sale/<slug>/<suburb>/knysna/<id>
 * Returns null if the URL doesn't match the expected shape.
 */
export function parseListingIdFromUrl(url: string): string | null {
  const m = url.match(/\/for-sale\/[^/]+\/[^/]+\/[^/]+\/(\d+)/);
  return m?.[1] ?? null;
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
    let data;
    try {
      data = await firecrawlScrape(apiKey, pageUrl, ["links"]);
    } catch (e) {
      console.error(`[property24] index page ${page} failed:`, (e as Error).message);
      break;
    }
    const links = (data.links ?? []) as string[];
    const detailLinks = links.filter((l) => parseListingIdFromUrl(l) != null);
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
      price: { type: "number", description: "Asking price in Rand as a plain integer, no symbols" },
      bedrooms: { type: "number" },
      bathrooms: { type: "number" },
      property_type: { type: "string", description: "House / Apartment / Estate / Vacant Land / etc." },
      agency_name: { type: "string", description: "The estate agency marketing the listing" },
      image_url: { type: "string", description: "The primary hero image URL" },
      lat: { type: "number" },
      lng: { type: "number" },
    },
  };

  let data;
  try {
    data = await firecrawlScrape(apiKey, url, ["markdown"], schema);
  } catch (e) {
    console.error(`[property24] detail scrape ${sourceRef} failed:`, (e as Error).message);
    return null;
  }

  const extracted = data.extract ?? {};
  return {
    sourceRef,
    url,
    headline: extracted.headline ?? null,
    addressRaw: extracted.address ?? null,
    suburb: extracted.suburb ?? null,
    price: extracted.price != null ? Math.round(Number(extracted.price)) : null,
    bedrooms: extracted.bedrooms != null ? Math.round(Number(extracted.bedrooms)) : null,
    bathrooms: extracted.bathrooms != null ? Math.round(Number(extracted.bathrooms)) : null,
    propertyType: extracted.property_type ?? null,
    agencyName: extracted.agency_name ?? null,
    imageUrl: extracted.image_url ?? null,
    lat: extracted.lat != null ? Number(extracted.lat) : null,
    lng: extracted.lng != null ? Number(extracted.lng) : null,
    raw: data,
  };
}
```

**Verify**:
- `test -f lib/external-listings/property24.ts`
- `npm run typecheck` → exit 0

### Step 3: Create the route handler

Create `app/api/sources/property24/refresh/route.ts`. Model on
`app/api/sources/dream/refresh/route.ts` — same bearer-auth shape, same
constant-time compare, same `createServiceClient`, same upsert-and-sunset
pattern.

Target shape:

```ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scrapeListingIndex, scrapeListingDetail } from "@/lib/external-listings/property24";

export const runtime = "nodejs";
export const maxDuration = 300;

const KNYSNA_INDEX_URL =
  "https://www.property24.com/for-sale/knysna/western-cape/468";
const DETAIL_DELAY_MS = 1000;  // 1/sec; adjust after Firecrawl plan is chosen

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/, "") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (!cronSecret || !constantTimeEq(bearer, cronSecret)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "FIRECRAWL_API_KEY not configured" },
      { status: 500 },
    );
  }

  const startedAt = Date.now();
  const supabase = createServiceClient();

  // 1. Discover: walk the paginated Knysna index, collect detail URLs.
  console.log("[property24] discovering listings...");
  const detailUrls = await scrapeListingIndex(apiKey, KNYSNA_INDEX_URL);
  console.log(`[property24] found ${detailUrls.length} detail URLs`);

  // 2. Scrape each detail with a polite delay between calls.
  const seenSourceRefs: string[] = [];
  let ok = 0;
  let failed = 0;
  for (const url of detailUrls) {
    const listing = await scrapeListingDetail(apiKey, url);
    if (!listing) {
      failed++;
      continue;
    }
    seenSourceRefs.push(listing.sourceRef);

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("external_listing")
      .upsert(
        {
          source: "property24",
          source_ref: listing.sourceRef,
          url: listing.url,
          headline: listing.headline,
          address_raw: listing.addressRaw,
          suburb: listing.suburb,
          price: listing.price,
          bedrooms: listing.bedrooms,
          bathrooms: listing.bathrooms,
          property_type: listing.propertyType,
          agency_name: listing.agencyName,
          image_url: listing.imageUrl,
          lat: listing.lat,
          lng: listing.lng,
          raw: listing.raw,
          last_seen: now,
          active: true,
        },
        { onConflict: "source,source_ref" },
      );
    if (error) {
      console.error(`[property24] upsert ${listing.sourceRef} failed:`, error.message);
      failed++;
    } else {
      ok++;
    }

    await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
  }

  // 3. Sunset: mark any property24 row not seen this run as inactive.
  if (seenSourceRefs.length > 0) {
    const { error: sunsetErr } = await supabase
      .from("external_listing")
      .update({ active: false })
      .eq("source", "property24")
      .not("source_ref", "in", `(${seenSourceRefs.map((s) => `"${s}"`).join(",")})`);
    if (sunsetErr) {
      console.error("[property24] sunset failed:", sunsetErr.message);
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log(`[property24] done: ok=${ok} failed=${failed} in ${durationMs}ms`);
  return NextResponse.json({
    ok: true,
    discovered: detailUrls.length,
    upserted: ok,
    failed,
    durationMs,
  });
}
```

**Verify**:
- `test -f app/api/sources/property24/refresh/route.ts`
- `npm run typecheck` → exit 0

### Step 4: Add the cron entry

Edit `vercel.json` — add a third crons entry. Schedule Monday 05:00 UTC
(07:00 SAST — before Bronwyn opens the app for the week):

```json
{
  "crons": [
    { "path": "/api/sources/dream/refresh", "schedule": "0 3 * * *" },
    { "path": "/api/muni/import", "schedule": "0 4 * * 1" },
    { "path": "/api/sources/property24/refresh", "schedule": "0 5 * * 1" }
  ]
}
```

**Verify**:
- `grep -c "property24/refresh" vercel.json` → 1

### Step 5: Update `.env.example`

Add `FIRECRAWL_API_KEY` plus the four missing vars flagged in the audit
(one-line-each). This is the whole "housekeeping bundle" .env sub-item
resolved as a side-effect of this plan. Append below the existing three
vars:

```
# Property24 scraper (Firecrawl)
FIRECRAWL_API_KEY=your-firecrawl-api-key

# Cron auth (Vercel-triggered endpoints)
CRON_SECRET=your-cron-secret

# Resend inbound email webhook
RESEND_API_KEY=your-resend-api-key
RESEND_WEBHOOK_SECRET=your-resend-webhook-signing-secret

# OpenRouter (classify / extract / OCR)
OPENROUTER_API_KEY=your-openrouter-api-key
OPENROUTER_MODEL=openai/gpt-4o-mini
```

**Verify**:
- `grep -c "FIRECRAWL_API_KEY\|CRON_SECRET\|RESEND_API_KEY\|RESEND_WEBHOOK_SECRET\|OPENROUTER_API_KEY" .env.example` → ≥ 5

### Step 6: Add the admin "Refresh Property24" button

Copy `app/map/RefreshMuniButton.tsx` to `app/map/RefreshProperty24Button.tsx`
and adapt: button label "Refresh Property24", `fetch` posts to
`/api/sources/property24/refresh`, same authorization pattern (the button
lives in the admin UI, uses the user's session — the bearer auth on the
route is for cron; admin session works too, IF the route accepts both).

**Wait** — the route above only accepts CRON bearer. To also let an admin
trigger it, add a session-based fallback: after the constant-time compare
fails, if the request has a valid user session with role `admin`, allow the
call. Update Step 3's route by inserting between the bearer check and the
Firecrawl-key check:

```ts
if (!cronSecret || !constantTimeEq(bearer, cronSecret)) {
  // Fallback: allow admin sessions to trigger a manual refresh.
  const { createClient } = await import("@/lib/supabase/server");
  const authed = createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }
  const { data: profile } = await authed
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile?.active === false) {
    return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });
  }
}
```

(Cross-check `RefreshMuniButton.tsx` for its exact dual-auth pattern — if
Muni uses a different fallback shape, match that instead.)

Then mount `<RefreshProperty24Button />` next to `<RefreshMuniButton />` in
whatever page hosts them (grep `RefreshMuniButton` for the mount site).

**Verify**:
- `test -f app/map/RefreshProperty24Button.tsx`
- `grep -c "RefreshProperty24Button" app/map/` → ≥ 2 (component + mount)

### Step 7: End-to-end smoke test

**Manual, with Simon's help** — costs Firecrawl credits, so do this ONCE:

1. Deploy the branch to a Vercel preview.
2. Confirm `FIRECRAWL_API_KEY` is set in Vercel Preview env.
3. Curl the endpoint with the cron bearer:
   ```
   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
     https://<preview-url>/api/sources/property24/refresh
   ```
4. Expected response: `{ ok: true, discovered: N, upserted: M, failed: F, durationMs: T }`
   where N ~= 200-400 for the Knysna area.
5. Query the DB (via Studio):
   ```sql
   select count(*) from external_listing where source = 'property24' and active = true;
   ```
   Expected: > 100 rows.
6. Reload `/map` (Preview URL). Expected: new pins appear in Knysna area.
   Existing Dream-matched pins should not be affected.

If the smoke test fails at any step, STOP and report — do not attempt to
"fix by trying again" (each retry costs Firecrawl credits).

### Step 8: Commit and update the index

Three commits, keeps the diff reviewable:

Commit A:
```
Property24: Firecrawl scraper library

New lib/external-listings/property24.ts scrapes Property24's Knysna
sales index and each detail page via the Firecrawl API. Pure library —
no Supabase writes here; the route handler orchestrates persistence.

Uses Firecrawl's extract mode with an explicit JSON schema (headline,
address, suburb, price, beds, baths, agency, image, lat, lng). POPIA-
compliant: owner names and contact info are never requested even if
visible on the page.

Rate-disciplined: 700ms between index pages, 1s between detail scrapes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Commit B:
```
Add /api/sources/property24/refresh + weekly cron

Route handler upserts to external_listing on (source, source_ref),
sunsets rows not seen in the current run. Bearer-auth via CRON_SECRET
for the scheduled run; admin-session fallback so the /map admin button
can trigger a manual refresh.

vercel.json cron: Monday 05:00 UTC (07:00 SAST — before Bronwyn opens
the app for the week).

FIRECRAWL_API_KEY must be set in Vercel env (Production + Preview).
Also documenting the four other server env vars in .env.example.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Commit C:
```
Map: admin "Refresh Property24" button

Sibling to RefreshMuniButton on the map admin controls. Same dual-auth
shape (bearer for cron; admin session for manual).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Update `plans/README.md`: change 004's status from `TODO` to `DONE`. Add a
one-line note if Firecrawl API isn't yet enabled ("Waiting on
FIRECRAWL_API_KEY in Vercel prod env before first cron fires").

## Test plan

No test infra. Verification:

1. Typecheck + lint + build pass.
2. Manual curl to the Preview URL confirms the endpoint returns ok:true
   with discovered > 100 (Step 7).
3. `select count(*) from external_listing where source='property24' and active=true`
   returns > 100 (Step 7).
4. `/map` visually shows new Property24 pins in the Knysna area.

Follow-up (when vitest lands): unit-test `parseListingIdFromUrl` (happy
path + malformed URLs), unit-test the response shape from a mocked
Firecrawl `/scrape` call.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0 (accept `/login` prerender warning)
- [ ] `test -f lib/external-listings/property24.ts`
- [ ] `test -f app/api/sources/property24/refresh/route.ts`
- [ ] `test -f app/map/RefreshProperty24Button.tsx`
- [ ] `grep -c "property24/refresh" vercel.json` → 1
- [ ] `grep -c "FIRECRAWL_API_KEY" .env.example` → 1
- [ ] Post-deploy smoke returns `{ ok: true, discovered: >0, upserted: >0 }`
- [ ] `git diff --stat` shows only in-scope files touched
- [ ] `plans/README.md` status row for 004 is `DONE`

## STOP conditions

Stop and report back (do not improvise) if:

- `FIRECRAWL_API_KEY` isn't available at typecheck / build time (put it in
  `.env.local`) or at smoke-test time (put it in Vercel Preview env). Do
  NOT hardcode.
- The `listing_source` enum in the schema doesn't include `property24` —
  check `supabase/migrations/0025_external_listing.sql:18-22`. If missing,
  a new migration is needed (out of this plan's scope — report first).
- Firecrawl returns a non-200 for the initial curl (Step 1) — could be
  auth, plan limit, or network. Diagnose before coding.
- Property24's URL structure has changed and `parseListingIdFromUrl` returns
  null for every discovered link — update the regex OR report the new shape.
- The Firecrawl detail scrape returns empty `extract` objects consistently
  — the LLM extraction may need prompt tuning or a different schema shape.
- The scrape run exceeds the 300s Vercel function ceiling — Property24
  Knysna has more listings than expected. Add batching (e.g. process 50
  per run, use a `cursor` param) instead of removing rate limits.
- `RefreshMuniButton.tsx` uses a totally different auth pattern than
  described — mirror the actual pattern rather than inventing one.

## Maintenance notes

For the reviewer and future maintainers:

- Firecrawl spend is the main ongoing cost. Monitor via Firecrawl dashboard;
  ~400 scrapes/week ≈ 1600/month. If cost is an issue, drop to bi-weekly or
  use their crawl-with-caching feature.
- If Property24 detects the scraper and blocks (rate limit / CAPTCHA), the
  discovery pages will start returning empty. Add a User-Agent header via
  Firecrawl's options if that becomes an issue.
- The dedup step (`lib/external-listings/dedup.ts`) already handles the
  case of a Property24 listing matching a Dream listing on the same erf —
  the map will merge those pins automatically. If a listing consistently
  fails to match, check whether it has coords and whether the dedup radius
  in that helper is sensitive to Knysna's dense clusters.
- **Explicit follow-ups deferred out of this plan**:
  - Private Property scraper (same pattern; separate plan when needed)
  - Property24 Sedgefield / Plett area URLs (extend `KNYSNA_INDEX_URL` to
    an array of area URLs when the geographic scope broadens)
  - Firecrawl `/crawl` endpoint (async, better for big crawls but requires
    polling — worth exploring if the Knysna area grows past ~500 listings)
  - Ingest Property24 message-based leads (enquiries sent through their
    portal → separate integration, likely via portal partner API)
