# Dream Knysna OS — project state

Running log of what's decided, built, and next. Updated at the end of each working
session. `PROJECT.md` remains the canonical business/design doc; this file is the
"where are we right now" companion.

_Last updated: 2026-08-05_

---

## DOCUMENT VAULT — STATUS READ + TWO CORRECTIONS (2026-08-06)

Simon asked where the document vault stands and how agents reach documents,
mandates and templates. Answering it properly surfaced two things worth
carrying forward.

### Honest status of the vault
There is a document **viewer** attached to the Property Record and a mandate
**printer** that stores nothing. There is no vault.

- **Ways in, all four via a property**: Property Record → Documents section
  (grouped per transfer, 1-hour signed URLs); Property Record → Prepare
  mandate → editor → browser print; `/triage` (the ingestion path that
  actually creates `document` rows); `/mandates` (mandate data rows, not
  documents).
- **No nav entry.** Records = Properties / Map / Contacts / Erf Lookup /
  Estates. Deals = Mandates / Pipeline / Viewings / Compliance. Admin =
  Triage / Dupes / Team / Settings. No Documents anywhere, and
  `app/documents/` has no `page.tsx` — it is a folder of shared components,
  so `/documents` would 404.
- **Nothing generated is kept.** Saving a mandate writes a `mandate` row only.
  No `document` row, no file, no version. "What did we send the Wilsons in
  March" is unanswerable from the OS.
- Pre-promotion commits (7 The Grove, Plot A4, Oupad) have no `document` rows,
  so their files exist but don't show. Everything still lives in the `staging`
  bucket rather than `documents` / `fica`.

### Template count, settled
Thirteen files from Bronwyn reduce to **eight generative templates plus one
annexure**: three property mandates (Exclusive/Sole, Joint, Open), Business
mandate, two sale agreements (house, plot), movables, addendum (the plain and
&-movables versions are one template with a toggle), and the PPRA disclosure
as a shared annexure with house/plot question sets. The two letterhead files
aren't templates — that's `DocumentPage.tsx`.

### Correction 1 — Sole IS Exclusive at Dream (Simon, 2026-08-06)
Flagged as a possible discrepancy because `MandateSole.tsx` prints the heading
"SOLE MANDATE" over a clause granting "an EXCLUSIVE MANDATE", and because SA
practice often distinguishes them. Simon: they are the same thing at Dream.
Not a defect. **But `mandate.type` carries both `sole` and `exclusive` as
separate enum values for one concept**, so a mandate saved under either is
invisible to a filter on the other — `/mandates` and the expiry watchlist can
both undercount. Consolidate on `exclusive` after checking production:
`select type, count(*) from mandate group by type order by 2 desc;`

### Correction 2 — the one existing template came from the wrong document
`MandateSole.tsx`'s own header: *"Structure follows Bronwyn's Business Mandate
template ... adapted for a residential / land sale. When Bronwyn ships a real
property-mandate .docx template, we adjust the clause language here in-place."*
It was a placeholder built from the **business-sale** contract while waiting
for the real masters. Those arrived 2026-08-04. Its wording is not Bronwyn's,
so replace it wholesale from
`docs/templates/dream-properties-exclusive-mandate-template.md` — editing it
clause by clause would just be guessing which lines happen to match.

### Also flagged
Schema has a `lease` agreement type but Bronwyn sent no lease or rental
template. Either a missing document or a dead enum value — ask.

### Next session starts here
1. Apply migration 0065 to Bon Bon (still not applied).
2. `select type, count(*) from mandate group by type;` then consolidate
   sole → exclusive.
3. Seed the clause library from `docs/templates/`, verbatim.
4. `lib/documents/resolve.ts`, then the `/documents` hub, entry points,
   editor, PDF.

Still needed from Bronwyn: her wording for a VAT-inclusive commission clause
(her masters only have "plus VAT thereon"), and whether the PPRA condition
report is a shared annexure or stays inside the Open mandate.

---

## DOCUMENT ENGINE — PLAN 007 + MIGRATION 0065 (2026-08-05, evening)

Bronwyn emailed thirteen master templates on 2026-08-04. Simon asked for a
documents section wired through from the other pages, with automatic fill or
an AI interview depending on how the agent arrives.

### Decisions locked with Simon
- **Output**: editable inside the OS, PDF only at finalisation. Not a DOCX
  round-trip — that would let someone edit offline and bypass the clause logic.
- **First slice**: mandates only, all four (Sole exists; Exclusive, Open, Joint
  to build). Business Mandate excluded — it sells a business, not a property.
- **Interview**: hybrid. Deterministic questions for the clause toggles the
  masters already enumerate; AI only for drafting free-text suspensive
  conditions, and it must propose from the clause library before writing new.
- **Template storage**: three layers — skeleton in code, clause bodies in the
  database, field values per document. Simon asked for a recommendation here;
  the deciding factor was his clause-library plan (Bronwyn keeps suspensive
  variants by entity type, and he intends to AI-extract more from past
  contracts). Dozens of variants per slot is a table, not a deploy.

### Domain correction worth keeping
**There is no separate Offer to Purchase.** The Agreement of Sale IS the offer
— clause 13 of Bronwyn's master makes the first signature an irrevocable offer
until accepted. One document, two signature stages, not two documents. Simon
had assumed two.

### Shipped (`c35c279`)
- `plans/007-document-engine.md` — architecture, fill-source rule (record →
  derived → asked), entry-point context table, interview split, learning loop,
  PDF recommendation with the rejected alternative and why.
- `supabase/migrations/0065_document_engine.sql` — clause, clause_variant,
  doc_template, doc_template_slot, document_draft; typed asking_price /
  commission_pct / commission_incl_vat / term_months on mandate (Phase 1
  concatenated these into `mandate.notes` as a string).
  `clause_variant.source` separates verbatim-from-master / agent-edit /
  ai-extracted / manual, and AI-extracted variants start `approved = false` so
  they cannot reach a binding document unread.
- `docs/templates/` — extracted text of all nine text-bearing masters. The
  clause library seeds from these verbatim.

### Audit findings on Phase 1 (worth knowing before extending it)
The existing mandate flow writes a `mandate` row only. It never creates a
`document` or `document_link` row, never uploads a file, and `mandate.document_id`
stays null — `actions.ts` flags this as intended Phase 2 work. Rendering is
React→HTML with a print stylesheet in `DocumentPage.tsx`; there is no PDF
engine in the repo at all.

### Next
- Seed the clause library from `docs/templates/`, clause by clause, verbatim.
- `lib/documents/resolve.ts` — the fill resolver.
- `/documents` hub + entry points + draft editor.
- PDF: `puppeteer-core` + `@sparticuz/chromium`, isolated behind
  `lib/documents/render.ts` so it can be swapped if the Vercel bundle complains.

### Open for Bronwyn (in the plan)
Commission default (5% hardcoded in Exclusive and Open, blank in Joint);
default mandate term per type; and whether the PPRA condition report appended
to the Open mandate should be a shared annexure any mandate can attach —
`lib/ppraDisclosure.ts` already models the questions, so it wants to be shared.

### Verification
SQL parse-checked with pglast (42 statements); every referenced table resolves
to an earlier migration. **Migration not applied to Bon Bon yet.**

---

## DEDUP OVER-MERGE: FALLBACK COORDINATES (2026-08-05, later)

Found during the browser verification of the source-chip fix, which is
how it should work. Simon turned DW on, clicked a pin, and got a
"market listing" panel offering eight other listings priced R895k to
R60M as the same property.

### The diagnosis (three queries, two wrong guesses)
First guess was centroid-collapsed coords — the failure mode already
documented for the WordPress scraper. Wrong: `centroid_rows` came back
0. Second guess was a shared `prcl_key`, Pezula-style. Also wrong: every
`prcl_key` was NULL. The row dump settled it — all nine rows sat on
**-34.067203, 23.064679, identical to six decimal places**, with
`geocode_source = 'exact'`.

Two defects compounding in the geo-proximity rule in
`lib/external-listings/dedup.ts`:

1. **The fallback guard was checking a label the scraper doesn't set
   honestly.** The rule excluded `geocode_source = 'centroid'` rows —
   the author correctly anticipated exactly this problem — but Dream's
   WordPress geocoder returns one fallback point for every address it
   can't resolve and stamps it `exact`. The guard never fired.
2. **The price gate had a null bypass.** `if (a.price != null && b.price
   != null) { ...ratio check... }` then `union()` unconditionally. Two
   price-on-request listings at 0m each unioned with everything present,
   bridging R895k to R60M in a single hop. The 15% ratio never got a say.

### Shipped (`7da34c2`)
- Trust coordinates over labels: a point claimed by more than
  `COLLISION_LIMIT` (3) rows is a fallback whatever it calls itself, and
  those rows are excluded from proximity clustering. They can still merge
  on lightstone id / prcl_key / normalised address — the signals that
  carry evidence.
- Absent price now means **don't cluster**, not cluster freely.
- Same collision guard applied to the 150m property-match fallback, which
  would otherwise have attached every collided row to whichever of our
  properties sits nearest the fallback point. That one hadn't bitten yet
  but is the same defect.
- **`lib/external-listings/__tests__/dedup.collision.ts`** — first test in
  the repo. Built from the nine real rows. `npm run test:dedup`. Uses
  `npx --yes tsx` deliberately: adding tsx to devDependencies would
  desync `package-lock.json` and break Vercel's `npm ci`.

### Verification
- Test **fails on the old code** (nine rows collapse to 1 group) and
  **passes on the new** (9 groups). Checked by reverting both guards and
  re-running, not by assuming.
- Second assertion guards the other direction: a genuine cross-portal
  duplicate (same house, 8m apart, 1.25% price difference) still merges.
  A dedup fix that stops deduping is worthless.
- `tsc --noEmit` and `next build` green with the test file in tree.
- **Not yet run against Bon Bon.** The existing bad `dedup_group_id`
  values persist until the clustering re-runs — the fix changes how
  groups are computed, it doesn't retro-fix stored ones.

### Loose ends
- **Re-run clustering against live data** to clear the three known
  over-merged groups (`f64ed20f` 9 listings, `8ad5feea` 8, `61374105` 3).
  `rebuildDedupAndMatch` fires at the tail of every source refresh, so
  "Refresh Dream listings" on /map should do it. Confirm afterwards with
  the group-size query in this session's log.
- **The upstream cause is untouched.** Dream's WordPress scraper is
  geocoding to a fallback point and labelling it `exact`, and reading
  listing addresses out of image filenames ("C13 Updated Photos",
  "Angie", "Avril"). DW is Bronwyn's own website and should be the most
  trustworthy source on the map; it is currently the least. Own arc.
- `COLLISION_LIMIT = 3` is a judgement call. Three genuinely-identical
  coordinates is implausible for distinct properties but not impossible
  (sectional title). If real duplicates start escaping dedup, that's the
  number to look at.

---

## SOURCE-CHIP FILTERING + TREE TIDY (2026-08-05)

First session run from Cowork against the local repo over the device
bridge. Cleared the two map loose ends carried forward from 2026-08-01
and tidied the working tree.

### Shipped
- **Source chips now filter the polygon + dot layers.** `ForSalePolygon`
  gained a `source: SourceKey` field, set server-side in `app/map/page.tsx`
  (`dream_os` for OS erven, the portal for market rows). MapView derives
  `visibleForSalePolygons` / `visibleUngeocoded` and drives the
  `for-sale-fill`, `for-sale-outline` and `ungeocoded-dots` layers off
  those instead of the raw props. Closes Simon's bug: with every source
  chip off you still saw coloured parcel fills, and clicking one opened
  the market-listing panel.
- **Click-through guard comes for free.** Because the filtering happens on
  the *data* rather than via a Mapbox filter expression, the click
  handler's lookup only ever holds polygons that are actually rendered.
  A hidden polygon isn't in the lookup, so the handler bails. No separate
  guard to keep in sync.
- **OS polygons honour the Mandate chips too.** Same visibility contract
  as `visiblePins` — an OS erf whose mandate chip is off no longer paints.
- **Listener-leak fix (found while doing the above).** The
  `for-sale-fill` click/hover handlers were registered inside
  `installForSaleLayers`, which re-runs on every data change. Harmless
  while deps only changed on a refetch; a real leak once chip toggles
  re-install the layers. Handlers are now bound once behind
  `forSaleHandlersBoundRef` and read current data through
  `polyLookupRef` / `mergedPinsRef`.
- **"Erf boundaries" renamed to "Cadastral outlines"** with an inline
  caption: "Every surveyed erf + muni valuation. Not listings — unaffected
  by the Sources filter." This was the other half of Simon's confusion —
  the checkbox toggles a survey layer with its own muni-valuation popup,
  and nothing in the UI said so.

### Tidy
- Eleven macOS duplicate-copy artifacts (`MapView 2.tsx` through
  `MapView 5.tsx`, `page 2.tsx`, `property24 2.ts`, `route 2.ts`,
  `0063_no_snap_sectional_title 2.sql`) plus two raw `.eml` drops moved to
  `_to_delete/`. All were older snapshots of files git already tracks —
  nothing unique lost. **Simon still needs to delete `_to_delete/`**; the
  device bridge cannot unlink files.
- `.gitignore`: added `_to_delete/` and `*.eml`.
- `tsconfig.json`: excluded `_to_delete` (the stale copies were failing
  typecheck with TS2307 while they sit in-tree). Remove that exclude once
  the folder is gone.
- **PR #56 was already merged** (`a1bb45c`) and `0064_no_snap_large_parcels.sql`
  is on main — that loose end from last session is closed. Repo and Bon Bon
  are in sync.

### Verification
- `tsc --noEmit` green, `next build` green (49 routes). **Build was run in
  the cloud container, not on the Mac** — `next build` over the device
  bridge stalled ~10 min without writing a byte to `.next`, because webpack
  reads several thousand `node_modules` files through the mount. Source
  was tarballed, staged, then `npm ci` + build in the container. Worth
  remembering as the pattern for any future Cowork session.
- **NOT yet loaded in a browser.** Per the 2026-08-01 lesson, map-layer
  changes must be visually verified before merge. Simon to run
  `npm run dev`, open /map, zoom past z14, and toggle each source chip —
  fills and dots should appear and vanish with the chips, and with all
  four off only cadastral outlines (if that box is ticked) should remain.

### Environment notes for future Cowork sessions
- Git writes in the bridged folder leave stale `.git/*.lock` and
  `tmp_obj_*` files behind, because the mount refuses `unlink`. Every
  write op needs the locks moved aside first (`mv` within the mount
  works; `mv` to `/tmp` does not — it crosses filesystems and degrades
  to copy+unlink). Commits succeed once cleared.
- `git commit` needs `-c user.name -c user.email` passed explicitly; the
  bridge user has no git identity.
- `pkill -f "next build"` kills the calling shell — the pattern matches
  the bash -c command line itself. Bracket a character.

---

## P24 MAP INTEGRITY — DIAGNOSTIC + STAGED FIXES (2026-07-31 → 2026-08-01)

Long session. Simon opened with the fatigue signal — "we seem to be
building more code onto bugs every single session … a little bit
demoralized" — and asked to regroup rather than build. Regroup
turned into a bounded diagnostic on the /map screen that surfaced
five real bugs; four shipped, one reverted mid-arc after making the
map worse than before.

### The diagnostic (agreed with Simon before code)
Ran four checks against live Property24 + Bon Bon's DB:
- **P24 site count for Knysna area 322**: 505 houses + 32 commercial
  across 26 pages. Vacant-land + apartments branches 404 (URL
  taxonomy has changed). Bronwyn's "186 P24 listings is impossible"
  was wrong direction — 186 was undercounting, real is ~500+.
- **DB vs chip**: DB had 342 active P24 rows but the sidebar chip
  showed 186. Merged-pin count derivation collapsed many-externals-
  per-property into one and dropped standalones.
- **Wrong prices confirmed**: Uitzicht farm still R 130 304 000 after
  PR #50; Fernwood plot and Simola house shipping with
  `price === source_ref` (LLM extract returning the listing-id from
  the URL as price on POR listings).
- **JSON-LD miss rate**: 30% of drains had no JSON-LD. Those rows
  retained pre-PR-48 coords + prices from the removed fallback chain.

### Shipped
- **PR #52 — P24 map integrity bundle** (`e0ea1c8`, merged).
  Three commits:
  - JSON-LD-only price extraction. Killed the LLM `price` field from
    the Firecrawl extract schema and removed the markdown-regex +
    reconcilePrice fallback from `scrapeListingDetail`. When P24
    doesn't ship a `priceCurrency:ZAR` node, price resolves to null
    → renders as "Price on request" instead of a hallucinated
    number. `regeocode-jsonld` also now nulls stale wrong prices on
    rows where JSON-LD is absent (backfill path). Deleted
    `lib/external-listings/priceParse.ts` and the `reparse-prices`
    route — both encoded the removed logic. `inspect` route
    rewritten around JSON-LD.
  - Pagination cap 20 → 30 in `scrapeListingIndex`. Real P24 has
    505 listings across 26 pages; 20-page cap ceilinged discovery
    at ~400 URLs.
  - Source chip fix: `externalCounts` prop from page.tsx carries
    raw per-source DB counts. Chip now reads authoritative (352
    matched what SQL said) instead of merged-pin count (186).
