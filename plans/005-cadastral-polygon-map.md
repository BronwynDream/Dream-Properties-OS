# Plan 005: Replace map pins with cadastral polygon shading

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 75e5866..HEAD -- app/map lib/external-listings supabase/migrations`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (assumes migration 0044 already applied)
- **Category**: direction
- **Planned at**: commit `75e5866`, 2026-07-26

## Why this matters

Simon flagged that pin-based rendering breaks down as market coverage grows —
overlap, label collisions, no property-shape information. Dream has a real
cadastre bridge (`cadastral_parcel` table + vector tiles serving the erf
polygons), so the map can show every for-sale property as its actual polygon
footprint, colour-coded by mandate/source. Distinctive, matches the "Registry
Stamp / --paper" design language already established, unique to Dream.

Design decisions locked (2026-07-26):

- **Fill by mandate for OS properties**, neutral grey wash for externals
- Fill opacity ~35%, outline at 100%
- **Ungeocoded externals** (no `prcl_key`) render as small discreet dots
  at lat/lng, no price label
- Zoom behaviour: polygons visible from z≥14 (matches existing erf-boundary
  toggle); below z14 the polygons vanish and only the discreet dots + Dream
  OS pins visible (this plan does NOT rebuild the low-zoom cluster view)

Colour scheme:

| State | Fill | Outline |
|---|---|---|
| Dream Exclusive | gold `#C8A032` | gold `#C8A032` |
| Dream Joint | navy `#132B84` | navy `#132B84` |
| Dream Sold | forest `#1C5B3A` | forest `#1C5B3A` |
| Dream Under Offer | amber `#D17E22` | amber `#D17E22` |
| Dream Sole / Open / None | slate `#6B78A0` | slate `#6B78A0` |
| P24 / Private Property market | grey `#8090B5` | grey `#8090B5` |

## Current state

### Schema (from migration 0029)

`external_listing.prcl_key text` — column exists but is empty for scraped
rows. Same nullable column on `property` — populated by migration 0039's
`trg_erf_snap_property` trigger when an erf is attached.

`cadastral_parcel` has:
- `prcl_key text primary key`
- `geom geometry(MultiPolygon, 4326)` (with GIST index)
- `centroid geometry(Point, 4326)` (with GIST index)

The vector tile route `/api/tiles/parcels/[z]/[x]/[y]` serves `parcel_mvt`,
which encodes `prcl_key`, `parcel_no`, and `tag_value` as feature properties.

### MapView today

`app/map/MapView.tsx` (1461 lines). Reads:

- lines 340-395: `installErfLayer` — adds the vector source `parcels` and
  three layers (`parcels-fill`, `parcels-line`, `parcels-labels`) with
  uniform navy styling + `visibility` gated by the `showErf` prop
- lines 408-415: visibility toggle on `showErf` change
- lines 470-490: `styleClass` mapping for pins by source
- SOURCE_ORDER + SOURCE_META at lines ~94-103: dream_os / dream_website /
  property24 / private_property
- `sourceCounts` (line 236) counts pins visible per source

### Data flow into MapView

Server component `app/map/page.tsx` fetches:
- `property` (with lng, lat, mandate join)
- `listing` (mandate + status)
- `transfer` (status)
- `external_listing` where active=true

Passes into `<MapView properties={...} externals={...} />` — the merge into
`mergedPins` happens client-side.

## Repo conventions to honor

- Migrations: `supabase/migrations/NNNN_short.sql`, idempotent, comment
  block at top. See `supabase/migrations/0042_erf_sg_number.sql` as exemplar.
- Trigger functions: `security invoker set search_path = public, pg_temp`.
  See migration 0039 for the erf-snap trigger pattern.
- No React tests; verification is typecheck + build + manual smoke.
- Design tokens: `--gold #C8A032`, `--navy #132B84`, `--forest #1C5B3A`,
  `--amber #D17E22`. Already in `app/globals.css`.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |
| Build     | `npm run build`     | exit 0 (accept `/login` prerender warning) |
| Migration | Apply via Supabase Studio SQL editor (Simon does) | SQL runs cleanly |

Note: `npm run lint` is a plan-defect no-op — the repo has no ESLint
config. SKIP that criterion.

## Scope

**In scope**:

- `supabase/migrations/0045_external_listing_prcl_snap.sql` (create) — trigger + backfill
- `app/map/page.tsx` — extend property + external queries to fetch `prcl_key`; compute forSalePolygons prop
- `app/map/MapView.tsx` — new polygon-fill layer coloured by state; discreet-dot layer for ungeocoded externals; legend update
- `app/globals.css` — minor CSS if legend needs updated swatches

**Out of scope**:

- Low-zoom cluster view (dots at z<14 still handled by the existing pin
  rendering; only *ungeocoded* externals show as discreet dots at all zooms)
- Suburb-level choropleth (a separate future plan)
- Rework of `SOURCE_ORDER` or filter chips — the existing toggles still work
- Sunsetting the existing pin rendering entirely — pins stay for OS
  properties without `prcl_key` (edge case; ~0 rows in practice) and for
  ungeocoded externals (all rendered as discreet dots per design decision)
- Any changes to `/api/sources/property24/refresh` or the scraper library —
  the trigger handles prcl_key assignment; no application-code changes needed

## Git workflow

- Branch: `advisor/005-cadastral-polygon-map`
- Commit style: match repo. Suggest 2 commits: (1) migration + trigger,
  (2) MapView layer + prop wiring.

## Steps

### Step 1: Migration 0045 — auto-assign trigger + backfill

Create `supabase/migrations/0045_external_listing_prcl_snap.sql`:

```sql
-- ============================================================================
-- Dream Knysna OS — 0045 external_listing prcl_key auto-snap
-- ----------------------------------------------------------------------------
-- external_listing.prcl_key was added in 0029 but never populated for scraped
-- rows. Plan 005 uses prcl_key to render for-sale properties as coloured
-- cadastre polygons on /map. This migration:
--   1. Adds a BEFORE INSERT OR UPDATE trigger that snaps each row's lat/lng
--      into the smallest containing cadastral_parcel via ST_Contains, and
--      sets prcl_key. Only runs when lat/lng change AND prcl_key is currently
--      null (respects manual assignments).
--   2. Backfills existing rows in one pass.
-- ============================================================================

create or replace function set_external_listing_prcl_key()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.lat is not null and new.lng is not null and new.prcl_key is null then
    select cp.prcl_key
      into new.prcl_key
      from cadastral_parcel cp
     where ST_Contains(cp.geom, ST_SetSRID(ST_MakePoint(new.lng::float8, new.lat::float8), 4326))
     order by ST_Area(cp.geom) asc
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_external_listing_set_prcl_key on external_listing;
create trigger trg_external_listing_set_prcl_key
  before insert or update of lat, lng on external_listing
  for each row execute function set_external_listing_prcl_key();

comment on function set_external_listing_prcl_key is
  'Snaps external_listing rows to their containing cadastral_parcel via ST_Contains(centroid). Runs on insert/update of lat|lng when prcl_key is null. Idempotent; a manually-assigned prcl_key is never overwritten.';

-- One-shot backfill for rows already in the table with coords but no prcl_key.
-- Safe to re-run; the where-clause skips already-assigned rows.
update external_listing el
   set prcl_key = (
     select cp.prcl_key
       from cadastral_parcel cp
      where ST_Contains(cp.geom, ST_SetSRID(ST_MakePoint(el.lng::float8, el.lat::float8), 4326))
      order by ST_Area(cp.geom) asc
      limit 1
   )
 where el.prcl_key is null
   and el.lat is not null
   and el.lng is not null;
```

**Verify**:
- `test -f supabase/migrations/0045_external_listing_prcl_snap.sql`
- `head -3 supabase/migrations/0045_external_listing_prcl_snap.sql` shows header

**Apply**: Simon runs this in Studio. Do NOT attempt to apply via any CLI.