- **PR #54 — Revert market-pin clustering** (`ff06cc5`, merged).
  The clustering commit that shipped in PR #52 didn't render (never
  tested against a real Mapbox instance before push), but its
  paired zoom-hide-market-markers effect DID work. Net: at any
  regional zoom the map showed zero market pins AND no clusters.
  Reverted the two useEffects while keeping the price + count fixes
  that landed correctly.
- **PR #55 — Migration 0063: no snap for sectional-title**
  (`3a6cc9d`, merged, applied). Root cause spotted in a specific
  screenshot: a 3-bed apartment at 3 Mount Joy lit up the entire
  Highfields estate parcel. Trigger from 0045 was grabbing the
  parent-of-scheme parcel because sectional-title units share one
  parcel with the whole scheme. Migration excludes property_type
  matching `(apartment|flat|sectional|townhouse|duplex|penthouse)`
  from both snap paths (trigger + `snap_all_to_parcels()` RPC).
  Backfill nulls prcl_key on existing rows hit by regex.
- **PR #56 — Migration 0064: no snap when parcel > 1 ha**
  (unmerged at session end; SQL applied to Bon Bon manually).
  Same underlying problem as 0063 but different symptom: at Pezula,
  eight unrelated plots from eight agencies (R2.1M through R29.95M)
  merged into ONE pin covering the whole Pezula estate. Cause:
  individual plots aren't in the cadastre; only the estate parent
  parcel is. All eight snapped to it, shared prcl_key, and the
  dedup ladder collapsed them because prcl_key equality outranks
  price-similarity. Migration adds `ST_Area(cp.geom::geography) <=
  10000` to both snap paths. Backfill nulls prcl_key on rows
  currently snapped to a parcel > 1 ha. Trade-off documented: a
  legit ≥1 ha farm listing renders as a pin instead of a polygon.

### Applied to Bon Bon
- Both 0063 and 0064 SQL blocks pasted into Studio and run
  successfully. Simon confirmed "both success".
- Regeocode-jsonld drain started (was ~25 pending mid-session).
  Needed to complete so rows whose lat/lng got rewritten to a
  parcel centroid by earlier snap pull fresh JSON-LD coords.

### Feedback moments
Simon: "we seem to be going backwards in this session" — the
market-pin clustering regression. Real correction: I shipped
clustering code that hadn't been loaded in a browser once. From
now on, before merging any Mapbox layer changes, load the app and
verify visually. Type-check + local diff-review is not enough for
map-render code where install races + layer stacking bite silently.

Simon: "im a novice so how do i open the develop menu" — session
had multiple moments where I gave Safari console/dev-menu paths
without noticing Simon's stack context. Save as user memory: not
frontend-native.

### Loose ends carrying forward
- **PR #56 not merged** — Simon applied the SQL to Bon Bon manually
  but the migration file isn't on main yet. Merge to keep the repo
  and prod DB schema in sync.
- **Regeocode drain not confirmed complete** — 25+ rows were
  pending. Needed to click "Re-geocode Property24" until 0 pending
  for the coord backfill to complete.
- **Source-chip toggles don't filter for-sale polygon layer** — a
  user with all sources off can still see coloured parcel fills
  AND clicking one opens the market-listing panel. Simon spotted
  both. Not shipped; needs a second useEffect in MapView that
  filters `forSalePolygons` by enabled sources, plus a guard in
  the click handler.
- **P24 chip UI clarity** — the "Erf boundaries" checkbox toggles
  a diagnostic layer completely independent of listing data.
  Simon was confused about what these polygons represented when
  he clicked one with all sources off. Consider renaming to
  "Show cadastral outlines" and/or dimming when no sources are on.
- **Clustering, done properly** — parked. Right implementation is
  probably to move market-pin rendering off HTML markers entirely
  and onto a native Mapbox symbol layer, so one source drives both
  cluster and unclustered display. Attempting via shadow-hiding
  HTML markers behind a cluster layer (my first attempt) was
  fragile. Load the app in a browser before shipping.
- **Vacant-land + apartments P24 index URLs** — both 404 on P24's
  current site structure. `for-sale/knysna` DOES include vacant
  land in its listing (verified via Fernwood plot 117227622 in
  DB), so we're not losing them entirely. But the four-branch
  discovery loop is doing wasted work. Worth verifying if we can
  drop the two dead URLs.
- **Individual Pezula / Belvidere / Thesen erven not in cadastre**
  — root data limitation. 0064 works around by not-snapping;
  proper fix would be importing finer-grained cadastral data for
  private estates. Separate arc.

### Debugging lessons worth remembering
- **JSON-LD prices are trustworthy; markdown-regex prices are
  landmines.** P24's markdown can contain size figures formatted
  like currency ("R 130 304 000" for a 130,304 m² farm); an LLM
  asked for `price: number` on a POR listing will return whatever
  large number it sees, including the URL's listing-id segment.
  Only trust `priceCurrency:ZAR` on a schema.org Offer node.
  Anything else, show "Price on request".
- **Snap-to-parcel needs a parcel-size sanity check.** A 1 ha
  threshold works for Knysna. In other markets the cutoff would
  differ (rural farms are legitimately 5+ ha).
- **The dedup ladder's prcl_key match outranks price-similarity.**
  If lots of unrelated listings share a prcl_key (as happens with
  parent-of-scheme parcels), they collapse regardless of price.
  Either the ladder should re-order (price gate above prcl_key)
  or (as done here) prevent bad shared prcl_key assignments at
  the snap step.

---

## AGENT DASHBOARD + PROPERTY-RECORD POLISH (2026-07-28)

Half-day arc ahead of an agent meeting Simon has this week. Two PRs
shipped — first is the agent-facing scoping, second is a visual /
data lift on the Property Record.

### Shipped
- **PR #13 — Agent personal dashboard + agent picker + Lightstone
  rename** (`0c5f6e6`). Four coordinated changes:
  - `AgentPicker` on Property Record (admin only) — dropdown near the
    hero, `assignListingAgent` server action writes
    `listing.agent_user_id` and revalidates /dashboard + /mandates.
    Only agent/admin roles can be assigned; blocks inactive users.
  - `/dashboard` splits by role: admin keeps current global 3 columns,
    agent gets "My deals in flight" + "My live listings" + NEW
    "Mandates expiring soon" (60-day window on my listings). Attention
    row also surfaces mandates expiring within 14 days.
  - `/mandates` scoped per agent via pre-fetched listing-id list +
    `.in("listing_id", ids)`. Empty-set guard uses a sentinel eq so
    PostgREST doesn't fall through to returning everything.
  - Property Record: "Fetch from Lightstone" renamed to "Order
    Lightstone report" — honest label (API declined; modal is a
    manual product picker).
- **PR #13 — Registry Stamp overlay** (same PR, second commit).
  Aubergine (#3D2645) SVG rubber stamp diagonally upper-right of
  the record plate. Three variants at first pass: REGISTERED,
  MANDATE HELD, IN CONVEYANCING. `feDisplacementMap` on turbulence
  roughens the outline. `mix-blend-mode: multiply` + 72% opacity
  mimic ink absorbing into paper.
- **PR #14 — Property Record polish** (`fe5bd01`). Cherry-pick of two
  commits that GitHub's PR snapshot missed on PR #13. Three lifts:
  - **P24 photos into the hero** — external_listing rows matched to
    this property contribute `image_url` plus gallery images parsed
    out of Firecrawl `raw.markdown`. Deduped, capped at 12, filtered
    against logos/trackers. Priority P24 → PP → DW.
  - **Compact hero** — schedule rows with null values now HIDDEN
    (six lines of "—" was noise not data). Cadastre-fallback panel
    shrunk 260→140px min-height when no polygon/photo. Compass rose
    56→32px. Saves ~120px above the fold.
  - **PREPARING + SOLD ELSEWHERE stamp variants** so every property
    carries a stamp. Priority chain now: REGISTERED > SOLD ELSEWHERE
    > IN CONVEYANCING > MANDATE HELD > PREPARING.
  - **NewPropertyForm coords field** — optional "lat, lng" input on
    /properties → + New property. Garden Route bbox validation
    rejects mistyped Cape Town numbers. Passed to `createProperty`
    via `latitude`/`longitude` (action already persisted them; the
    form just wasn't wired).

### Diagnostic exchanges (no code)
- **Polygon rendering deep-dive**. Simon didn't understand when
  polygons render vs dots vs nothing. Explained three layers (erf
  outlines from cadastral_parcel, for-sale polygons from
  OS/P24/PP listings with prcl_key, dots from ungeocoded P24/PP)
  and the stage progression: address → geocoded → cadastre-snapped.
  Diagnostics showed his 175 active P24 rows split as 99 polygons /
  56 dots / 20 invisible — healthy 57% snap rate given how sloppy
  Firecrawl address extraction is.
- **The Alexandra case**. Property "The Alexandra" at 30 Glen View
  Road exists on P24 + Dream's website but no OS pin, no polygon,
  no photos on the record page. Root cause: no OS property record
  existed. UI to create one already existed on /properties as
  NewPropertyForm (Simon had forgotten), but missing lat/lng input
  meant new records landed invisible on the map. The coords field
  in PR #14 closes that loop. Path A (SQL insert for immediate
  demo) documented in-thread.

### Design lesson (added to `dream-design-language` memory)
- Aubergine `#3D2645` is now the ONLY colour for registry ink stamps.
  Off the four brand accents on purpose so stamps read as a
  different medium. Documented in
  `app/properties/[id]/RegisteredStamp.tsx` header.

### Loose ends
- **"View as agent" preview for admins** — not built. Would let
  Simon demo any agent's dashboard without switching accounts.
  ~30 min if we build it.
- **The Alexandra manual creation** — Simon needs to run the SQL
  insert + click Find ERF + click Refresh Property24 to complete
  the demo setup.
- **Bronwyn's mandate/OTP templates** — still awaited (blocks
  document vault).
- **Firecrawl upgrade** — still not made (blocks P24 backfill).
- **Housekeeping bundle** — still deferred.
- **Commission tracker** — Simon deferred to later.

---

## VALUATION ROLLS + MUNI DATA REBUILD (2026-07-27 evening)

Long single-session arc: replaced the stale ArcGIS "..._Test" Layer 58
valuation mirror with the authoritative published Knysna Muni PDFs (Full
General Valuation Roll + Supplementary Rolls). Triggered by a
credibility check on Erf 1453 — external agent's report said the muni
valued the property at R 9,145,000, our data showed R 4M (then R 6.1M
after the multi-tariff split from earlier today). Turned out the ArcGIS
endpoint hadn't been edited since **2023-02-07** — 3.5 years stale.

### Shipped
- **PR #5 — Ingest Knysna Muni Valuation Roll PDFs** (`e777731`).
  7-phase build in one branch:
  - Migration 0050: `valuation_roll_upload` table, extends
    `muni_property` (+ owner, roll_upload_id) and `muni_valuation`
    (+ sec_78, effective_date, comment, note, upload_kind, is_marker).
    New `muni_property_public` view strips owner for staff-only reads.
  - `lib/valuation-rolls/`: pdfjs-dist coordinate-aware column bucketing
    parser. Full GV adapter (12 cols) and Supplement adapter (16 cols
    incl. SG21 + Sec 78 + Eff date + Note). Both verified against real
    PDFs — Full GV 22,773 rows in 7.7s, Supplement 4 431 rows in 1.7s.
  - `lib/valuation-rolls/apply.ts`: idempotent upsert. Full GV mints
    synthetic sg_number `GV:erf:ptn:unit:TOWN` when no ArcGIS SG21
    exists, else re-uses it. Supplements key directly on SG21. Purges
    arcgis rows for touched SGs.
  - `/api/valuation-rolls/{upload,:id/parse,:id/apply}` three-step API.
  - `/admin/valuation-rolls` — list + upload form + detail with parse
    preview + Apply button. Linked from `/settings`.
  - `/api/muni/import` Layer 58 pass now identity-only (kept for suburb
    bootstrap; valuations owned by uploads).
- **PR #6 — DOMMatrix polyfill for pdfjs on Vercel Node** (`272e1b7`).
  pdfjs-dist v6 references DOMMatrix / Path2D / ImageData at module
  load. Vercel serverless Node doesn't ship them; local Node 20+ does.
  Minimal no-op polyfills in `lib/valuation-rolls/parser.ts` —
  ~30MB cheaper than installing @napi-rs/canvas.
- **PR #7 — Bundle pdfjs worker for Vercel serverless** (`3b96677`).
  After DOMMatrix fix, "fake worker" bootstrap failed to find
  `pdf.worker.mjs` in `.next/server/chunks/`. Fixed via side-effect
  import + bare workerSrc specifier + `outputFileTracingIncludes` in
  `next.config.mjs` to force-include both files at build time.
- **PR #8 — Dedupe muni_property by sg_number in Full GV apply**
  (`cdd9270`). Two stacked bugs surfaced during the first Apply on
  Vercel: (a) `syntheticSg` didn't include `unit` → sectional-title
  schemes collapsed onto one key, (b) GV has ~43 legitimate duplicate
  rows across ~22.7k. Both fixed by including `unit` in the key AND
  accumulating into `Map<sg_number, propRow>` before batching so
  ON CONFLICT DO UPDATE always sees unique targets per batch.
- **PR #9 — Clickable erf polygons on the map** (`fcfe2a1`). Before:
  clicking a bare erf polygon (no OS/P24 overlay) did nothing. Added
  click handler on `parcels-fill` with priority guard against
  `for-sale-fill`/`ungeocoded-dots`. Fetches
  `/api/muni/at-erf/:prclKey` and renders a compact Mapbox popup at
  the click point.
- **PR #10 — Match erf-click by (erf, town) not sg_number digits**
  (`12eae04`). PR #9's API was doing digits-only substring match on
  sg_number, which works for ArcGIS SG21 but MISSES GV-synthetic
  keys. Parcels vector tile already exposes `tag_value` + `maj_region`;
  now passed as `?erf=&town=` query params and matched via
  `erf_number = tag_value AND town_name ILIKE maj_region`.
- **PR #11 — Map default framing to Buffalo Bay → Noetzie coastal
  strip**. Still open at session end. `INITIAL_BOUNDS` constant with
  fitBoundsOptions passed to `new mapboxgl.Map`; pin-fit-to-bounds
  effect is now a no-op.

### Applied to Bon Bon
- Migration 0050 run in Studio.
- `valuation-rolls` Storage bucket + 4 RLS policies created via SQL.
- **Full GV uploaded and applied**: 22,635 properties + 22,660
  valuations + 81 markers. Erf 1453 KNYSNA (JWH Trust, 2 Panorama
  Road, 722 m²) now correctly shows **R 9,145,000** in
  `/erf-lookup`, the map popup, and any Property Record that joins it.
- **Supplement 4 uploaded and applied**: 431 supplemental rows on top
  of the GV baseline.