### Step 2: Extend the map's server-component data fetch

In `app/map/page.tsx`:

1. Include `prcl_key` in the property + external_listing `.select()` clauses.
2. Build a new `forSalePolygons` array shaped as:

```ts
type ForSalePolygon = {
  prclKey: string;
  state: "os_exclusive" | "os_joint" | "os_sold" | "os_under_offer" | "os_other" | "market";
  propertyId?: string;   // OS side, when applicable
  listingId?: string;    // OS or external
  price?: number;
  headline?: string;
};
```

State derivation:
- OS property: read the latest listing.mandate.type + listing.status + transfer.status
  - `status='registered'` → `os_sold`
  - `status='under_offer'` (or listing.status='under_offer') → `os_under_offer`
  - mandate exclusive → `os_exclusive`
  - mandate joint → `os_joint`
  - otherwise → `os_other`
- External (property24, private_property): `market`

Fetch only rows with `prcl_key IS NOT NULL`. Rows without `prcl_key` become
the ungeocoded set — build a separate `ungeocoded` array for the fallback dots:

```ts
type UngeocodedExternal = {
  id: string;
  source: "property24" | "private_property";
  lng: number;
  lat: number;
  price: number | null;
  headline: string | null;
};
```

Pass both new arrays into `<MapView forSalePolygons={...} ungeocoded={...} />`.

**Verify**:
- `grep -c "forSalePolygons" app/map/page.tsx` → ≥ 2
- `grep -c "ungeocoded" app/map/page.tsx` → ≥ 2
- `npm run typecheck` → exit 0

### Step 3: MapView — new polygon-fill layer for for-sale properties

In `app/map/MapView.tsx`:

1. Accept the new props on the component: `forSalePolygons: ForSalePolygon[]`,
   `ungeocoded: UngeocodedExternal[]`.

2. In the `installErfLayer` effect (line 340-ish), ADD a new layer called
   `for-sale-fill` BELOW `parcels-line` (so line stays on top). Also add
   `for-sale-outline`. Bind them to the existing `parcels` vector source:

```tsx
// State → color lookup. Kept as a plain object so the Mapbox 'match'
// expression can flatten it into pairs at layer-install time.
const STATE_COLORS: Record<string, string> = {
  os_exclusive:  "#C8A032",
  os_joint:      "#132B84",
  os_sold:       "#1C5B3A",
  os_under_offer:"#D17E22",
  os_other:      "#6B78A0",
  market:        "#8090B5",
};

// Build the match expression: [ "match", ["get","prcl_key"],
//   key1, color1, key2, color2, ..., defaultColor ]
const buildMatchExpr = (rows: ForSalePolygon[]): mapboxgl.Expression => {
  const pairs: (string | number)[] = [];
  for (const r of rows) {
    pairs.push(r.prclKey, STATE_COLORS[r.state] ?? STATE_COLORS.os_other);
  }
  // Fallback color; only reached if a prcl_key in the filter list isn't
  // in our lookup (shouldn't happen because filter mirrors the same list).
  return ["match", ["get", "prcl_key"], ...pairs, "#8090B5"] as mapboxgl.Expression;
};
```

Filter: only prcl_keys in `forSalePolygons`. Use an `["in", ["get","prcl_key"], ["literal", [key1, key2, ...]]]` expression.

Layer paint:

```tsx
m.addLayer({
  id: "for-sale-fill",
  type: "fill",
  source: "parcels",
  "source-layer": "parcels",
  minzoom: 14,
  filter: ["in", ["get", "prcl_key"], ["literal", forSalePolygons.map(r => r.prclKey)]],
  paint: {
    "fill-color": buildMatchExpr(forSalePolygons),
    "fill-opacity": 0.35,
  },
}, "parcels-line");  // insert BEFORE the outline layer so line renders above fill

m.addLayer({
  id: "for-sale-outline",
  type: "line",
  source: "parcels",
  "source-layer": "parcels",
  minzoom: 14,
  filter: ["in", ["get", "prcl_key"], ["literal", forSalePolygons.map(r => r.prclKey)]],
  paint: {
    "line-color": buildMatchExpr(forSalePolygons),
    "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1.5, 18, 3],
    "line-opacity": 1.0,
  },
});
```