- **Cleanup**: `delete from muni_valuation where upload_kind='arcgis'`
  purged stale ArcGIS rows that were still summing into the map
  popup for erven where the GV apply couldn't reuse the ArcGIS sg
  (typically because Layer 58 suburb didn't match GV town).

### Loose ends
- **PR #11 not yet merged** — default map framing.
- **`apply.ts` hardening**: purge arcgis muni_valuation by (erf, town)
  not just by SG number, so a future ArcGIS Layer 58 re-enable can't
  silently repollute. Not urgent (Layer 58 write is disabled).
- **Bronwyn's mandate/OTP templates** still awaited — blocks the
  document-collateral vault design (discussed but not built).
- **P24 drain queue**: 256 URLs still pending. Blocked on Firecrawl
  upgrade decision (Free tier at ~117 credits remaining vs 256 needed).

### Debugging lessons worth remembering
- **pdfjs-dist v6 on Vercel serverless Node** needs both the
  browser-API polyfills AND the worker file explicitly traced (bundled
  by dynamic path resolution otherwise fails). See
  `lib/valuation-rolls/parser.ts` + `next.config.mjs` for the pattern.
- **Knysna Muni ArcGIS FeatureServer** at
  `services3.arcgis.com/Kb9idbuOS9ILjfGd/.../Property_Ownership_Deeds_Test`
  is a TEST endpoint (name literally contains `_Test`), last edited
  2023-02-07. Never authoritative for valuations — the published PDF
  rolls always are.
- **PDF column extraction via pdfjs** — use `transform[4]` (x-coord)
  for column bucketing, not whitespace splitting. `pdftotext -layout`
  merges adjacent columns (e.g. `HILL STREET914`) that pdfjs
  correctly separates by coordinate.

---

## MANDATE WATCHLIST + APP SETTINGS (2026-07-27 afternoon)

- **PR #2** (`798c4b0`) — new `/mandates` staff page: four buckets
  (Expired unresolved, Expiring in N days per configured threshold,
  Unknown expiry). Type filter chips (URL-synced). Row → Property
  Record. Only active-listing mandates (draft/live/under_offer).
- New `/settings` admin page + `app_setting` table (jsonb kv). First
  setting: `mandate.expiry_window_days` (default `[30, 60]`).
  Typed `getSetting`/`setSetting` helpers with defaults registry.
- Migration 0048 applied.

## ERF LOOKUP (2026-07-27 afternoon)

- **PR #3** (`e13058e`) — new `/erf-lookup` staff page. Search by
  ERF number (all-digits) or address (space-separated tokens).
  Suburb filter dropdown. Detail card with cadastre / valuation /
  zoning / deed / bond fields. Closes the "cold enquiry" gap where
  muni data was only visible via Property Record hero.

## MUNI VALUATION SPLIT (2026-07-27 afternoon)

- **PR #4** (`e300854`) — bug fix: Knysna Muni Valuation Roll is
  1:many per SG21 (a single erf can be rated under multiple tariff
  categories). Old importer upserted on sg_number and dropped all
  but one. Migration 0049 split `muni_valuation` into its own table
  with `(sg_number, tariff)` unique constraint. Reads sum for
  headline, expose breakdown for detail. Rewrote `muni_lookup_at_point`
  to SUM across child rows.
- Also this batch: disabled ArcGIS Layer 58 valuation writes (kept
  identity slice for suburb bootstrap only).

## P24 SOURCE OF TRUTH + DRAIN QUEUE (2026-07-27 morning)

- **PR #1** (`ee724c3`) — DW hidden by default on map. Panel primary
  sorts P24 > PP > DW. Migration 0047: `geocode_source` column;
  dedup clusterer excludes centroid-fallback rows from 20m geo rule
  (fixes unrelated Leisure Isle listings collapsing into one dedup
  group). Wired `rebuildDedupAndMatch` into P24 refresh tail. Drain
  queue button auto-loops P24 refresh past Hobby 60s ceiling.

---

## /IMPROVE AUDIT + PLANS 001–006 SHIP (2026-07-26 → 2026-07-27)

Two-day arc: ran `/improve` at commit `f3b6711`, six plans emerged, all
executed via isolated-worktree subagents with reviewer diff-check. Also
a long Property24 debugging thread and a Vercel Hobby-plan gotcha
discovery worth remembering.

### Plans shipped
- **001 Parallel signed URLs** — Property Record fetches document URLs
  in parallel instead of sequential await. Merged `daf44f0`.
- **002 Prompt-injection hardening** — extract path sandboxes untrusted
  document content; auto-commit gated on `ingest_batch.auto_commit_allowed`.
  Merged `46f6811` + `d994154`. **Migration 0043 pending Studio apply.**
- **003 Lead Inbox v1** — `/inbox` screen surfaces email-sourced enquiries
  as leads (not raw batches). TopBar entry between Overview and Map.
  Merged `a5e0dff` + `6d3bfc0`.
- **004 Firecrawl Property24 scraper** — new `external_listing` source.
  Weekly cron `0 5 * * 1` UTC. Admin "Refresh Property24" button. Merged
  `dd17bd2`. `FIRECRAWL_API_KEY` set on Vercel.
- **005 Cadastral polygon shading** — `/map` for-sale properties render
  as shaded ERF polygons instead of pins. `market` state = gold fill.
  Merged `f4af39e` + `49e9c45`. Migration 0045 APPLIED (task #70).
- **006 Contact CRM** — `/contacts` party search + role timeline.
  Multi-field OR search (name, entity, email, phone, ID), URL-synced,
  paper-hairline aesthetic, POPIA-safe masked IDs. Merged `86baf7f` +
  `d04a3c6`. Migration 0046 APPLIED 2026-07-27 (pg_trgm indexes live).

### Property24 debugging saga (mid-arc)
Firecrawl adapter had three compounding bugs surfaced by real Knysna data:
1. **Wrong area code** — was pulling from area 468 (Beaufort West). Fix:
   area 322 (verified Knysna). URL regex also matched 5-segment paths
   and captured suburb-code as listing-id; real URLs are 6 segments.
2. **Coord hallucination** — Firecrawl's LLM-structured extract fabricates
   plausible-looking lat/lng (Simola listing pinned near Wilderness).
   **Fix**: removed lat/lng from Firecrawl extract schema, use Mapbox
   forward-geocode with Garden Route bbox validation +
   `centroidForArea()` fallback. `/api/sources/property24/regeocode`
   one-shot backfill endpoint fixed existing bad rows.
3. **Silent Vercel deploy skip** — hourly cron `0 * * * *` violated
   Hobby plan's daily-cron cap. Vercel silently rejected every push for
   ~4 hours. Discovered via `vercel --prod` CLI: "Hobby accounts are
   limited to daily cron jobs." Reverted to daily `0 5 * * *`, then
   weekly `0 5 * * 1` once the URL queue was drained. Saved as memory
   `vercel-hobby-cron-cap`.

Two migrations shipped for P24: **0044** (URL queue) APPLIED (task #66),
**0045** (external_listing prcl_key auto-snap trigger) APPLIED (task #70).

### Map polygon layer install (plan 005 stability fix)
Polygons repeatedly disappeared / basemap flickered because the layer
install effect subscribed to `styledata`, which fires many times per
second during interactions. Fix: switch to `style.load` (one-shot on
genuine style change). Also deduped `forSalePolygons` by `prcl_key`
with OS-wins priority (Mapbox rejects match-expression with duplicate
branch labels). Saved as memory `mapbox-style-load-not-styledata`.

### Batch-attach ERFs enhancement
"Geocode all" button on `/map` now also runs `snap_all_properties_by_erf`
and `snap_all_to_parcels` RPCs after geocoding, so newly-geocoded
properties get their `prcl_key` bound and immediately render as
polygons instead of pins. Button always visible for admins (was gated
on `stats.missing > 0`, invisible after all 19 OS properties had coords).

### Env changes (Vercel)
- `FIRECRAWL_API_KEY` — added
- `CRON_SECRET` — already present, reused
- No new secrets for plans 001, 003, 005, 006

### Migrations pending Bon Bon's DB
Apply in order via Supabase Studio:
- **0041** partial unique erf index (from 2026-07-25 arc)
- **0042** erf sg_number (from 2026-07-25 arc)
- **0043** auto_commit_allowed gate (plan 002)

Already applied: **0044, 0045, 0046**.

### Queued for next session
- Apply 0041 + 0042 + 0043 (Simon, Studio)
- Cleanup: delete Property24 rows with bad coords/price/URL scope from
  the pre-fix runs (task #63)
- Housekeeping bundle from audit's "considered and rejected" list —
  `!.env.example` gitignore, stale `.property-hero-*` CSS, `deriveLabel`
  duplication, orphaned `SpendMeter`, silent OCR errors
- Photo classifier for embedded images in listing PDFs / EMLs (task #49)
- `/map` focus-on-property URL param (task #50)
- Muni `usage_` code lookup (task #51)
- `/map` ERF + address search box (task #52)

---

## PROPERTY RECORD REDESIGN + MUNI EXTENSIONS (2026-07-25)

Session focus: turn the Property Record from a generic SaaS card into
a specific cadastral artifact, and make the muni mirror pull its
weight.

### Muni disambiguation (0042_erf_sg_number.sql)
- Real bug on 12 Eagles Way: ERF 2934 rendered TWO muni cards — one
  for the actual Heads property, one for a Sedgefield Erf 2934 that
  happens to share the number. Erf numbers aren't unique across the
  muni; suburbs are.
- Fix: `erf.sg_number` column (nullable) storing the full SG21 code
  when the erf was attached via muni-picker. Query joins muni_property
  by SG first, falls back to erf_number for legacy rows.
- `attachErfToProperty` accepts `sg_number` and backfills on unique-
  conflict so re-picking a Muni row from an existing erf populates the
  SG on the existing row.

### Muni panel: render every field
- Panel now surfaces the full column set from `muni_property`: town,
  suburb hint, muni_erf_code, valuation-roll area (as cross-check when
  it differs from extent), declared use, sectional-title flag,
  descriptions, prev deed, bond info, sectional scheme. Empty fields
  render nothing; rich records show more.

### Compact layout pass
- Navy header padding + hero-row margins + stats-card gaps + transfer-
  card padding all tightened. When a preparing transfer has no
  parties + no agreement, the 3-column empty grid collapses to a
  single-line placeholder.

### Property Record redesign (cadastral document aesthetic)
The record now reads as a working title-deed / valuation-roll extract,
not a SaaS card. Six moves:

1. **Registry Stamp** — gold-bordered identity block, JetBrains Mono
   at 38px for the ERF, hairline internal rule, deed + SG below.
   Real SA title-deed reference-block format. Signature move.
2. **Muni valuation headline** — 34px Inter tabular, mid-page anchor.
   What Bronwyn reaches for in pricing conversations.
3. **Cadastre + Schedule two-column row** — Schedule is a proper
   hairline-ruled deed schedule. Primary rows first (extent, zoning,
   ward, suburb, type/use, ownership); secondary rows (prev deed,
   deeds office, registered date, bond, sectional) hidden when null.
4. **Cadastre panel NEVER a black rectangle** — polygon on satellite
   when bridged; CSG-diagram placeholder (compass rose + hatched
   paper + coords) when not. Then further improved: **photo primary**
   when the record has photos, since agents care about the house
   more than the boundary. Always-visible "View on map" pill in the
   bottom-left pivots to /map.
5. **Municipal Record panel REMOVED entirely** — every field folded
   into the Schedule inside the plate. One source per fact.
6. **--paper surface** — subtle vellum wash (`#FBF9F4`) with warm
   hairlines. Ownership timeline + deal card inherit the paper
   aesthetic so the whole page reads as one document. New tokens:
   `--paper`, `--paper-mute`, `--paper-line`, `--stamp` (reserved for
   a future REGISTERED red-ink overprint).

Deal card moved from parallel column to a wide strip BELOW the plate.
Actions (Fetch from Lightstone, Find ERF from Muni) folded INTO the
identity block via `actionsSlot` — they belong to the identity, not
floating in an unattached bar above.

### ERF lookup fuzzy matching
19 Glenview Road returned zero muni matches despite existing. Muni's
street_name field is inconsistent about word breaks and abbreviations
("GLENVIEW ROAD" vs "GLEN VIEW RD" vs "GLENVIEWRD"). New strategy:

- Two parallel broad fetches: contains-first-word + short-prefix
- Merge, dedupe by SG, then normalise-and-score in-process
- Compact form strips spaces and street-type suffixes on BOTH sides —
  all variants collapse to the same key
- Score bands: 100 = exact root match, 40+ = shared prefix ≥5 chars
- Handles Road/Rd, Street/St, Avenue/Ave, Drive/Dr, Lane/Ln, Close/Cl,
  Crescent/Cres, Boulevard/Blvd, Way, Park, Place/Pl, Square/Sq,
  Court/Ct, Loop, Circle/Cir, Terrace/Ter, Ridge, View, Heights/Hts,
  Alley/Al, Walk, Mews. Confirmed working.

### Ship
- `supabase/migrations/0041_erf_unique_null_portion.sql` — partial
  unique index (Postgres NULL != NULL edge case caused ERF 2934 dup)
- `supabase/migrations/0042_erf_sg_number.sql` — nullable SG column
  + partial index on non-null values
- `app/properties/[id]/PropertyHero.tsx` — full rewrite around
  Registry Stamp + Schedule + photo-primary visual + map pivot
- `app/properties/[id]/page.tsx` — muni fallback logic, schedule
  builder, muni panel removed
- `app/properties/[id]/actions.ts` — attachErfToProperty accepts
  sg_number, backfills on conflict
- `app/properties/[id]/ErfLookup.tsx` — passes SG when attaching
- `app/api/erf-lookup/route.ts` — fuzzy street-name matching
- `app/globals.css` — --paper token family, Registry Stamp styles,
  Schedule table styles, cadastre-fallback with compass rose, hero-
  photo, hero-map-pivot pill

### Not built this arc
- Migration 0041 + 0042 SQL still needs to be applied to Bon Bon's DB
  (Simon has the DDL; apply via Studio at his convenience)
- Photo classification for embedded images in listing PDFs / EMLs —
  many properties (like 15 Eagles) have listings + correspondence
  attached but no `doc_type='photo'` records, so the new photo-primary
  hero can't show anything for them yet
- Focus-on-property support on /map — "View on map" pill currently
  just opens /map; extending MapView to accept `?focus=<id>` and pan
  there is a separate task
- The muni's `usage_` field is a numeric code ("27") without a lookup
  table; renders as "use 27" in the valuation subtitle and "Erf · 27"
  in Type/Use. Cosmetic; needs the muni code map or LLM interpretation

---

## INTAKE EMAIL: SWITCH FROM POSTMARK TO RESEND (2026-07-24)

Discovered mid-session that the intake email flow had never actually run.
Bronwyn forwarded two St James Hotel emails to `intake@dreamproperties.app`
and nothing landed. Root cause was compound:

1. **Migrations 0022 and 0023 were never applied** to Bon Bon's DB (audit
   query showed everything 0024→0033 applied but 0022/0023 skipped, which
   is why `ingest_batch.sender_email` didn't exist and the webhook errored
   on insert). Applied both, plus a new **0034_provider_message_id.sql**
   that renames `postmark_message_id` to `provider_message_id` for the
   provider switch. Combined SQL was pasted straight into Studio.
2. **Postmark was never signed up for.** The webhook code shipped
   2026-07-08 assumed Postmark as the MX + inbound-parse provider, but the
   Postmark account + DNS never got done. Emails to
   `intake@dreamproperties.app` had nowhere to land — Simon's outbound
   SMTP silently queued them because MX was unset, so no bounce.

Switch: **Resend** for inbound (already using Resend for outbound admin
alerts, so one-vendor consolidation). Trade-off: Resend's inbound webhook
only delivers metadata; we make follow-up API calls to fetch the email
body + attachment bytes from signed CDN URLs. More network hops per
email but a cleaner mental model.

### Ship
- **`lib/resend/inbound.ts`** — thin client: `retrieveReceivedEmail(id)`,
  `listReceivedAttachments(id)`, `fetchAttachmentBytes(url)`, and a
  `fetchInboundEmailComplete(id)` helper that pulls the email + attachment
  list in parallel. Uses `RESEND_API_KEY` (already on Vercel).
- **`app/api/intake/email/route.ts`** — rewritten. Svix signature
  verification (svix npm package, ~90 KB, no crypto reimpl). Webhook
  envelope has `type: "email.received"` + `data.email_id` + attachments
  metadata; body + real from-address come from the follow-up API fetch.
  Idempotency: `provider_message_id = 'resend:<email_id>'`. Everything
  downstream (sender allow-list, fuzzy match, batch insert, classify) is
  unchanged behaviour.
- **`0034_provider_message_id.sql`** — rename column + comment. Applied
  same time as 0022/0023 catch-up.
- **`svix ^1.99.1`** added to package.json.

### Env vars to add on Vercel
- **`RESEND_WEBHOOK_SECRET`** — from Resend dashboard when the inbound
  webhook is created. Signs the payload; we verify with svix.
- (`RESEND_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` were already set.)
- (`INTAKE_WEBHOOK_TOKEN` is now unused — safe to remove.)

### Resend dashboard setup (Simon's side)
1. Domains → `dreamproperties.app` added, region eu-west-1 (Ireland).
2. DNS records at the domain registrar:
   - DKIM TXT (`resend._domainkey`)
   - SPF MX + TXT on the `send.` subdomain (outbound return-path — doesn't
     touch main mail routing)
   - DMARC TXT (optional)
   - **Inbound MX on the root domain** — Enable Receiving toggle reveals
     this record; needs to be added and verified before Resend accepts mail
     at `intake@dreamproperties.app`.
3. Webhooks → new webhook for `email.received` event, POST to
   `https://dreamproperties.app/api/intake/email`, copy signing secret to
   Vercel as `RESEND_WEBHOOK_SECRET`.

### Not built this arc
- Reply email confirming triage URL (still parked from the original ship).
- Auto-extract on inbound. Bronwyn triggers bulk-extract from /triage; the
  extract path still needs a service-role auth refactor.
- Removal of the now-unused `INTAKE_WEBHOOK_TOKEN` from Vercel — cosmetic.

### Queued to verify
Once Resend DNS verifies and `RESEND_WEBHOOK_SECRET` is set, Simon forwards
the two St James emails again. Expected: two batches in `/triage` with the
gold "via email" pill, one new "The St James Boutique Hotel of Knysna"
property record created by the first email, second email fuzzy-matches to
that record. Bulk-extract → commit → docs land on the property.

---

## LIGHTSTONE STRATEGY: PORTAL STAYS, LINE ITEMS MIGRATE (2026-07-22)

Resolves the open "should we sign up for Lightstone API?" question. Lightstone
quoted R5k/month — mismatched to Dream's real volume (~30 Property Reports/
month portal). The pivot: keep the Property Report on the Lightstone portal
(SIE/PIP flags + free personal history list have no market substitute); migrate
the discrete paid line items (DOT, title-deed, CIPC, trust) to source-direct or
a single no-subscription reseller; build inside the CRM the things no vendor
covers well (team-wide report history, boundary-aware comparables, mandate-
expiry and new-listing alerts).

No code shipped this arc — it's the strategy record. Follow-up ships queued
below.

### Discovery (Bronwyn's 2026-07-22 workflow reply)
Team collated: Bronwyn + Jo, referencing Vanessa, Angie, Candy.
- 5–10 Property Reports/week normal; up to 100/week during targeted road
  trawls (buyer wants front-row, team pulls neighbour reports across a
  whole road to find contactable owners); ~30/month average.
- Full-bundle pull every time — because they never knew granular facets
  existed, not because they want the full bundle.
- Personal history list is load-bearing: pay once, view forever. Vanessa
  relies on it daily.
- Portal reliability varies by user: Angie 3× logins avg, Vanessa never
  logs out, Candy fluent with map search. Configuration/skill variance.
- Comparables considered unreliable in Knysna (conflates neighbouring
  estates, averages plots+houses). **Never shared with buyers.**
- Separate paid line items beyond Property Report: **DOT** (Deeds Office
  Tracker — pending-registration status), title-deed one-offs, CIPC
  (company/director), trust searches.
- Bronwyn confirmed erf-numbered map is landing: "will alleviate guess
  work" when trawling a road.

### Vendor pivot (from `lightstone-line-item-migration.md` co-work brief)
- **Property Report** → **stays on Lightstone portal.** SIE/PIP flags have
  no confirmed market substitute; history list is best-of-breed.
- **DOT + title-deed** → **Lexis WinDeed** (pay-per-search, no
  subscription, one shared team login). ~R24.21 ex VAT / DOT search;
  ~R21.65–R25.67 incl VAT / title-deed search. **DeedsWeb-direct** as the
  R19 / R109 floor if we ever wrap deeds calls inside the CRM.
- **CIPC** → **direct to CIPC** (BizPortal / e-Services). R30 full
  electronic disclosure. Habit change only, no vendor needed — the
  clearest saving in the exercise.
- **Trust** → stays FICA pack + conveyancer. Master's beneficial-ownership
  register (trustonline.justice.gov.za) is restricted access, not a self-
  service agent tool.
- **Deeds-transfer alerts** on a short watchlist (past clients / expired
  mandates, ~20–30 properties) → **WinDeed Alerts** at ~R5.31/property/
  month ex VAT. Everything else uses our own new-listing scrape alerts —
  earlier and more actionable.
- **API path (future, only if we integrate at scale)** → **SearchWorks
  OneHub** (via Standard Bank) or **AfriGIS Property Ownership & Deeds
  API**. Both are true REST/JSON, both quote-gated — no numbers yet.

### Build inside the CRM (what no vendor covers)
- **Team-wide "pay once, view forever" report history.** File every
  purchased PDF (Lightstone Property Report, WinDeed DOT, deed copy)
  against the property record, viewable by all agents indefinitely. Once
  this exists, the pay-per-view objection to *any* provider disappears.
  Pairs with the intake webhook + document pipeline.
- **Boundary-aware buyer-shareable comparables.** Built from scraped
  `external_listing` (Dream nightly; P24 + PP queued) plus our own
  `transfer` records with proper Knysna suburb/estate boundaries and
  plot-vs-house separation. Removes the strongest single reason to pull a
  Property Report. Target = something Bronwyn shares with buyers, which
  Lightstone can't offer.
- **Mandate-expiry alerts.** Pure internal DB.
- **New-listing alerts on watched areas/estates.** Reads from
  `external_listing`. Earlier signal than a deeds-transfer alert.
- **Erf-numbered map.** DONE (cadastre marathon 2026-07-09 → 2026-07-10).

### Queued from this arc
- **CIPC-direct habit note to Bronwyn** — no-regret action this week.
- **WinDeed account setup** — Bronwyn/Vanessa's action; small.
- **Team-wide report history feature** — small ship, high value.
- **Boundary-aware comparables model** — the largest Lightstone-reduction
  lever; medium ship.
- **Deeds-transfer alerts** on the short watchlist — small ship via
  WinDeed Alerts wrapper or (if the CIPC-direct wiring goes well)
  DeedsWeb-direct.
- **Mandate-expiry alerts** — small ship, DB-only.

### Not built this arc
The pivot itself. Four memory files added (`dream-team-roster`, `dream-
lightstone-usage`, `dream-comparables-approach`, `dream-deeds-vendor-map`)
+ `lightstone-api-pending` updated to reflect the R5k/mo decline. Co-work
research deliverable saved at `Dream Knysna Properties/lightstone-line-
item-migration.md`.

---

## MARKET CACHE AUTO-INVALIDATION ON REGISTRATION (2026-07-14)

Closes the last "manual force-refresh required" hole in the Lightstone cache
layer. When one of our own transfers advances to `registered` — through any
path — the four permanent-facet cache columns on the matching
`market_property` row are nulled automatically, so the next
`getMarketFacet()` call for `deeds` / `ownership` / `last_sale` /
`comparables` misses and re-fetches under the budget. AVM has its own
12-month TTL and is intentionally left alone.

### Ship
- **`0032_register_invalidate_market_cache.sql`** —
  `invalidate_market_cache_on_register()` trigger function
  (security definer, search_path=public) + `trg_transfer_register_invalidate`
  AFTER INSERT OR UPDATE OF status ON transfer. Fires when status transitions
  to `registered`; skips no-op re-sets (old.status = new.status = registered).
  Joins `transfer.property_id → property.lightstone_property_id →
  market_property` and nulls `legal_fetched_at`, `ownership_fetched_at`,
  `last_sale_fetched_at`, `comparables_fetched_at`. Silent no-op if the
  property has no `lightstone_property_id` yet (common for pre-take-on
  records) or no matching `market_property` row.
- **`lib/market/service.ts`** — top-of-file comment updated. The
  "trigger is out of scope" note was written for 0026's cache-layer ship;
  now reflects that 0032 closed it. `invalidateMarketFacet()` stays as-is
  for programmatic invalidation (still called from nothing today, kept for
  future explicit-clear UIs).

### Fires from every existing status→registered path
- `commit_batch()` (migration 0018) — title-deed evidence auto-advances.
- `merge_transfers()` (migration 0019) — winner may inherit registered
  status via coalesce from the loser's `registered_date`; safe because the
  trigger only fires when status *changes* to registered.
- Direct SQL edits, admin UIs, future manual "Mark registered" actions.

Migration to apply on Bon Bon's DB: **0032**.

### Queued next (unchanged)
See CADASTRE MARATHON section's queued list. Top item still:
erf-snap real-data pass on `/map` at z16+ to find pins on wrong parcels.

---

## CADASTRE MARATHON: CSG → VECTOR TILES → SNAP (2026-07-09 → 2026-07-10)

**The map now has erf boundaries.** Every property record has a
`prcl_key` bridge to a specific parcel in the SA Chief Surveyor
General cadastre. The whole pipeline — CSG import, MVT tile server,
Mapbox vector layer, coordinate snap — is live and rendering navy erf
outlines with parcel-number labels over the satellite basemap.

75,745 parcels imported for the KNYSNA + GEORGE magisterial districts
(the pre-1994 admin regions that CSG uses — KNYSNA covers Knysna town,
Sedgefield, Rheenendal, wider Garden Route). 7,156 of them cluster on
Leisure Isle. Every listing now bridges to a specific erf via
`external_listing.prcl_key`; every future Lightstone lookup can key
off the same identifier.

### Adjust pin + move-pin UX (start of arc, 2026-07-09 morning)
- **`0027_property_geo_manual.sql`** — `property.geo_manual boolean
  default false`. Every automated geocoder now filters
  `.eq("geo_manual", false)` so a hand-placed pin can never be
  clobbered.
- **`savePropertyPin(propertyId, lng, lat)`** admin action + drag-mode
  wiring in MapView: dragKey / pinPropertyIdRef / handlePinDropRef so
  the persistent `dragend` handler on the Mapbox marker reads current
  state without stale closures. `router.refresh()` after successful
  save.
- Preview panel gains a **Pin location** section with the `Move pin`
  CTA (renamed from Adjust pin — the whole action, not the intended
  outcome). Restyled as full-width navy CTA, 44px min-height. On drag
  entry the map `easeTo`s the pin at zoom 17 so it's unmistakable
  which pin is grabbable. The dragging pin pulses (1.4s gold ring,
  respects reduced-motion).
- Adjusted pins get a small gold dot on the marker badge + a "PIN
  ADJUSTED" chip in the preview so admins can see hand-placed pins at
  a glance.

### Erf-boundary layer shipped end-to-end
- **`0028_cadastral_parcel.sql`** (recorded — user applied) — table +
  `parcel_mvt(z,x,y)` function returning MVT bytea via ST_AsMVT.
- **`0029_cadastre_import_and_snap.sql`** — `cadastral_import_cursor`
  singleton, `upsert_parcel(...)` RPC (GeoJSON → PostGIS),
  `snap_all_to_parcels()` RPC (bulk ST_Contains + centroid update,
  respects `geo_manual=true`), `property.prcl_key` +
  `external_listing.prcl_key` + `external_listing.geo_manual`.
- **`0030_cadastre_consecutive_fail.sql`** — one column on the cursor
  for cross-batch timeout retries.
- **`0031_upsert_parcel_int_cast.sql`** — `nullif(p_parcel_no, '')::int`
  inside the function so the text parameter casts cleanly to the int
  column. Fixed the "every upsert rejects" state.
- **`/api/cadastre/import`** — resumable, cursor-driven, admin session
  OR bearer auth. Per-keyword discovery, empty-first-page skip, fail-
  forward on HTTP + ArcGIS errors, cross-batch timeout retry via
  `consecutive_fail`, per-parcel try/catch (one bad ring can't kill a
  batch), skip-town after 5 consecutive HTTP fails (stops runaway
  offset increments past a town's data), `?peek=1` returns current
  cursor state without any work, `?reset=1` wipes cursor for a clean
  restart.
- **`/api/tiles/parcels/[z]/[x]/[y]`** — MVT server via
  `parcel_mvt(z,x,y)` RPC. Handles Supabase bytea in base64 or `\x`-
  prefix hex. Returns 204 below z=14 and for empty tiles.
  `Cache-Control: public, max-age=86400, s-maxage=86400`.
- **`/api/cadastre/snap`** — standalone admin trigger for
  `snap_all_to_parcels()`.
- **MapView "Erf boundaries" toggle** — vector source pointing at
  `${origin}/api/tiles/parcels/{z}/{x}/{y}` (absolute URL — Mapbox
  picks this up more reliably than a path-only string), fill + line +
  label sub-layers, styledata re-install on basemap swap. Navy fill @
  12%, navy lines @ 95% opacity 1-3px width (bumped from muted gold
  after Bronwyn tested and saw nothing; gold + satellite basemap was
  invisible), white text labels with navy halo for TAG_VALUE at z≥17.

### `CadastreImport` panel (map rail, admin-only)
- Compact panel under the Sources chips: idle → **Import cadastre**
  button; running → batch counter + total erven + current town @
  offset + Stop / Cancel; done → green totals + snap results +
  Dismiss.
- Peek on mount via `?peek=1` so a `router.refresh()` from an unrelated
  action (Adjust pin save, Refresh Dream listings) can't hide the
  in-flight cursor and trick the admin into clicking a fresh-start
  button that wipes 11k erven of progress.
- "Done · check warnings" gold state when totalSoFar === 0 && done —
  visually distinct from real success.
- Auto-open `<details>` on warnings with URL + payload snippet, monospace
  cards with word-break so long ArcGIS error strings are readable.

### DFFE-specific quirks we had to unstick
The DFFE portal's ArcGIS Server layer rejects a lot of standard params
that other services accept. Notes for future adapters:
  - `f=geojson` + `returnGeometry=true` → HTTP 200 with
    `{ error: { code: 400 } }` inside. Use `f=json` and convert ESRI
    rings to GeoJSON MultiPolygon client-side.
  - `geometryPrecision`, `maxAllowableOffset`, `orderByFields` on
    non-OBJECTID columns → HTTP 400. Drop all three.
  - `outFields` accepts `PRCL_KEY`, `TAG_VALUE`, `MAJ_REGION` (in
    WHERE only, not outFields — weirdly). `PARCEL_NO`, `MIN_REGION`,
    `PROVINCE` return 400 when queried. Feed `maj_region` from the
    local `town` variable on upsert instead.
  - Distinct-value discovery works with `f=json + returnGeometry=false`,
    fails otherwise.
  - GeoJSON output for paged queries breaks silently past ~offset
    (town-record-count); we skip the town after 5 consecutive HTTP
    fails since DFFE returns network errors when offset exceeds data.

### Same-house merge (dedup enhancements)
- `dedup.ts` `Row` + `Prop` types gain `prcl_key`. External listings
  sharing a `prcl_key` cluster into the same dedup group.
  `matchFor(row)` ladder is now:
  `lightstone_id → prcl_key → normalised address exact →
  token-subset → geo-proximity`.
- Token-subset match: `"19 glenview" ⊆ "19 glenview road the heads"`
  triggers a match. Requires at least one house-number-shaped token
  so "the heads" alone can't latch onto every Heads property.
- **Map merge** collapses a matched external listing into its
  property's pin even when the property has no coords of its own —
  seeds the merged pin at the listing's coordinate. No more phantom
  market pin at the same address as a real record.

### Mobile responsive pass (2026-07-09 midday)
Field agents work off phones. Three screens hardened for ≤900px:
- **TopBar** collapses to a hamburger + slide-down drawer at ≤768px.
- **Map** rail becomes a fixed-position bottom sheet with a 56px peek
  handle. Preview panel goes from right-slide-in to full-width bottom
  sheet at 82vh with a 44px close control.
- **Properties list** table transforms into per-row cards via
  `display: block` + `td[data-label]::before` at ≤640px.
- Property Record: cadastral strip wraps to 2-up, header status chip
  stacks below title, photo tiles rescale.
- Viewport pinned in `app/layout.tsx` (`export const viewport`) so iOS
  Safari can't fall back to 980px or auto-zoom on input focus.

### Dream scraper geocode refinements (queued from prior arc)
Also shipped in this window (2026-07-09 midday, before the cadastre
push):
- Filename cleaner strips WordPress `-scaled`, `-eNNNNNN`, resize
  dimensions `-NNNxNNN`, and trailing photo index. Original uploads
  sort before resized variants so the pin picture stays sharp.
- `anchorForGardenRoute(address, suburb?)` replaces `anchorForKnysna`.
- Region-guard: bbox lat -34.20 to -33.65, lng 22.30 to 23.60.
- Centroid fallback for known estates (Pezula, Thesen, Simola,
  Eastford, Brenton, etc.) when Mapbox fails or returns out-of-bbox.
- One-time cleanup on every refresh nulls historical out-of-bbox
  coords. Explicit null-on-park so stale in-box pins can't survive.
- Refresh Dream listings button in the map rail (admin only).
- DW pins recoloured to Dream navy.

### Property intake email + Team screen (2026-07-08 evening, folded in)
- Postmark inbound webhook `/api/intake/email` with URL-token auth.
  Subject-prefix router: `Property:` / `Client:` / no-prefix.
  Fuzzy-match RPCs `match_property_by_address` + `match_party_by_name`
  so re-forwarded emails attach to existing records instead of
  duplicating. Migrations 0022 (source + postmark_message_id, view
  refresh), 0023 (party_id + fuzzy RPCs).
- **`/team`** screen (0024 `job_title` + `phone` on `app_user`,
  `roles.ts` with Dream tone `admin → "Director"`, admin invite via
  `service.auth.admin.inviteUserByEmail`, self-lockout guards, access
  map panel). Admin-only tab in TopBar.
- Lightstone cost controls (0026): budget cap + soft/hard threshold
  alerts to Directors via Resend, monthly rollover on the
  `lightstone_budget` singleton, per-call ledger, `market_property`
  cache (permanent for deeds/ownership/last_sale/comparables,
  12 months for AVM), spend meter on the map rail.

### Ship checklist (all in production, all applied)
Migrations: **0021 → 0031** all applied to Bon Bon's DB.

Env vars live on Vercel:
- SUPABASE_SERVICE_ROLE_KEY
- INTAKE_WEBHOOK_TOKEN
- NEXT_PUBLIC_SITE_URL
- CRON_SECRET
- RESEND_API_KEY + NOTIFY_FROM
- (LIGHTSTONE_API_BASE + LIGHTSTONE_API_KEY still stub-behind — set
  when the subscription opens)

Postmark inbound stream at `intake@dreamproperties.app` → webhook.
Vercel Cron at `0 3 * * *` hits `/api/sources/dream/refresh`.
Dream WordPress scraper + scan pipeline live and self-healing.

### Diagnostic scars (for the next Ops moment)
Half the day was spent surfacing DFFE's actual error responses in the
CadastreImport panel — `<details open>` on warnings + URL + full
`error.details` array from the ArcGIS envelope. If a future adapter
hits a similar "empty details, no clue" wall, load a curl in the
Bash tool and probe the endpoint directly — that's what finally
narrowed the `f=geojson` bug down.

### Queued for next session
- **Look at how existing properties line up with erven.** Real-data
  pass on `/map` at z16+ to spot which properties snapped correctly
  vs which need `Move pin`. Likely surfaces 5-15 properties that need
  manual placement.
- ~~**/dupes callout on Dashboard**~~ — SHIPPED 2026-07-13 (commit
  f82b869 — Director-only pair count on Overview).
- **WhatsApp conversation ingestion** — schema brief lives at
  `docs/whatsapp-schema-brief.md`. Person-anchored model
  (people/person_phone_numbers/conversations/messages/deals/
  conversation_deal_links), Meta Cloud API webhook, phone-based
  matching. Parked for a later session — a full arc in itself
  (multiple migrations + webhook + outbound send window handling +
  POPIA retention flag).
- **Doc revision dedupe** on Property Record (`normaliseFilename` +
  `byte_size`, keep newest). Still pending from prior arcs.
- **P24 + Private Property scraper adapters** — the same
  `external_listing` table + same `rebuildDedupAndMatch` pipeline;
  each adapter is a self-contained route. Blocked on portal access.
- ~~**Registered-transfer → market cache invalidation trigger.**~~
  SHIPPED 2026-07-14 (migration 0032 — see arc at top of file).
- **Force-refresh checkbox on the Lightstone Fetch modal** — the
  server already accepts `force:true` on Market facet calls; needs a
  UI toggle so an admin can bypass the cache when they know something
  changed.

---

## MARKET OVERLAYS + LIGHTSTONE COST CONTROLS (2026-07-08 evening)

Second half of 2026-07-08. Two big arcs:
  1. The map becomes a market map — Dream's own website is scraped nightly
     into external_listing, merged with our stock into one pin per physical
     listing, with per-source badges + a per-source preview panel. P24 + PP
     adapters slot into the same table when their access opens.
  2. Every billable Lightstone call is now gated by a monthly budget, cached
     in market_property, and mirrored to a ledger. Cross 80% → Directors get
     an email; cross 100% → pulls block and Directors get a second email.

### Market overlays — external_listing + Dream scraper
- **`0025_external_listing.sql`** — repo copy of the applied schema.
  `listing_source` enum (dream_website / property24 / private_property),
  `external_listing` table with source_ref, url, headline, address_raw,
  price, bedrooms, image_url, lat/lng, lightstone_property_id,
  matched_property_id, dedup_group_id, raw jsonb, first_seen/last_seen,
  active. Unique (source, source_ref). RLS: staff read + admin write.
- **`app/api/sources/dream/refresh`** — GET/POST scraper. Auth: bearer
  CRON_SECRET (used by Vercel Cron) OR authenticated admin. Fetches
  https://www.dreamknysna.co.za/knysna-properties/, regex-parses listing
  URLs, fetches each page, extracts slug + og:title + price ("R 2,730,000"
  → numeric) + address hint (og:description / h1 / image filename fallback)
  + property_type guess. Upserts on (source, source_ref). Delist path
  fetches active dream_website ids and deactivates the diff. Geocodes new
  / changed rows via Mapbox (same Knysna-anchored pattern as
  `app/map/actions.ts`). Ends every run with rebuildDedupAndMatch.
- **`lib/external-listings/dedup.ts`** — union-find clustering: same
  lightstone_property_id → same normalised address → within 20 m + price
  within 15%. Reuses an existing dedup_group_id inside a cluster so uuids
  don't shuffle between refreshes. Matches to our DB by lightstone id →
  normalised address → 50 m proximity. Never overwrites a manually-set
  matched_property_id (code note about a future override table).
- **`lib/external-listings/geocode.ts`** — Mapbox forward-geocode helper
  shared by the scraper and any future adapter.
- **`vercel.json`** — one cron: `0 3 * * *` (03:00 UTC / 05:00 SAST) →
  `/api/sources/dream/refresh`. Vercel Cron auto-attaches
  `Authorization: Bearer $CRON_SECRET` when the env var is set.
- **`app/map/page.tsx`** — fetches active external_listing alongside
  property/listing/transfer data. Builds MergedPin[] server-side:
  1) our properties with coords seed prop-{id} pins; 2) externals with
  matched_property_id attach to that pin (adds to sources[]);
  3) remaining externals with dedup_group_id cluster into grp-{uuid} pins;
  4) singletons become ext-{id} pins. Externals without any coord anchor
  are skipped (geocode fills them next run).
- **`app/map/MapView.tsx`** — merged-pin rendering. New rail sections:
  Sources chips (Our listings / Dream website / Property24 / Private
  Property) with contribution counts + a "Split duplicate pins by source"
  toggle that fans a merged pin into per-source markers at the same coord.
  Pin styling: our stock keeps mandate colours, market-only pins get a
  dashed white pill on grey pointer, merged pins carry a compact source
  stack (`OS DW P24 PP`) beneath the price. Preview panel rebuilt:
  our-property block on top when we own it, "Also listed on" per-source
  table with price + agency + Open-arrow outbound link, and a "Prices
  differ across sources" flag when the range spans >5%.
- **CSS additions** — .source-chips, .source-chip.on, .source-stack,
  .source-dot palettes (navy / gold / magenta / green), .price-pin.market
  (dashed white).

### Lightstone cost controls — gateway + cache + budget cap + alerts
- **`0026_lightstone_cost_controls.sql`** — repo copy. Three tables:
  * `lightstone_budget` singleton (id bool PK check id) with
    monthly_call_budget (default 200), soft_warn_pct (default 80),
    month_key, alerted_soft, alerted_hard.
  * `lightstone_usage` ledger — every call lands one row (billable,
    cache_hit, blocked, http_status, error, user_id, our_property_id,
    lightstone_property_id, generated month_key). Partial index on
    (month_key) where billable AND NOT cache_hit AND NOT blocked so the
    "how many billable calls this month" count is O(1).
  * `market_property` — per-facet json + per-facet fetched_at (address /
    legal / land / owners / last_sale / comparables / avm).
  RLS: budget + usage admin-only; market_property staff-read + admin-write.
- **`lib/lightstone/gateway.ts`** — the single billable-Lightstone entry
  point. `guardedGet(path, meta)` with meta.endpoint + optional billable
  (default true) + userId / ourPropertyId / lightstonePropertyId context.
  Month rollover: if `month_key` on the budget row is stale, reset it plus
  both `alerted_*` flags BEFORE the count check. Non-billable calls skip
  the meter but still ledger. Billable calls: count → block if >= cap
  (insert `blocked=true, billable=false`, throw `BudgetReachedError`) →
  otherwise do fetch, ledger the call, re-read count, fire notifyAdmins on
  first cross of soft_warn_pct and hard cap (each once per month). Exports
  `getBudgetSummary()` for the map spend meter.
- **`lib/lightstone/live.ts`** — refactored. Every facet call now
  routes through `billableFacet(path, { endpoint, lightstonePropertyId })`;
  Property Search is `freeCall(...)` with `billable:false`. apiBase /
  apiKey / raw fetch moved into gateway.ts.
- **`lib/notify.ts`** — `notifyAdmins(subject, bodyText)`. Fetches active
  admin emails (service role), sends via Resend REST (no SDK). Fail-soft:
  logs to console and returns without throwing if RESEND_API_KEY or
  NOTIFY_FROM aren't set, or if no active admins have emails.
- **`lib/market/service.ts`** — cache-first `getMarketFacet(lsId, facet,
  { force?, userId?, ourPropertyId? })`. Reads market_property, honours
  per-facet freshness (permanent for deeds / ownership / last_sale /
  comparables, 12 months for AVM), falls through to `guardedGet` on miss
  or force. Cache hits get ledgered with `cache_hit=true` so admins see
  the calls we saved. Upserts data + fetched_at back into market_property.
  `invalidateMarketFacet(id, facet)` for the future "new registered
  transfer" trigger.
- **`/api/lightstone` + `/api/lightstone/search`** — both catch
  `BudgetReachedError` and return **HTTP 429** with `code: "BUDGET_REACHED"`
  and the actionable message ("ask a Director to raise it"). Other errors
  still 502.
- **Spend meter** — new SpendMeter section on the map rail, admins only.
  Reads `getBudgetSummary()` server-side in page.tsx and hands the snapshot
  to MapView. Shows used/budget, a progress bar, the month key, the warn
  threshold. Palette shifts: navy on mist → gold at ≥80% → deep-red at
  ≥100% ("Budget reached · pulls paused").

### Ship checklist
Applied migrations already: **0025 + 0026** (both live in Bon Bon's DB).
Vercel env vars to add now:
- **CRON_SECRET** — `openssl rand -hex 32`. Vercel Cron auto-sends this as
  `Authorization: Bearer …` on every scheduled invocation.
- **RESEND_API_KEY** — from resend.com after verifying dreamproperties.app.
- **NOTIFY_FROM** — verified sender, e.g. `Dream OS <alerts@dreamproperties.app>`.
- **LIGHTSTONE_API_BASE** + **LIGHTSTONE_API_KEY** — set only when
  Lightstone opens the subscription.

Nothing else on the human side: cron self-registers when vercel.json
deploys, first scheduled run is 05:00 SAST the day after deploy. Or fire
a manual scrape:
```
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://dreamproperties.app/api/sources/dream/refresh
```
Response returns `{ upserted, delisted, geocoded, matched, groups, errors }`.

### Not built this arc (parked)
- Property24 + Private Property adapters. They'll write into
  external_listing under the appropriate source; the dedup pass already
  handles cross-source clustering. Slot when access opens.
- Manual override table for matched_property_id (currently the code
  respects any non-null match but a dedicated table is the durable
  version).
- Market screen consuming `getMarketFacet`. The cache is warm as soon as
  someone does a Fetch on a property; the UI to browse cached facets on
  demand (deeds history, AVM chart, comparables) is a follow-up.
- "New registered transfer → invalidate deeds/ownership/last_sale/
  comparables" trigger. `invalidateMarketFacet` exists; wiring it to
  transfer status is future.
- Refresh button in take-on Fetch modal to force-bypass the cache — the
  server already accepts `force:true`; UI wiring is small.

---

## INTAKE + LIGHTSTONE TAKE-ON + TEAM SCREEN (2026-07-08)

Full day of arcs closing the "how does work enter the system?" question. Four
migrations (0021–0024), one new webhook, one new admin screen. Property
intake is now: forward the email, records get created, everything shows up
in /triage. Team access is now: Directors invite from the app, no Supabase
Studio round-trip.

### Lightstone take-on wiring — search + propertyId capture (morning)
Continuation of the Lightstone adapter shell from 2026-07-07. Simon then
extended `live.ts` with the actual Azure API Management gateway calls
(lspsearch/v1 + lspdata/v1), added `AddressCandidate` + `PropertyRef.propertyId`
to the adapter interface, and taught the stub to return one obvious sample
candidate. My side wired the app around it:

- **`0021_lightstone_property_id.sql`** — `property.lightstone_property_id
  bigint` nullable + partial index. Reused for every future Property Data
  facet call so the live adapter doesn't have to re-resolve address text.
  lng/lat already existed (0015).
- **`/api/lightstone/search`** — admin-gated POST. Calls
  `getLightstoneAdapter().searchAddress(query)`. Returns `{ ok, source,
  candidates }`; `source` reflects whether the live env vars are set so the
  UI can badge SAMPLE.
- **NewPropertyForm** now has a compact "Lightstone lookup" panel above the
  address fields. Type an address → Search → clickable candidate list →
  picking one prefills the address (strips `[SAMPLE]`), matches the suburb
  dropdown by name, and captures the propertyId as a badge with a `clear`
  link.
- **`createProperty`** accepts `lightstone_property_id`, `latitude`,
  `longitude`, `suburb_name`. Server-side fallback: if only a suburb name
  arrives, resolves it against the `suburb` table with `ilike` — never
  invents a row.
- **`/api/lightstone`** now passes `propertyId: prop.lightstone_property_id`
  into the ref. Structured-field coalesce expanded to: `title_deed_no`,
  `extent_sqm`, `lat`, `lng`, `suburb_id` (via `ilike` name lookup), and
  `erf_number` (inserts an `erf` row if none matches). Never overwrites
  non-null. `town`/`municipality`/`province`/`postal_code`/`estate_name`/
  `scheme_name` are dropped — the full raw JSON stays on the document row.
  Filename map now handles `application/json → "json"` for the live adapter's
  per-facet responses.

### Property intake email — Postmark inbound webhook (afternoon)
Bronwyn's ergonomic path: forward a mandate email to
`intake@dreamproperties.app`, get a triage batch tied to a property record
with all attachments already classified. Zero clicks required.

- **`0022_intake_email.sql`** — `ingest_batch.sender_email` and
  `postmark_message_id` (unique index for retry idempotency).
  `v_triage_queue` refreshed to expose `source` + `sender_email`.
  `ingest_batch.source` already existed (0007) so `'email'` is a valid
  value out of the box.
- **`lib/supabase/service.ts`** — `createServiceClient()` reads
  `SUPABASE_SERVICE_ROLE_KEY`. Server-only; never touches the browser
  bundle. Used for webhook writes that have no user session (RLS would
  otherwise block them).
- **`lib/classify-batch.ts`** — factored `classifyBatch`'s internals into
  `classifyBatchWithClient(batchId, supabase)` so the webhook can pass its
  service client in. The `classifyBatch` server action in
  `app/triage/actions.ts` now thin-wraps it.
- **`/api/intake/email`** — URL token auth (constant-time compare against
  `INTAKE_WEBHOOK_TOKEN`). Postmark JSON parser. Sender allow-list against
  `app_user.email` (case-insensitive). MessageID dedupe returns the
  existing batch on retries. Creates property, batch, uploads
  `email-body.txt` + attachments (base64-decoded, 20 MB cap) to `staging`,
  runs classify. Skips auto-extract — Bronwyn triggers with the same
  bulk-extract button she uses on drag-drop batches (extract's auth
  refactor deferred as unnecessary scope).
- **`/triage` list** — new gold pill `via email` next to the folder name
  for `source='email'` rows; tooltip shows sender.

### Intake router — subject prefix + fuzzy match on both paths (afternoon)
Follow-up ship after Simon's "does the property record update as more
info arrives?" question. Answer: it didn't. Now it does. Also opened
the intake to client-first onboarding.

- **`0023_intake_router.sql`** — `ingest_batch.party_id` (nullable FK).
  `match_property_by_address(q, min_sim)` + `match_party_by_name(q, min_sim)`
  RPCs — pg_trgm similarity, top 5 results. `v_triage_queue` refreshed to
  expose `party_id`.
- **Webhook subject parser** — strips `Fwd:`/`Re:` prefixes first, then
  detects `Property:` / `Client:` / `Contact:`. No prefix → property
  (backwards compat).
- **Fuzzy resolution** — `resolveProperty` (threshold 0.55 against
  `primary_address`) and `resolveParty` (0.60 against `party.display_name`).
  Above threshold → batch tied to existing row and the commitBatch fallback
  puts new docs on that record. Below → new row created. Weaker matches
  ignored; /dupes handles the residue.
- **`/triage` list** — client-intake rows show `client via email` in the
  same gold treatment. Tooltip distinguishes property vs client intent
  plus sender. `/triage/[id]` didn't need changes — the review page was
  already generic enough to render a party-only batch (no property diff,
  just files + label = "Client · Name").

### Team & Access screen — /team (evening)
Directors can now invite and manage team members from the browser. Was
Supabase Studio work; is now app work. Also lays down the vocabulary that
"admin = Director" in Dream tone.

- **`0024_app_user_profile.sql`** — `app_user.job_title` + `phone`.
  Distinct from `role` so Vanessa can be an Agent with title "Sales &
  Marketing" without the two agreeing.
- **`app/team/roles.ts`** — `ROLE_LABEL` (`admin → "Director"`),
  `ROLE_ACCESS` (one-liners per role used verbatim in the access-map
  panel), `ROLE_PILL` (palette tuned for the white table — topbar's
  `.role-*` classes were built for the dark navy strip).
- **`app/team/actions.ts`** — `requireAdmin()` gate on both writes.
  `updateTeamMember` only patches fields explicitly passed (never nulls
  a non-null by accident). Self-lockout: a Director can't demote or
  deactivate themselves. `inviteTeamMember` runs
  `service.auth.admin.inviteUserByEmail(email, { redirectTo })`, then
  upserts the `app_user` row on the returned auth id — profile lands
  immediately so the invitee shows in the staff table before they've
  clicked through.
- **`/team` page** — server component, `dynamic = "force-dynamic"`.
  Admin-gated with a polite "Directors only" panel for non-admins (never
  500s). Invite CTA + staff table (one `TeamRow` per member: name/email,
  title + phone editable inline, role select, FFC, transfers-led count
  from `transfer.lead_agent_user_id`, active toggle, per-row Save). Access
  map below the table with pill + one-line description per role.
- **`TopBarClient.tsx`** — `Team` tab added, `adminOnly: true`.
- **Reuses** `SUPABASE_SERVICE_ROLE_KEY` (already set for the intake
  webhook). Optional `NEXT_PUBLIC_SITE_URL` so the invite email lands
  people at `/login`.

### Ship checklist (four migrations, four env vars)
Apply in Bon Bon's DB in order: **0021 → 0022 → 0023 → 0024**.
Vercel env vars needed:
- `SUPABASE_SERVICE_ROLE_KEY` (used by both intake webhook + /team invites)
- `INTAKE_WEBHOOK_TOKEN` (generate: `openssl rand -hex 32`)
- `NEXT_PUBLIC_SITE_URL=https://dreamproperties.app` (invite redirect)
- `LIGHTSTONE_API_BASE` + `LIGHTSTONE_API_KEY` — when the subscription
  becomes active (still stub-behind-env until then; nothing to do today).

Postmark setup: create an inbound stream, webhook URL
`https://dreamproperties.app/api/intake/email?token=<TOKEN>`, then MX
`intake` at Postmark's inbound host.

### Not built this arc (scope kept tight)
- Auto-extract in the intake webhook. Would need `/api/extract` refactored
  to accept a service-role bypass. Bronwyn uses her existing bulk-extract
  button on inbound batches; not a real pain point yet.
- Party-batch commit path — a client batch that reaches commit today
  routes docs through the existing commitBatch flow (parties get linked
  via extraction match_candidates). If a client-batch-specific commit
  helper is needed later, it's a thin server action that just promotes
  files to documents linked to the party.
- Reply email confirming triage URL. Postmark outbound is easy to add
  when the intake flow proves out with Bronwyn.
- Custom Dream Mapbox Studio style (still Simon's court).

---

## QUEUED FOR NEXT SESSION — bulk-migration unlocks

Four ships that would flip the migration path from "click each batch" to
"click a queue" and close the trickle-in workflow gap. None are
architectural; they're all extensions to what already exists.

**Sequence rationale**: #1 and #2 were **shipped 2026-07-06 evening** — see
the design-pass section below. Remaining queue: bulk migration throughput
(bulk extract + bulk commit) plus new items from tonight's real-data run
(transfer picker + merge-transfers UI + doc-revision dedupe).

**~~1. Manual "attach to existing property" — SHIPPED 2026-07-06~~**
- Right now, when the matcher finds no property candidate (e.g. a FICA-only
  drop with no address in the extracted fields), Bronwyn has no way to
  say "this batch belongs to `42 Duthie`" manually. `commit_batch` falls
  back to `Unknown address` and creates a phantom property.
- New: a search box in the Matches panel for the property target — type
  an address / deed / erf, get autocomplete results from `property`,
  click one to inject its `id` into `fields.property.id`. Reuses the
  same code path the auto-`link` decision already uses.
- Also: a "attach to this existing transfer" picker when linking to a
  property that already has transfers — closes the second-transfer noise
  without needing dedupe to guess.
- ~2 hours. Highest priority.

**~~2. On-commit document dedupe — SHIPPED 2026-07-06~~** (transfer dedupe still open)
- Before creating a `document` row from an `ingest_file`, check whether a
  document with the same `normaliseFilename(title)` AND `byte_size`
  already exists linked to the target property. If yes: reuse the
  existing document row and only add the new `document_link` — with the
  new `document_link.role` set to `batch:<label>` so the provenance
  survives.
- Also do a lightweight transfer dedupe: if this batch's proposed
  agreement price + date matches an existing transfer on the linked
  property, reuse that transfer instead of creating a new one.
- Uses the same `lib/diff.ts` helpers the differ already uses.
- Turns the "informational" differ into the "safe on commit" differ.
- ~medium; 2–3 hours.

**3. Bulk extract button** (`/triage` page)
- "Extract all unextracted green batches" (or `green + amber`). Fires
  `/api/extract` per batch in sequence with a small concurrency cap
  (probably 3). Same cost model as today — the user triggers, nothing
  fires automatically on drop.
- Show an estimated LLM cost (rough $/batch × count) on the button so
  nobody accidentally torches R500 on a wave.
- Progress ticker + fail-tolerant (if one batch OCR errors, keep going).
- ~1 hour to build.

**4. Bulk commit button** (`/triage` page)
- "Commit all one-click-safe batches" — bar: `tier=green` AND every
  match target has an auto-decided `link` AND (once #2 is in) no
  document-dedupe conflicts on the differ.
- Skips anything that would create a duplicate transfer or has field
  conflicts on the property target's differ.
- Reports "committed X, skipped Y for review" with a table of skips.
- ~half day.

**~~5. Transfer picker at commit time — SHIPPED 2026-07-07~~**
- `0017_commit_transfer_link.sql`: `commit_batch` reads
  `p_fields.transfer.id`; if set (and the transfer belongs to the linked
  property — defensive check), commits into it instead of creating a
  new one. Extends `match_candidate.target_kind` check to include
  `'transfer'`. Backward compatible.
- `linkTransfer(batchId, transferId | null, label)` server action +
  `TransferPicker.tsx` client component. Renders inside the Matches
  panel below the linked property row when the property has ≥1
  existing transfer. Default is "Create a new transfer"; each existing
  transfer is a clickable row with humanised status pill and date.
- Property target changes wipe stale transfer picks
  (`linkPropertyManually` + `decideMatch`).
- Needs 0017 applied to Bon Bon's Database before test.

**6. Merge transfers UI on the Property Record** (queued 2026-07-06 evening)
- Small "Merge into another transfer…" button on each transfer card in
  the ownership timeline. Opens a picker of the other transfers on this
  property. Runs the DO-block pattern from tonight's 15 Eagles Way SQL
  as a server action. Handles the transfer_party / fica / document_link
  unique-constraint clashes cleanly.
- Retroactive tool for records already polluted; #5 stops the pollution
  happening in the first place. Build #5 first.
- ~2 hours.

**7. Doc revision dedupe** (queued 2026-07-06 evening)
- Optional cleanup pass: when multiple docs on a property share the same
  `normaliseFilename(title)` but different `byte_size` (e.g. Property
  Information v1 + v2 dropped separately), keep only the newest by
  `uploaded_at` and archive the others.
- Off by default; run via SQL or a maintenance button. Not a hot path.

**8. Custom Dream Mapbox Studio style** — Simon building in parallel. Once the
   style URL exists, one line goes into the BASEMAPS array as a fourth chip.
- "Extract all unextracted green batches" (or `green + amber`). Fires
  `/api/extract` per batch in sequence with a small concurrency cap
  (probably 3). Same cost model as today — the user triggers, nothing
  fires automatically on drop.
- Show an estimated LLM cost (rough $/batch × count) on the button so
  nobody accidentally torches R500 on a wave.
- Progress ticker + fail-tolerant (if one batch OCR errors, keep going).
- ~1 hour to build.

**2. Bulk commit button** (`/triage` page)
- "Commit all one-click-safe batches" — bar: `tier=green` AND every
  match target has an auto-decided `link` AND (once #3 is in) no
  document-dedupe conflicts on the differ.
- Skips anything that would create a duplicate transfer or has field
  conflicts on the property target's differ.
- Reports "committed X, skipped Y for review" with a table of skips.
- ~half day.

**3. On-commit document dedupe** (in `commitBatch` server action)
- Before creating a `document` row from an `ingest_file`, check whether a
  document with the same `normaliseFilename(title)` AND `byte_size`
  already exists linked to the target property. If yes: reuse the
  existing document row and only add the new `document_link` — with the
  new `document_link.role` set to `batch:<label>` (or similar) so the
  provenance survives.
- Also do a lightweight transfer dedupe: if this batch's proposed
  agreement price + date matches an existing transfer on the linked
  property, reuse that transfer instead of creating a new one.
- Uses the same `lib/diff.ts` helpers the differ already uses.
- Turns the "informational" differ into the "safe on commit" differ.
- ~medium; 2–3 hours.

**Sequence**: build 3 first (dedupe is what makes bulk-commit safe), then
2, then 1. Or 1 and 3 in parallel (both touch different files) and 2 last.

Also queued from earlier (smaller):
- Cosmetic: `IN_CONVEYANCING` → "In conveyancing" pill.
- `transfer.status` advance to `registered` when a `title_deed` doc is
  present in the batch.
- Sync `geom` from `lng, lat` (needs a small PostGIS helper migration).
- Staging bucket cleanup for the historical `imageNNN.*` signature files
  purged from the DB (bytes still in storage).
- Safer `Classify`: skip files above 0.9 confidence so hand-fixes survive.
- Photo carousel in Map preview card (needs media-table reshape).

---

## TRANSFER PICKER + DASHBOARD REDESIGN + MODERN TYPE (2026-07-07 evening)

Big arc. Root fix for transfer duplication, a proper attention-first dashboard,
whole-app type swap to modern sans, and title-deed → registered auto-advance.

### Transfer picker at commit — root fix for "one listing, three transfers"
- `0017_commit_transfer_link.sql`: `commit_batch` honours `p_fields.transfer.id`.
  Verifies it belongs to the linked property (defensive), otherwise falls
  through to creating a new one. Extends `match_candidate.target_kind` check
  to include `'transfer'`. Backward compatible.
- `linkTransfer` server action + `TransferPicker.tsx` client component. Shows
  inside the Matches panel below the linked property row when the property
  already has ≥1 transfer. Default is "Create a new transfer"; each existing
  transfer is a clickable row with humanised status pill + date.
- Property target changes wipe stale transfer picks (both `linkPropertyManually`
  and `decideMatch` do the cleanup).

### Registered advance on title-deed evidence
- `0018_registered_advance.sql`: `commit_batch` now checks the batch for any
  file classified as `title_deed`. If present, transfer status → `registered`
  and `registered_date` coalesces (existing, then AoS transfer_date, then
  today). Fires after the earlier `in_conveyancing` assignment so the deed
  wins.
- One-shot backfill included: every transfer where a title-deed doc is
  already linked (via transfer or property) advances to `registered`.
  Cleans up historical stuck-in-conveyancing records.

### Merge transfers UI — retroactive cleanup tool
- `0019_merge_transfers.sql`: `merge_transfers(winner, loser, reason)` RPC.
  Same shape as `merge_properties` from 0013 — admin-gated, same-property
  guard, unique-constraint clashes dedup'd on `transfer_party` / `fica` /
  `document_link` before repoint, audit log written, loser deleted.
- `MergeTransfer.tsx` on each transfer card in the Property Record.
  Admin-only, appears when the property has more than one transfer.
  Expandable picker + native confirm on the destructive action.

### Dashboard redesign — attention-first, not KPI-first
- Ripped out the 4 KPI tiles (the "template answer" the frontend-design
  skill calls out). Hero now shows THE specific deal that needs
  attention — transfer with the nearest transfer_date in in_conveyancing,
  with a "N days to transfer" countdown as the payload. Falls back to
  most-recent transfer, then to an empty invitation.
- Three columns of work replace the KPIs: **Deals in flight** /
  **Live listings** / **Waiting for review**. Column headers absorb the
  count that used to live in the tile. Rows are actual things to look
  at — Fraunces (later Inter) primary + mono secondary + a right-aligned
  payload chip (countdown / price / tier). Column dividers carry a
  2px vertical gold-tideline whisper at the top, so the signature
  repeats and consistently means "primary axis of attention".
- Cut: "Live database, live map, live pipeline" marketing tagline, the
  4 KPI tiles, and the AMBER pill leaking on recent-activity rows.

### Type: modern all-sans across the app
- Simon read Fraunces as dated. Swapped whole-app to **Inter** (display +
  body) + **JetBrains Mono** (utility). Loaded fresh weights (300-800 for
  Inter, 400-700 for JetBrains Mono). Dropped Fraunces + Hanken + Spline
  Sans Mono from the font-load altogether.
- Display sizes got weight bumps 600 → 700/800 and tighter tracking
  (-0.025 to -0.04em) so Inter reads intentional at large sizes — Fraunces
  at 600 was heavier than Inter at 600 without the compensation.
- 51 CSS references + 6 inline-styled components (TransferPicker,
  PropertyAttach, DiffPanel, PairCard, MapView) all updated.

### Real-data cleanup as we went
- Suburb backfill for pre-fallback commits — patched every property with
  a missing suburb where the address contained a seeded suburb name.
- Bronwyn's admin role — delete+reinvite had left her `app_user` row
  orphaned. Rebound to her new `auth.users.id` with role='admin'.
- Two rounds of transfer merge SQL (before and after property merges
  on `/dupes`). Consolidated 3 Oupad × 3, Plot A4 × 2, 15 Eagles Way ×
  multiple into single rows.
- Listing dedupe SQL — after property merges, the survivor had duplicate
  live listings. Kept newest per (property_id, asking_price, status).

### Queued for next session (order)
1. **Cascade dedupe on `merge_properties`** — when properties merge, also
   collapse duplicate transfers and live listings on the survivor.
   Tonight's SQL block for the listing/transfer residue should never be
   needed again after this. Small ship.
2. **/dupes callout on Dashboard** — surface pair counts on the Overview
   so Bronwyn is driven to review rather than the tool being hidden
   behind a nav tab.
3. **`/dupes` threshold defaults + per-pair confidence display** — catch
   borderline pairs like the two 6 Bowden variants (address strings
   differed too much for 0.5 trigram), but with clearer confidence
   surfacing so low-score noise doesn't dominate.
4. Bulk extract on `/triage` (~1h)
5. Bulk commit on `/triage` (~half day)
6. Doc revision dedupe (optional)
7. Custom Dream Mapbox Studio style (still Simon's court)

Also: `merge_listings` RPC + browser button on Property Record is a
natural counterpart to `merge_transfers`. Not urgent — the auto-cascade
in #1 covers most cases.

---

## EVENING ARC — DESIGN PASS + REAL-DATA FIXES (2026-07-06 evening)

Second big block of the day. Everything that shipped between "map is live"
and "Bronwyn's book is Bronwyn-ready".

### Map pins redesign
Teardrop pins couldn't hold variable-length price text (`R 24.5M` overflowed)
and pure navy fills sank into satellite imagery. Swapped for the horizontal
**price-pill pattern** real-estate portals use (Zillow / Rightmove /
Property24). Rounded rectangle sized to the price text, mandate colour on
fill, small pointer arrow at the bottom, white 2px ring for contrast on
satellite basemap. POR variant for no-price rows: compact muted badge with
the mandate colour as a thin ring.

### Basemap switcher — Satellite as default
Three-tab toggle (Satellite / Streets / Light) in the left rail. `mapbox/
satellite-streets-v12` as the default so Bronwyn sees actual roofs on
Leisure Isle and Pezula with mandate pins on the buildings. `map.setStyle()`
keeps HTML markers across style changes so no marker gymnastics.

### Manual property-attach shipped
- `searchProperties(q)`: ilike over `primary_address` + `title_deed_no`,
  ilike over `erf.erf_number`, dedupe by property id, backfills erven for
  every result.
- `linkPropertyManually(batchId, propertyId, label)`: wipes existing
  `match_candidate` rows for the property target, inserts a fresh one
  with `decision='link'` + `candidate_id`. `commit_batch` reads that path
  and attaches to the chosen property.
- `PropertyAttach.tsx` client component: expandable inline search, 250ms
  debounce, big address + mono suburb/erf/deed per result. Renders next to
  "Create new record instead" on the Property target, AND as a standalone
  section when the auto-matcher didn't propose a Property target at all
  (the FICA-only trickle case).

### On-commit document dedupe
`commitBatch` now pre-fetches existing `document_link` rows on the target
property and builds a `normaliseFilename(title) + byte_size` map. When
processing each `ingest_file`, matches reuse the existing `document` row
and only add the new `document_link` for the transfer. First-in-batch
duplicates also collapse. Historical dupes (169 Links, Eagles Way) don't
retro-fix — only new commits.

### Property Record design pass (frontend-design skill)
Interim data-first layout replaced.

- **Header status pill**: current transfer status as a chip on the right of
  the masthead. Same palette as map pins. Humanises `IN_CONVEYANCING` →
  `In conveyancing`, `REGISTERED` → `Registered`, `NO_LIVE_DEAL` → `No live
  deal`. Transfer date under the pill when set.
- **Cadastral strip** replaces the 6-tile fact grid. Reads left-to-right in
  SA deeds-registration order: Erf · Title Deed · Extent · Suburb · Type ·
  Ownership. Hairline verticals between items. Values dim to half opacity
  when empty. Mono for deed / erf, Fraunces for named values.
- **Ownership timeline** as the signature move. The app's gold tideline
  motif (previously only a decorative rule) becomes a vertical rail down
  the transfers section with a year marker + tideline dot per transfer.
  Applies the app signature to an axis where time actually is information.
- **Photos strip strict**: only `doc_type_code === 'photo'` files land here.
  Scanned IDs and passports (image files, classified as `id_document` /
  `passport`) no longer leak into a strip that reads as public property
  photos. POPIA hygiene. Bigger tiles (168×126).
- **Documents grouped by category** with gold-tideline underlines under
  each category eyebrow. FICA eyebrow renders in red as a quiet visual
  signal that PII lives under it. `Documents (N)` wrapper heading dropped
  (Chanel critique: one accessory removed).

### 15 Eagles Way triage exercise (real-data test)
- Two batches for "one listing, trickled in over two folders" hit the
  live pipeline. Both linked to the existing `b3a041a7-...` property via
  manual attach. Committed cleanly.
- Result: three transfers on one property (the two new commits + a July 2
  empty pilot) — this is the transfer-dedupe gap in real life.
- Manual SQL DO-block collapsed the three into one keeper. Ownership
  timeline flattened to a single transfer with all 8 documents attached.
- Queued: transfer-picker-at-commit (root fix) + merge-transfers UI
  (retroactive cleanup) so this doesn't need SQL again.

### Suburb backfill for pre-fallback commits
One-shot `update ... coalesce()` iterating every seeded suburb — patched
Suburb tile on every property already committed before the 0016 landing.
The Heads / Leisure Isle / Pezula / Simola / Belvidere / Brenton records
now all read correctly.

### Cosmetic wins
`IN_CONVEYANCING` → `In conveyancing` etc. (was queued as a cosmetic
follow-up) — done as part of the design pass.

---

## LIVE MAP + FIRST REAL BOWDEN COMMIT (2026-07-06 afternoon)

**Bronwyn's first real email → committed Property Record**, and the map screen
came fully to life. The afternoon was a series of "the pipeline actually
works, now let's find and fix the next thing hiding" moments.

### The Bowden pipeline run
- Bronwyn dropped five `.eml` files for 6 Bowden Park, Leisure Isle. Batch
  auto-classified as Email Correspondence (correct — the wrappers). Unpack
  silently produced 0 attachments.
- **Root cause found by parsing a Bowden .eml locally with mailparser**: my
  earlier inline-signature filter (`f5a1be4`) was over-eager. It skipped any
  attachment with `contentId` set — but Outlook sets a contentId on nearly
  every attachment, including real PDFs (Lightstone report, Signed Joint
  Mandate, 6 Bowden Park Plans). All silently dropped. Fixed by removing the
  `!!contentId` check from the skip signal: only `contentDisposition === 'inline'`
  OR `related === true` count as skip signals now.
- Also bumped `/api/unpack` maxDuration 60 → 300, added per-file error
  surfacing (download/read/parse/upload/insert stage), and stopped marking
  `.eml` files as `parsed` on partial failures so retries actually retry.
- After the fix: 14 documents committed to a live Property Record — Lightstone,
  Signed Joint Mandate, Plans, Zoning Certificate ERF 7474, Municipal Account,
  Insurance, guest-house docs — with Stephen Athey Collins as the extracted
  seller.

### Extraction gaps found + fixed
- Empty Suburb / Type / Ownership on the Bowden record → three problems:
  1. `commit_batch` had no fallback for suburb when the LLM lumped it into
     `primary_address`. Added a scan-address-for-seeded-suburb-name fallback
     in `commitBatch` (`fcfe217`).
  2. `TEXT_TARGETS` in `/api/extract` didn't include `lightstone_report`,
     `title_deed`, `rates_account`, `boundary_relaxation`, or
     `ppra_disclosure` — the LLM never saw the Lightstone report even though
     it was in the batch. Added them (`34b4b32`).
  3. `JSON_SHAPE` had no `property_type` or `ownership_type` fields. Added
     them with the seeded taxonomy vocabulary in the prompt. Migration
     `0016_property_facts.sql` teaches `commit_batch` to look them up by
     code OR label and write the FK columns on insert, plus fills NULLs on
     link so a follow-up batch enriches existing records.

### Map screen — went live, painfully
Everything wrong that could be silently wrong, was. The sequence of hunts:
1. `/map` showed "No properties yet" → **0015 migration hadn't been applied**;
   query for `lng/lat` failed silently, `data` was null, count was 0.
2. Fixed migration, page then showed "No coordinates on file" — geocoder
   button visible but Bronwyn's Mapbox token wasn't being read (dark navy
   canvas, no basemap).
3. Sequence of token diagnostics revealed the token was VALID (returned
   full style JSON when hit directly) — Vercel wasn't the problem.
4. Added a temporary debug panel to `MapView` — logged `container size on
   init: 1248x0`. **Root cause: the `.map-shell` grid had one implicit row
   with no `grid-template-rows`, so the row auto-sized to content, and
   since `.map-canvas` is position:absolute it contributed 0.** Row
   collapsed. Fixed by switching `.map-shell` to flexbox with explicit
   `height: calc(100vh - 54px)` and `.map-stage { height: 100% }`.
5. Basemap tiles finally rendered. Geocode button still looked disabled →
   the `.map-empty` overlay at z-index 25 was covering the geocode-bar at
   z-index 22, blocking clicks. Fixed by raising the bar to z-index 30
   and setting `pointer-events: none` on the empty-state overlay.
6. Geocode fired, all 7 properties (including 6 Bowden) landed on the map,
   mandate-coloured pins with price labels baked in, side preview card
   working end to end. Debug panel ripped out.

Also queued along the way:
- Safer paste hygiene: `.trim()` the Mapbox token everywhere it's read
  (Vercel env-var trailing whitespace was a real suspect).
- `mapboxgl.supported()` check → surfaces a specific error if WebGL is
  disabled.
- `map.resize()` + `ResizeObserver` on the map container — belt-and-braces
  against future layout-shift regressions.
- Full Mapbox `on('error')` handler → surfaces a red banner on the map.

### Basemap switcher shipped
Three-tab toggle in the left rail: **Satellite** (default, satellite-streets-v12
— gorgeous for property, roofs and pools visible), **Streets** (colored
navigation style), **Light** (the original). `map.setStyle()` swaps live;
HTML markers stay put across style changes so no re-add gymnastics.

### Content-based reclassifier + differ shipped earlier in the day
Already documented below — they held up well against the day's real data
(Gas COC content-classify catching the SAQCC file was mentioned; the
batch differ didn't get exercised yet since Bowden was a fresh property).

### Queued for next session (unchanged from the earlier queue)
1. Manual "attach to existing property" at batch review (correctness fix
   for the FICA-only trickle case)
2. On-commit document + transfer dedupe
3. Bulk extract button
4. Bulk commit button

Plus: **custom Dream Mapbox Studio style** (in progress — Simon is building
the palette in Studio with a gold coastline as the signature. Once
published, one line goes into the BASEMAPS array as a fourth chip.)

Also the smaller follow-ups list stays (IN_CONVEYANCING pill, transfer
status advance, geom sync, staging bucket cleanup, safer Classify, photo
carousel).

---

## BATCH DIFFER — "WHAT THIS BATCH ADDS" (2026-07-06)

**Answers the "nugget in one file" concern**. Bronwyn worried that batch-level
dedup would lose value — one folder might carry a unique document or a
better field value that the other doesn't have. Rather than dedupe upstream,
this ship exposes what a batch would ADD when it links to an existing
property, so the reviewer can decide whether the incremental data is worth
committing.

- `lib/diff.ts` — types + normalisation. `normaliseFilename` collapses
  whitespace / underscores / hyphens and strips extension + `(N)` copy
  markers so "169 Links Photo (2).jpg" matches "169 Links Photo.jpg".
- `app/triage/[id]/page.tsx` — server computes `PropertyDiff` when the
  property target has a `link` decision. Fetches the linked property's
  fields, existing `document_link` documents, and existing transfers +
  agreements. Classifies each property field as `adds` (empty on record,
  filled by this batch), `conflict` (both non-null and different),
  `same`, or `empty`. Also detects whether this batch would create a
  duplicate transfer (checks proposed agreement price+date against
  existing transfers).
- `app/triage/[id]/DiffPanel.tsx` — client render sitting between the
  Matches panel and Proposed fields. Summary tiles (new files, duplicate
  files, fields filled, field conflicts, existing transfers) + only-
  changed-rows table for property field diffs + side-by-side New /
  Duplicate file lists + an existing-transfers table with a warning
  banner if this commit would spawn a new transfer.

Not this ship (queued):
- Actual dedupe on commit — right now the differ is informational; if you
  commit the batch, duplicate documents still get created. Task #2 from
  the earlier three-item list (document dedupe on attach) is the natural
  companion.
- Party-level diff (existing parties vs proposed). The Matches panel
  already shows candidate parties independently, so this was deferred.
- Selective per-file commit — skip specific files at commit time.

---

## CONTENT-BASED RECLASSIFY (2026-07-06)

**Fixes the Gas COC problem** — files whose filename was uninformative (like
`20260219134128251.pdf`, obviously a SAQCC Gas certificate but invisible to
`lib/classify.ts`) landed as `other`. The extractor already OCRs scanned PDFs
but only pulls fields — it never fed that content back to the classifier.
This ship closes the loop.

- `lib/content-classify.ts` — regex ruleset that scans document text (from
  PDF text layer, docx, or OCR). Ordered rules, first hit wins. Covers Gas
  COC, Electrical COC, Beetle, FICA, ID, passport, marriage cert, title deed,
  rates, juristic-party paperwork (resolution / CIPC / trust / share
  register / VAT), mandate types, PPRA disclosure, CMA, Lightstone report,
  offer to purchase, agreement of sale, movables, addendum, plans, design
  manuals.
- `app/api/reclassify/route.ts` — targets files marked `other` OR unclassified
  OR classification_confidence < 0.5 (so manual `setFileType` corrections
  above 0.5 are safe). For each: uses cached `ocr_text` if present, else
  downloads and extracts text via `textFromFile` (pdf-parse / mammoth /
  raw). If text is empty (scanned image with no text layer), OCRs via
  OpenRouter's `file-parser` + `mistral-ocr` plugin (same path `/api/extract`
  uses). Regex classifier first; LLM fallback (single classify prompt,
  cheap) for the rest. Writes back `detected_doc_type_id`, `is_pii`,
  `classification_confidence`, and caches `ocr_text`. Skips photos and
  `.eml` wrappers.
- **UI**: "Reclassify unknowns (N)" button in the batch review header, only
  shown when N > 0. Sits between Classify and Extract fields (AI).

Cost sanity: ~$0.01 OCR + ~$0.001 LLM classify per unknown file. A batch with
3–5 unknowns costs a few cents.

**No migration needed.** Just push.

---

## MAP + DASHBOARD REWORK + SHARED TOP BAR (2026-07-06)

**First real front-end pass** — lifts the live app from an admin table shell
towards the wireframe fidelity (Estuary v0.3). Three ships in one:

**Shared top bar** (`app/components/TopBar.tsx` + `TopBarClient.tsx`) applied
to every signed-in page. Estuary navy, gold tideline underneath, brand mark
in Fraunces, nav tabs (Overview / Map / Properties / Triage / Dupes — the last
admin-only) with active-tab detection via `usePathname`, role pill (gold for
admin), signout. First shared spine the app has had. Login stays untouched.

**`/map`** — live-data map screen backed by property + latest listing + mandate
+ latest transfer. Mapbox GL with a custom navy map-drop pin, price rendered
directly on the pin body, coloured by mandate (gold Exclusive / forest Sole /
navy-ish Joint / amber Under offer / grey Open / darker grey None). Left rail:
mandate filter chips with counts + scrolling listing list. Right slide-in
preview card on pin click with address, mandate + status chips, asking price
(with a gold underline signature), extent / deed / transfer summary, and a
"Open property record →" CTA. Public Mapbox demo token as fallback; production
swap is `NEXT_PUBLIC_MAPBOX_TOKEN`. Empty states for zero properties or zero
geocoded.

**Geocoder** — `geocodeMissingProperties` server action + admin-only "Geocode
all" button in the map's top-right. Iterates properties where `lng is null`,
hits Mapbox Geocoding v6 forward endpoint (anchored to Knysna centre +
`country=za` + a Knysna/Sedgefield/Pezula regex guard for short addresses),
writes `lng, lat` back. Cheap enough at scale (500 folders ≈ ~$0). Uses
`MAPBOX_SECRET_TOKEN` server-side (falls back to the public token if not set).
Migration `0015_map_coords.sql` adds the `lng, lat` numerics — no geom sync
here (needs a PostGIS helper; deferred).

**Dashboard rework** — replaces the 3-link welcome with a proper landing:
KPI tiles (Properties / Transfers / In-conveyancing / Live listings, each with
a deep link) + a Recent activity strip pulling the last six committed
`ingest_batch` rows with a jump to their property record. Fraunces figures with
the gold tideline motif under each KPI value.

Styles are additive: ~350 new lines in `globals.css` for topbar, KPI tiles,
map shell, pin, preview card, and mandate colour semantics. No existing
classes changed; all previous pages still render fine.

**Needs `0015_map_coords.sql` run + a push.** First test: land on
/dashboard → nav tabs work; hit /map → "N of M pinned" bar shows in the
top-right (M is your property count); hit **Geocode all** → refresh → pins
appear coloured by mandate; click one → preview card slides in. For an
alternative Mapbox token set `NEXT_PUBLIC_MAPBOX_TOKEN` in Vercel.

Out of scope for this ship, on the follow-up list:
- Photo carousel in preview card (needs the media-table reshape).
- Basemap switching (satellite / streets / cadastral).
- `transfer.status` advance to `registered` when a title-deed doc is present
  (raised in earlier conversation) — still queued.
- Cosmetic: `IN_CONVEYANCING` → "In conveyancing" pill formatting.
- Sync `geom` from `lng, lat` (needs a small SQL helper).

---

## PHOTO CLASSIFICATION + INLINE-IMAGE FILTER (2026-07-05)

**Two extraction-pipeline bugs fixed** noticed while browsing committed data:

1. **Photos landed as `other`**. `lib/classify.ts` had zero image rules and the
   `document_type` seed had no `photo` code, so `IMG_1234.jpg` matched nothing
   and fell through. Added `photo` (category `photo`) to seed.sql + catch-up
   migration `0014_photo_doctype.sql` for Bon Bon's Database. Classifier now
   has an image-extension fallback (`.jpg .jpeg .png .heic .heif .webp .tif
   .tiff .gif .bmp`) that fires after the text rules miss, so a filename that
   says "Front Elevation.jpg" still hits the plan rule first.

2. **Bronwyn's Dream email signature/footer was being imported as attachments**.
   `app/api/unpack/route.ts` only skipped inline images that were both unnamed
   AND < 20 KB — but Outlook always names inline images (`image001.png`) and
   the Dream footer PNG is well over 20 KB, so they came through. Fixed to
   skip on the actual MIME signals: `contentDisposition === 'inline'`, mailparser's
   `related === true`, or a set `contentId` (cid: body reference). Plus a
   belt-and-braces regex against Outlook auto-names.

Interim: newly-classified photos still land as `document` rows on commit, not
`media` rows. A Photos section on Property Record + the media-table reshape are
a follow-up ship. For now `photo` is searchable + viewable via the existing
Documents section.

**Needs `0014_photo_doctype.sql` run against Bon Bon's Database + a push.**
Existing batches keep their prior classifications. Re-open a batch and hit
"Classify" to re-run against the updated ruleset — heads-up: `classifyBatch`
overwrites every file's `detected_doc_type_id` from the filename, so any manual
`setFileType` corrections in that batch flip back. A "reclassify only files
still marked `other`" pass would fix that, but is out of scope for this fix.

## POST-HOC DUPE FINDER (2026-07-05)

**Admin screen to merge duplicates that predate the matching flow** — replaces the
ad-hoc SQL DO block used on 2026-07-02 to clean up `15 Eagles Way × 2` and the
`7 The Grove` pair. Turns that pattern into a scan + merge that works from the
browser as new dupes surface.

**Migration `0013_dupe_finder.sql`** adds:
- `dupe_dismissal` table (unique on target_kind + normalized pair `a_id < b_id`,
  admin RLS) so "not a duplicate" judgments persist between scans.
- `find_property_dupes(threshold, limit)` — pairwise trigram scan on
  `primary_address` OR exact `title_deed_no` match, returns each side's label +
  deed + suburb + extent + counts (erven / transfers / listings) so the admin
  can pick the winner on evidence. Uses the pg_trgm GIN indexes from 0011.
- `find_party_dupes(threshold, limit)` — same shape for `display_name` OR exact
  `id_number` / `registration_no`. Only compares within the same `party_type`
  (won't cross individuals with juristics).
- `merge_properties(winner, loser, reason)` and `merge_parties(winner, loser,
  reason)` — security-definer, `is_admin()`-gated. Winner keeps id + non-null
  values; loser's non-null values fill winner's gaps (`coalesce` per column,
  notes concatenated with a merge marker). All FKs repointed; unique-constraint
  clashes on `erf`, `transfer_party`, `fica`, `party_member`, `document_link`
  resolved by dropping the loser's conflicting row first. Both spouse
  self-marriage and party_member self-membership guarded. Audit row logged;
  loser deleted; dismissal rows referencing loser cleaned up.
- `dismiss_dupe(kind, a_id, b_id, reason)` — normalises pair order and inserts
  idempotently.

**UI `/dupes`** (admin-only, `role === 'admin'` gate + admin-check in the RPCs):
tabs for Properties / Parties, adjustable score threshold (default 0.5), and one
`PairCard` per candidate showing the two sides side-by-side with field-level
diffs highlighted. Buttons: **Keep A → merge B**, **Keep B → merge A**, **Not a
duplicate** (with an optional reason that lands in the audit log). Linked from
the dashboard for admins only.

Typecheck green, `next build` compiles clean (12/12 pages; the `/login`
prerender-env error is the same known local-only issue — Vercel has the vars).

**Needs `0013_dupe_finder.sql` run against Bon Bon's Database + a push**. First
runtime test: rescan Properties tab — should be empty (the 2026-07-02 cleanup
already collapsed the historical dupes). Then re-run 15 Eagles Way (Vanessa
folder if there is one) as a batch and commit it to a new address form → the
next scan should surface the pair, and Keep-A-merge-B should collapse them.

Out of scope for this ship (follow-ups):
- Juristic-party matching in the *pre-commit* flow (still deferred from the
  2026-07-02 note). The post-hoc scan here already covers juristics.
- 3-way / n-way merge (only pairs today).
- Undo / restore-from-audit — the merge is destructive; the audit_log row is
  the only trace after loser deletion.

## MATCH/MERGE REVIEW UI (2026-07-02)

**Pre-commit fuzzy-match candidate review shipped** as the first duplicate-prevention
step for the 500-folder scale. Before this, `commit_batch` matched inline on exact
keys only (`title_deed_no`, `id_number`, `lower(entity_name)`), silently creating on
miss — guaranteed to duplicate "3 Oupad" vs "3 Oupad Road" etc.

New: **migration 0011_matching.sql** — enables `pg_trgm`; adds GIN trigram indexes on
`property.primary_address` + `party.display_name`; adds `find_property_candidates`,
`find_party_candidates` (individuals only for this ship — juristic parties deferred),
and `propose_matches(batch_id, fields)` which populates `match_candidate` rows.
Idempotent — decided rows (link/create) are preserved on re-run.
Auto-decides `link` when a target has exactly one candidate scoring ≥ 0.95, so
green batches with a perfect match still one-click.

`commit_batch` extended to honour explicit IDs: if `fields.property.id` is set (from
a "link" decision), it's used directly. Same per-party via `upsert_party` — an
`id` in the party jsonb short-circuits the match-or-create path.

New UI on `/triage/[id]`: **Matches panel** above the Proposed fields section.
Auto-runs `propose_matches` on first mount when there are extractions but no
candidates. Groups by target (Property / Seller N / Purchaser N). Each row shows
score, existing-record label, extracted-vs-existing summary. Two decisions:
**[Link]** on a candidate, or **[Create new record instead]** for the whole target.
**[Reset]** clears a decided target. **Commit is disabled** while any target has
neither a link nor an all-`create` decision — the button surfaces which targets
are open in its tooltip.

New server actions in `app/triage/actions.ts`: `proposeMatches(batchId, rows)` and
`decideMatch(batchId, targetRef, candidateId, decision)`. `commitBatch` reshape
folds `decision='link'` rows into `fields.property.id` and per-party `id`.

Compile + typecheck green (`✓ Compiled successfully`; prerender-time env error on
`/login` is local-only, Vercel has vars set).

**Coordination note (2026-07-02):** 0011 was written from the 0009 version of
`upsert_party` and silently dropped the `registration_no` + `party_member` handling
that 0010 had added. Reconciled by **0012_reconcile_upsert_party.sql**, which merges
both behaviours (explicit link from match-review + juristic-party members).
`commit_batch` from 0011 is unchanged and correct.

**Run order: 0010 → 0011 → 0012.** All three need to be applied against Bon Bon's
Database before push. First runtime test = drop a batch that references a
property/party already in the DB; UI should surface it as a candidate with score.
Also verify a juristic-party batch (e.g. re-run of Plot A4 shape) still captures
directors — that's what 0012 protects.

Rule for future shared-function migrations: read the **latest** definition (grep
all migrations in numeric order) before `create or replace`, and preserve every
behaviour already present. Applies especially to `upsert_party`, `commit_batch`,
and the helper casters.

**Post-merge dedupe (2026-07-02):** Test-run of the pipeline surfaced two
historical duplicate pairs in `property` that predated matching:
`15 Eagles Way, The Heads, Knysna` × 2 (both empty deed/suburb, 1046 m²) and
`7 The Grove, Leisure Isle` (empty) vs `7 The Grove, Leisure Isle, Knysna`
(deed T62677/2025, 614 m²). Cleaned with an ad-hoc merge DO block: most-complete
record wins, gaps filled from loser, erven/transfer/listing/ingest_batch/
document_link repointed, loser deleted. Property table: 8 → 6 rows. Matcher
would catch these on any new commit going forward.

Out of scope for this ship, on the follow-up list:
- Juristic-party matching (companies/CCs/trusts) — need trigram on `entity_name`
  + a `find_juristic_candidates` and matching UI path.
- Post-hoc dupe finder UI (the 7 The Grove / 15 Eagles Way merge was manual
  SQL; a proper screen would scan all `property` + `party` for likely dupes
  and let admin merge from the browser).
- "Merge two existing records" — the `merge` decision option in the schema.

## LIVE ON CUSTOM DOMAIN (2026-07-02)

App is live at **https://dreamproperties.app** (Cloudflare-registered domain → Vercel; apex A
`76.76.21.21` + www CNAME `cname.vercel-dns.com`, DNS-only; Vercel auto-SSL). Supabase Auth Site URL +
redirect URLs pointed at the new domain. This is the URL for Bronwyn.

Minor follow-up: OpenRouter attribution header in `app/api/extract/route.ts` still says
`app.dreamknysna.co.za` — cosmetic, update to dreamproperties.app on next push.

## PIPELINE COMPLETE (2026-07-02)

**Folder → live database record works end to end, proven on the hardest case.** Plot A4 Pezula —
a dual-company deal (Fortis Dux buying, BSANDAY selling), from a folder of scanned documents —
committed into live records: both parties as `company` with registration numbers, their UBO/director
as `party_member` rows, agreement/property/erf/mandate all captured. The full chain now runs in
production: drop → unpack .eml → classify → tier → name → AI extract (text + OCR + deep juristic) →
review/edit → commit (match-or-create). Also proven: 7 The Grove (text), 3 Oupad (scanned OCR),
169 Links (listing). Fixes this session: model slug, batch naming, input state binding, input width,
commit migrations 0009/0010 run.

---

## Now (current session — 2026-07-01)

**Started the build. Database-first, migration-led.**

- **Accounts stood up:** GitHub `BronwynDream/Dream-Properties-OS` (owned by Dream);
  Supabase project **"Bon Bon's Database"**, EU/Ireland region (POPIA-clean), healthy,
  no migrations yet. Simon's GitHub user `simonhoughton-source` to be added as a
  collaborator (Write) so his linked account can push while the repo stays Dream's.
- **Schema v0.1 written** as ordered Supabase migrations in `dream-os/supabase/migrations/`
  (0001 init → 0006 storage) + `seed.sql`. 35 tables, 24 enums. SQL validated (parses
  clean; no forward-reference FK problems). Not yet run against Supabase.

### Four structural gap-fixes baked in (from the 8-folder + 7 The Grove audit)
1. **Juristic parties** — `party` = individual OR company/CC/trust/partnership;
   `party_member` links directors/trustees/partners/UBOs + signatory flag.
   (Plot A4 = company; 7 The Grove = partnership.)
2. **Document versioning** — `agreement`/`document` carry status (template→draft→
   clean_final→executed) + version + supersedes_id.
3. **Plans + estates** — `media.kind` covers elevations/sections/floor/concept plans;
   `estate` holds design manuals + levies (Pezula, Thesen, Simola).
4. **Communications log** — `communication` gives email threads + the WhatsApp waiver
   a home. Plus: suspensive conditions, milestones (dated obligations), explicit offers,
   conveyancer firm→many contacts, nullable commission.

- **Drop-and-triage designed.** Spec at `dream-os/docs/drop-and-triage-spec.md`; staging
  tables shipped in `0007_staging.sql` (ingest_batch / ingest_file / extraction + RLS +
  private `staging` bucket). Pipeline: drop → parse/OCR → classify → AI extract →
  human confirm → transactional commit (mirrors the pilot). Nothing hits live tables
  until confirmed; batches are reversible.

- **Next.js app scaffolded (Phase A).** Login-gated shell at repo root — `/login`
  (Supabase email+password), `/dashboard` (protected, shows name+role), middleware
  session-gating, `@supabase/ssr` clients, Estuary-styled. **Build verified** (typecheck +
  `next build` both green). Vercel is linked to the repo → push auto-deploys.

## Next (immediate)
- [x] Pushed schema v0.1 to `BronwynDream/Dream-Properties-OS` (main @ 4ee7645, 10 files) via `simonhoughton-source`.
- [x] Ran migrations 0001–0006 + seed against "Bon Bon's Database" — all seven green. DB is live.
- [x] **App deployed & login working** on Vercel (`dream-properties-*.vercel.app`). Env vars set (publishable key = anon), redeploy baked them in. Auth → dashboard → RLS proven live.
- [x] Auth users + `app_user` rows live for Bronwyn (e34de424…) + Simon (eef1d2c1…), both admin. **Admin pill resolves in the app** — RLS role round-trip confirmed. Vanessa (agent) still to add.
- [x] Pilot **7 The Grove** loaded to "Bon Bon's Database" — ran green ("Success, no rows"). Golden record live: partnership seller + partners, joint buyers, executed agreement, waived condition, milestones, FICA, docs, comms. Schema proven against a real, awkward deal. Script: `dream-os/supabase/pilot_7_the_grove.sql`.
- [ ] Run `0007_staging.sql` + `0008_triage_queue.sql` against "Bon Bon's Database" (staging tables, bucket, tiering, `v_triage_queue`, `match_candidate`).
- [x] Triage screen v1 built (`/triage`): folder-picker drop zone → creates `ingest_batch` + `ingest_file`, uploads to `staging` bucket; queue list from `v_triage_queue`; gated route; linked from dashboard. Build verified. **Needs `0007`+`0008` run + a push to go live.**
- [x] Classification + batch-review screen built (`/triage/[id]`): rule-based filename→document_type
  classifier (`lib/classify.ts`), `classifyBatch` action sets types + PII + tier (red=juristic,
  green=agreement+FICA, amber=else), editable per-file type dropdown. **Verified 28/28 on real
  deal filenames.** Build green. Needs `0007`+`0008` run + push to go live.
- [x] **AI extraction wired** (`/api/extract`, OpenRouter). Downloads staging files, extracts text
  (docx via mammoth, text PDFs via pdf-parse, eml/txt as text), sends to LLM with strict JSON schema
  (`lib/extract.ts`), writes `extraction` rows; "Extract fields (AI)" button + proposed-fields view on
  the review screen; auto-classify on drop. Build verified. **Needs `OPENROUTER_API_KEY` in Vercel env
  + push.** Scanned-image PDFs (no text) return a "needs vision/OCR" note — that's the next extraction step.
- [x] **.eml unpacking** (`/api/unpack`, mailparser). Fixes the big gap: Bronwyn's `.eml` files bundle
  their attachments inside (e.g. 12 Eagles = 15 attachments in one 22 MB file). The route cracks each
  `.eml` open, extracts every attachment as its own staging `ingest_file`, keeps the body as text.
  Auto-runs on drop (unpack → classify); "Unpack emails" button on the review screen for existing batches.
  Build verified. Needs push (installs mailparser).
- [x] Fixes: default extraction model → `openai/gpt-4o-mini` (the `anthropic/claude-3.5-sonnet` slug
  returned "no endpoints" for the account — needs credit/enabling); batch auto-naming from the
  property/agreement/mandate doc (re-run Classify to apply — no more "Dropped files"). Build verified.
  Unpacking confirmed working live (batches now 16/19/32 files, tiers green/amber/red).
- [x] **Vision/OCR extraction** added to `/api/extract`. When a doc has no text, it sends the scanned
  PDF to OpenRouter with the `file-parser` plugin (`mistral-ocr` engine) or an image via vision, same
  JSON schema. Cost ≈ 3–5¢ per scanned agreement (OCR ~$2/1k pages + gpt-4o-mini structuring);
  ~$40–80 for the whole 500-folder migration. Build verified. Untested against live OpenRouter — the
  `file-parser`/`mistral-ocr` call needs a real run to confirm the plugin format.
- [x] Batch naming: rank-based (property_info→listing→agreement→mandate), plus a one-click
  **"Name batches from documents"** button on the queue that renames all generic "Dropped files"
  batches at once. Verified clean names on real files (e.g. "3 Oupad Morris to Wilson"). Build green.
- [x] **Extraction proven live** — text (7 The Grove docx, 14 fields, all correct incl. partnership seller)
  AND OCR (Oupad scanned agreement, 22 fields). Extended to **listing folders** (property_info / CMA /
  detailed_listing / mandate) so a mandate-only folder like 169 Links extracts property + asking price +
  mandate type, not just sales. Schema/prompt now cover listing.asking_price + mandate.type/expiry. Build green.
- [x] **Commit step built.** `0009_commit.sql`: `commit_batch(batch_id, fields jsonb)` RPC (security-definer,
  admin-gated) does atomic match-or-create → property (by deed) / party (by id_number, partnership-aware) /
  transfer / transfer_party / agreement / listing / mandate / conditions / commission, with safe casters.
  Editable proposed fields + "Commit to database" button on the review screen; `commitBatch` server action
  reshapes edits → RPC. Batch flips to `committed`. Build + SQL structure verified. **Needs `0009` run + push.
  RPC plpgsql untested at runtime — first real commit is the proof.**
- [x] **Deep extract + de-dupe.** Extractor now reads the top 6 docs (agreement + FICA + company docs),
  OCRs the executed agreement when it's a scan (so filled-in buyers come through), and captures
  company `registration_no` + directors/members/shareholders (`party_member`). Schema/prompt/mapping/reshape
  extended; commit handled by `0010_deep_commit.sql` (upsert_party stores reg no + members via upsert_individual).
  Classify now de-duplicates files ingested twice (folder had .eml + loose copies). Build + SQL verified.
  **Needs `0010` run + push. First real run confirms OCR-of-primary + member capture.**
- [x] **Property Record screens** built (`/properties` list + `/properties/[id]` detail): reads live
  property / erven / transfers / parties (+ juristic members) / agreements / milestones. Linked from
  dashboard. Committed deals are now viewable in the app, not just SQL. Build verified.
- [x] **Document promotion + viewer.** On commit, each classified file becomes a `document` row linked
  to the transfer + property (`ingest_file.committed_document_id` set, status→committed). Property Record
  now shows a **Documents** section per transfer with signed-URL view links (1h) and PII tags. Files stay
  in the `staging` bucket for now (private, staff-gated) — moving to dedicated documents/fica buckets is a
  later refinement. No new migration (document/document_link exist from 0004). Build verified.
  _Note: only NEW commits get documents; deals committed earlier (7 The Grove, Plot A4, Oupad) predate this._
- **⚠ Parallel-work note:** `0011_matching.sql` was added by Claude Code (not this session) — fuzzy
  trigram matching + `propose_matches` + explicit-link support. Good feature, BUT its `upsert_party`
  redefinition **dropped 0010's registration_no + members handling** (would regress juristic capture).
  **Fix: `0012_reconcile_upsert_party.sql`** merges both (explicit link + reg/members). Run order:
  …0010 → 0011 → **0012**. The matching functions are dormant until the app wires a match-review step.
- [x] **Post-hoc dupe finder** — `0013_dupe_finder.sql` + `/dupes` admin UI. Ships the browser-driven replacement for the manual DO-block merge. See top of file.
- [ ] Next: move files to documents/fica buckets; lead inbox; map; agent RLS test; juristic pre-commit matching.
- [ ] Commit `0007`, `0008`, `pilot_7_the_grove.sql`, `docs/drop-and-triage-spec.md` to GitHub.

**Scaling model (for ~500 folders):** decouple automated ingestion from human confirmation.
Bulk-drop (parent folder → one batch per subfolder), score each batch green/amber/red,
work a priority queue (active → recent → historical), one-click-approve green, merge-review
duplicates. "Two a day" = the first learning wave only, then waves of 25–50.

- **Hosting/deployment planned.** `dream-os/docs/deployment.md`. Recommended stack:
  **Next.js (React/TS) on Vercel** (auto-deploy from GitHub) + Supabase (EU) backend,
  app at `app.dreamknysna.co.za`. Personal data stays in Supabase; Vercel serves only the
  app shell (POPIA-safe). Path: scaffold Next.js + login → triage screen → deploy → DNS.
  _Pending Simon's nod on framework; only infra ask is DNS access for dreamknysna.co.za._

## Soon
- [ ] Reconcile the remaining PROJECT.md drift as screens/schema evolve.
- [ ] Conveyancer magic-link room RLS + client portal RLS (deferred from baseline).
- [ ] OCR pipeline for scanned/image PDFs (signed agreements come in image-only).

---

## Decisions this session
- Data-first sequencing: **lock schema → Supabase + storage + RLS → drop/triage loop → pilot on 7 The Grove → bulk migrate**, UI grown from there.
- Repo owned by Dream (`BronwynDream`), Simon accesses via collaborator grant, not by re-linking the connector.
- Interim "basic UI" = Supabase Studio (Table Editor + Storage) until the schema is proven against ~a dozen real folders.
- RLS baseline: admin full; agent scoped to transfers they lead; FICA bucket admin-only for now.
- Institute this `project.state.md`; keep it current each session.

## Open (needs Simon/Bronwyn)
- Supabase project-ref + whether to use CLI or SQL editor for first apply.
- Which historical folders to pilot after 7 The Grove (suggest Plot A4 next — exercises the juristic-party model).
- Lightstone API tier, P24/PP partner-feed credentials (still open from PROJECT.md).