These layers are ALWAYS visible (they're the primary rendering). The existing
`parcels-fill`/`parcels-line`/`parcels-labels` continue to gate on the
`showErf` toggle for the "all erf boundaries" view — leave that untouched.

3. Wire click behaviour on the `for-sale-fill` layer so clicking a polygon
   shows the same popover as clicking a pin does today. Use
   `map.on("click", "for-sale-fill", handler)` — inspect `e.features[0].properties.prcl_key`,
   look up the corresponding `ForSalePolygon` (map keyed by prclKey), open
   the existing preview panel with that row's data.

4. Also add cursor change on hover:
   ```tsx
   map.on("mouseenter", "for-sale-fill", () => { map.getCanvas().style.cursor = "pointer"; });
   map.on("mouseleave", "for-sale-fill", () => { map.getCanvas().style.cursor = ""; });
   ```

**Verify**:
- `grep -c "for-sale-fill" app/map/MapView.tsx` → ≥ 3
- `grep -c "for-sale-outline" app/map/MapView.tsx` → ≥ 2
- `grep -c "STATE_COLORS" app/map/MapView.tsx` → ≥ 1
- `npm run typecheck` → exit 0

### Step 4: Ungeocoded externals as discreet dots

For externals with lat/lng but no prcl_key: render as small circular dots,
no price label, subtle colour.

Add a GeoJSON source + circle layer:

```tsx
if (!m.getSource("ungeocoded-externals")) {
  m.addSource("ungeocoded-externals", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: ungeocoded.map((u) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [u.lng, u.lat] },
        properties: { id: u.id, source: u.source, price: u.price, headline: u.headline },
      })),
    },
  });
  m.addLayer({
    id: "ungeocoded-dots",
    type: "circle",
    source: "ungeocoded-externals",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 6],
      "circle-color": "#8090B5",
      "circle-opacity": 0.5,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#132B84",
      "circle-stroke-opacity": 0.6,
    },
  });
}
```

Click behaviour: same as polygons — open the preview popover with the
listing's headline + price + source-link.

**Verify**:
- `grep -c "ungeocoded" app/map/MapView.tsx` → ≥ 3
- `grep -c "ungeocoded-dots" app/map/MapView.tsx` → ≥ 1

### Step 5: Hide the old pin rendering for polygon-covered properties

Today's pin rendering (mergedPins → symbol layer) will double-plot every
polygon-covered property. Two options; pick the cleaner one:

- **Option A (recommended)**: filter `mergedPins` so pins are only drawn
  for OS properties WITHOUT a `prcl_key`. That's the ~0 edge case; effectively
  removes all pin duplication. Ungeocoded externals get their circle layer
  from Step 4 instead of a pin.
- **Option B**: keep pins but reduce their z-index so polygons render on
  top. Messier — pins still visible around polygon edges.

Take Option A. Find where `mergedPins` is passed to the symbol layer;
add a filter:

```tsx
const pinnedPins = useMemo(
  () => mergedPins.filter((p) => !p.our?.prclKey && !p.externals.some((e) => !!e.prclKey)),
  [mergedPins]
);
```

Then use `pinnedPins` where the old code uses `mergedPins` for the symbol
layer rendering. Preview panel + list rail keep using `mergedPins` — they
need every listing regardless of render style.

**Verify**:
- `grep -c "pinnedPins" app/map/MapView.tsx` → ≥ 2
- `npm run typecheck` → exit 0

### Step 6: Update the map legend

Legend today (visible in the screenshot: Exclusive, Joint, None, Dream website,
Market only) needs to swap "Dream website" and "Market only" entries for the
new polygon states:

- gold ▓ Exclusive
- navy ▓ Joint
- forest ▓ Sold
- amber ▓ Under Offer
- slate ▓ Sole / Open / None
- grey ▓ Market (P24 / Private Property)
- grey ○ Market — location only

Find the legend block in MapView (grep `Exclusive` inside JSX). Update swatches
to match STATE_COLORS. Keep the ○ dot legend entry for ungeocoded externals.

**Verify**:
- Legend renders with 6 fill entries + 1 dot entry.
- `npm run build` → exit 0 (accept `/login` prerender warning)

### Step 7: Commit + hand off

Two commits:

Commit A:
```
Add migration 0045: external_listing prcl_key auto-snap trigger

New BEFORE INSERT|UPDATE trigger on external_listing that snaps each
row to its containing cadastral_parcel via ST_Contains, and sets
prcl_key. Only fires when lat/lng change AND prcl_key is null.

One-shot backfill for existing rows with coords but no prcl_key.

Migration 0045 must be applied manually via Supabase Studio.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Commit B:
```
Map: cadastral polygon shading replaces pins for for-sale properties

Every for-sale property (OS + externals with prcl_key bridge) now
renders as its actual erf polygon on the cadastre tiles, filled by
mandate/source:
  gold Exclusive · navy Joint · forest Sold · amber Under Offer
  · slate Sole/Open · grey Market
Fill opacity ~35%, outline at 100%. Visible from z≥14.

Ungeocoded externals (no prcl_key) render as small discreet dots at
lat/lng, no price label. Click opens the same preview as a polygon.

The existing "Erf boundaries" toggle stays untouched — its uniform
navy shading is a separate layer at z≥14.

Depends on migration 0045 (auto-snap trigger).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0 (accept `/login` prerender warning)
- [ ] `test -f supabase/migrations/0045_external_listing_prcl_snap.sql`
- [ ] `grep -c "for-sale-fill" app/map/MapView.tsx` → ≥ 3
- [ ] `grep -c "ungeocoded-dots" app/map/MapView.tsx` → ≥ 1
- [ ] `grep -c "STATE_COLORS\\|forSalePolygons" app/map/MapView.tsx app/map/page.tsx` → ≥ 4
- [ ] `git diff --stat` shows only in-scope files touched
- [ ] `plans/README.md` status row for 005 is `DONE` (or executor skipped update, reviewer maintains)

## STOP conditions

Stop and report back (do not improvise) if:

- `external_listing.prcl_key` column doesn't exist (should from 0029). Check
  migrations dir.
- `cadastral_parcel` table doesn't exist (should from 0028) — a hard block;
  full cadastre stack must be in place first.
- The vector-tile route `/api/tiles/parcels/[z]/[x]/[y]` doesn't render
  `prcl_key` in the MVT feature properties — verify by inspecting
  `parcel_mvt` SQL function.
- `mergedPins` structure has been refactored in a way that breaks the
  `pinnedPins` filter (e.g. no `our` field). Report and pause.
- The `match` expression exceeds Mapbox's limit (~1000 entries). At Dream's
  scale (~500 for-sale total) this shouldn't trigger, but flag if it does —
  might need to switch to a feature-state approach.

## Maintenance notes

For the reviewer + future maintainers:

- The polygon layer is filtered by prcl_key list — if the set grows past
  ~1000 keys, Mapbox `match` expressions get slow to compile. At that scale,
  switch to `setFeatureState` per polygon (attaches a state to a feature
  matching by ID, cheap at any scale).
- The trigger silently no-ops when a listing is outside the imported
  cadastre. Knysna + George are imported; Sedgefield inland or Plett would
  fail to snap and stay as ungeocoded dots. Fine for v1.
- If you want low-zoom cluster rendering later (currently pins disappear
  entirely below z14), Mapbox's cluster feature on the `ungeocoded-externals`
  source is one place to start — but polygons at low zoom just aren't legible,
  so a suburb-choropleth layer (plan 006 material) is the better long-term
  answer.
- The legend + STATE_COLORS need to stay in sync — if a mandate type is
  added or renamed, both places need updating.
