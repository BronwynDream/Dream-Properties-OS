# Plan 016: Screens agree — relabel Dashboard "In conveyancing", add Pipeline "asking" totals, order property-page listing by liveness

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 147ca38..HEAD -- app/dashboard app/pipeline app/properties/[id]/page.tsx lib/pipeline.ts`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> real mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (one focused session; ~3–5 hours)
- **Risk**: LOW — the changes are label-only (dashboard) and additive
  (pipeline gains a second total; property page gains an order-by
  priority). No queries are removed; no data model changes.
- **Depends on**: none. Composes with plan 015 (dupe-scan fixes) — plan
  015 fixes the underlying duplicated-property case that made #2 first
  visible on 6 Bowden Park, but the property-page ordering fix here is
  the resilience piece that would help even without dedup.
- **Category**: correctness / UX
- **Planned at**: commit `147ca38`, 2026-09-28

## Why this matters

The 2026-09-28 live walkthrough at `docs/qa/2026-09-28-live-walkthrough.md`
found three screens reading the same underlying data and reporting
different numbers:

1. **Dashboard says "Deals in flight: 3"; Pipeline says "15 deals in flight".**
   Same phrase, different definitions. Dashboard's query is
   `transfer WHERE status='in_conveyancing'` (per
   `app/dashboard/page.tsx:70-79`); Pipeline's query is
   `transfer WHERE status IN PIPELINE_STAGES` (six pre-terminal stages
   per `lib/pipeline.ts:26-34`). Both queries are correct; the label
   is misleading. Simon's decision (2026-09-28): dashboard keeps
   `in_conveyancing`-only, relabels to **"In conveyancing"**.

2. **Pipeline "Active" column totals R0.** The per-column total at
   `app/pipeline/page.tsx:244` reads `card.price`, which comes from
   `priceByTransfer` at line 122-128 populated from
   `agreement.price WHERE agreement_type IN ('sale_improved',
   'sale_land_freehold')`. Listings without a signed AoS yet contribute
   R0. Simon's decision (2026-09-28): show `listing.asking_price` as a
   separate labelled total ("asking R X"), keep the agreed-price total
   ("agreed R Y"). Both visible per column.

3. **Property page shows "No listing on this property yet" for
   6 Bowden Park while the dashboard shows a live listing on it.**
   Root cause is dedup (two property rows for 6 Bowden Park — see
   plan 015). But the property-page listing lookup at
   `app/properties/[id]/page.tsx:119-127` is also fragile in a
   different way: it orders by `created_at DESC` and takes the first
   row. If a property has been re-listed after a withdrawal, the
   newest row may be an old-but-current `withdrawn` or `expired`
   record and the display would say "no active listing" while the
   live one exists. Order by liveness first (active statuses before
   terminal statuses), then created_at DESC.

## Current state

**Files this plan touches:**

- `app/dashboard/page.tsx` — the misleading "Deals in flight" copy
  lives at lines 349 and 391. The query at lines 63-79 stays unchanged.
- `app/pipeline/page.tsx` — the priceByTransfer map (lines 122-128),
  the TransferCard type (lines 34-47), the PipelineColumn total
  render (lines 244, 269-271). Query at lines 108-119 already fetches
  `listing.id, listing.transfer_id` etc.; adding `asking_price` is a
  one-word `select` change plus a new map.
- `app/properties/[id]/page.tsx` — `listingRow` query at lines 119-127.
  Add a `.order` on a status-priority expression, keep the existing
  `.order("created_at", { ascending: false })` as the tiebreaker.
- `lib/pipeline.ts` — the existing pipeline vocabulary module. Gains
  a small helper for listing-status priority (used by the property
  page reorder) and `STAGE_LABEL` may need one addition — see step 1.

**Listing status enum** (`supabase/migrations/0001_init.sql:50`):
```
create type listing_status as enum ('draft', 'live', 'under_offer', 'sold', 'withdrawn', 'expired');
```

The "liveness" ordering Bronwyn cares about is: `live` and `under_offer`
first (a listing that's currently on the market or negotiating), then
`sold` (recently closed, transferred or not), then `draft` (not yet
active), then `withdrawn`/`expired` (dead). A property page showing
one listing should prefer the one that best represents the property's
current market status.

**Repo conventions:**
- Server components fetch data via `createClient()` → `.from(...)`.
- Copy strings are inline in JSX; no i18n layer. Change strings in
  place.
- `lib/pipeline.ts` is the single source for pipeline vocabulary — put
  the new helper there so future consumers can reuse it.

## Commands you will need

| Purpose         | Command                            | Expected                          |
|-----------------|------------------------------------|-----------------------------------|
| Typecheck       | `npm run typecheck`                | exit 0                            |
| Build           | `npm run build`                    | exit 0, 49+ routes                |
| Dedup regression| `npm run test:dedup`               | PASS                              |
| Grep verify     | `grep -n "Deals in flight" app/`   | see step 1                        |

## Scope

**In scope:**
- `app/dashboard/page.tsx` (Step 1 — copy relabel only)
- `app/pipeline/page.tsx` (Step 2 — add asking-price map + dual column totals)
- `app/properties/[id]/page.tsx` (Step 3 — order listingRow by liveness)
- `lib/pipeline.ts` (Steps 2 + 3 — add helper if reused)
- `plans/README.md` (mark plan status on completion)

**Out of scope:**
- The `find_property_dupes` RPC — plan 015 owns it.
- Any change to `transfer_status`, `listing_status`, or `agreement`
  schema — the walkthrough's mismatches are all queryable from
  existing shapes.
- The pipeline `DuplicateTransfersBanner` — it's an existing feature,
  works, and its filter logic is orthogonal to the column-total fix.
- The dashboard "Attention today" section (lines 162-260) — logic
  works; only the "Deals in flight" and "Live listings" section
  headers change.
- MapView.tsx — plan 012's characterization tests must land before any
  refactor of that file.

## Git workflow

- Do NOT push. Simon owns push.
- One commit at the end:
  `Plan 016: relabel dashboard "In conveyancing"; pipeline asking + agreed totals; property page listing order`

## Steps

### Step 1: Relabel dashboard "Deals in flight" → "In conveyancing"

**Do:**

1. Edit `app/dashboard/page.tsx:349` from:

   ```tsx
   title={isAgent ? "My deals in flight" : "Deals in flight"}
   ```

   to:

   ```tsx
   title={isAgent ? "My deals in conveyancing" : "In conveyancing"}
   ```

2. Update the comment at line 63 (currently
   `// 1. Deals in flight — for admins: all in_conveyancing; for agents:`)
   to match the new label:

   ```
   // 1. In conveyancing — the transfer.status='in_conveyancing' subset.
   //    NOT the entire pipeline; "deals in flight" was the old copy and
   //    it read as pipeline-wide, which caused a dashboard-vs-pipeline
   //    mismatch (walkthrough 2026-09-28). Pipeline shows all live
   //    stages; this dashboard column shows the transferring-now
   //    subset only.
   ```

3. If "Deals in flight" appears in any dashboard sub-copy (e.g., an
   empty-state message), update those too. Grep first:

   ```
   grep -n "deals in flight\|Deals in flight" app/dashboard/
   ```

   Change every match to the "conveyancing" language, preserving
   admin-vs-agent phrasing.

4. Leave `"Live listings"` / `"My live listings"` (line 391) as-is —
   Simon's decision was scoped to conveyancing labels; live listings
   is already accurate ("live" is the query filter and the column
   heading).

**Verify**:
- `grep -n "Deals in flight" app/dashboard/` returns nothing
- `grep -n "In conveyancing" app/dashboard/page.tsx` returns at least
  one match on the title line
- `npm run typecheck` exits 0

**STOP if**:
- The grep finds "Deals in flight" in files outside `app/dashboard/` —
  those are out of scope. Report and stop.

### Step 2: Add "asking" totals to Pipeline columns

**Do:**

1. Read `app/pipeline/page.tsx` in full, especially lines 99-128
   (queries + priceByTransfer) and lines 155-179 (card build).

2. Extend the `TransferCard` type at lines 34-47 with an `askingPrice`
   field:

   ```ts
   type TransferCard = {
     // ... existing fields ...
     price: number | null;         // agreed price from agreement.price
     askingPrice: number | null;   // asking price from listing.asking_price
     buyers: string[];
     // ... rest unchanged ...
   };
   ```

3. Update the listings query at lines 108-112 to include
   `asking_price`. Currently:

   ```ts
   supabase
     .from("listing")
     .select("id, transfer_id, property_id, agent_user_id, agent:agent_user_id(id, full_name)")
     .in("transfer_id", transferIds),
   ```

   Change to:

   ```ts
   supabase
     .from("listing")
     .select("id, transfer_id, property_id, agent_user_id, asking_price, agent:agent_user_id(id, full_name)")
     .in("transfer_id", transferIds),
   ```

4. Build an `askingByTransfer` map alongside `priceByTransfer`. Add
   after the existing `priceByTransfer` construction (around line 128):

   ```ts
   const askingByTransfer = new Map<string, number>();
   for (const l of (listings ?? []) as any[]) {
     if (l.asking_price == null) continue;
     askingByTransfer.set(l.transfer_id, Number(l.asking_price));
   }
   ```

5. Populate `askingPrice` in the card build at line 165-178:

   ```ts
   return {
     id: t.id,
     propertyId: t.property?.id ?? t.property_id ?? null,
     propertyAddress: t.property?.primary_address ?? null,
     status: t.status as PipelineStage,
     statusChangedAt: t.status_changed_at ?? null,
     daysInStage: days,
     price: priceByTransfer.get(t.id) ?? null,
     askingPrice: askingByTransfer.get(t.id) ?? null,
     buyers: buyersByTransfer.get(t.id) ?? [],
     sellers: sellersByTransfer.get(t.id) ?? [],
     agentName: agentJoin?.full_name ?? null,
     mandateType: mandate?.mandate_type ?? null,
     mandateExpiry: mandate?.expiry_date ?? null,
   };
   ```

6. Update `PipelineColumn` (lines 243-287) to compute + render both
   totals. Replace the current single-total block:

   ```tsx
   function PipelineColumn({ stage, cards }: { stage: PipelineStage; cards: TransferCard[] }) {
     const total = cards.reduce((s, c) => s + (c.price ?? 0), 0);
     // ... rest ...
     <p style={{...}}>
       <Rand value={total} />
     </p>
   ```

   With:

   ```tsx
   function PipelineColumn({ stage, cards }: { stage: PipelineStage; cards: TransferCard[] }) {
     const totalAgreed = cards.reduce((s, c) => s + (c.price ?? 0), 0);
     const totalAsking = cards.reduce((s, c) => s + (c.askingPrice ?? 0), 0);
     // ... existing stripe/border code ...
     <div style={{ margin: "2px 0 0" }}>
       {totalAsking > 0 && (
         <p style={{
           margin: 0,
           fontFamily: "'JetBrains Mono', ui-monospace, monospace",
           fontSize: 11,
           color: "var(--ink-600, #524a3d)",
         }}>
           <span style={{ color: "var(--paper-mute, #6a7692)" }}>asking</span>{" "}
           <Rand value={totalAsking} />
         </p>
       )}
       {totalAgreed > 0 && (
         <p style={{
           margin: totalAsking > 0 ? "2px 0 0" : 0,
           fontFamily: "'JetBrains Mono', ui-monospace, monospace",
           fontSize: 11,
           color: "var(--ink-700, #423B31)",
         }}>
           <span style={{ color: "var(--paper-mute, #6a7692)" }}>agreed</span>{" "}
           <Rand value={totalAgreed} />
         </p>
       )}
       {totalAsking === 0 && totalAgreed === 0 && (
         <p style={{
           margin: 0,
           fontFamily: "'JetBrains Mono', ui-monospace, monospace",
           fontSize: 11,
           color: "var(--paper-mute, #6a7692)",
         }}>
           <Rand value={0} />
         </p>
       )}
     </div>
   ```

   The "asking" row appears in gold/muted ink and reads first; the
   "agreed" row appears in darker ink below when there's a signed
   sale-agreement. Preserving colour + typography from the existing
   design (paper palette + JetBrains Mono per estate-agency-design
   skill).

7. Update the header pipeline total at lines 208-210 similarly.
   Currently:

   ```tsx
   <p className="app-sub" style={{ ... }}>
     Total pipeline value <Rand value={totalRand} />
   </p>
   ```

   Where `totalRand = scopedCards.reduce((s, c) => s + (c.price ?? 0), 0)`
   at line 197. Change to compute both totals and render both:

   ```ts
   const totalAgreed = scopedCards.reduce((s, c) => s + (c.price ?? 0), 0);
   const totalAsking = scopedCards.reduce((s, c) => s + (c.askingPrice ?? 0), 0);
   ```

   ```tsx
   <p className="app-sub" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12 }}>
     Total asking <Rand value={totalAsking} /> · agreed <Rand value={totalAgreed} />
   </p>
   ```

   Drop the old `totalRand` variable.

**Verify**:
- `npm run typecheck` exits 0
- `npm run build` exits 0
- `grep -n "askingByTransfer" app/pipeline/page.tsx` returns >= 1 match
- `grep -n "asking_price" app/pipeline/page.tsx` returns at least the
  select column + the map populate
- Visual verify: load `/pipeline` locally, confirm every column shows
  either "asking R X" alone (pre-sale-agreement stages), "asking R X"
  and "agreed R Y" (post-sale-agreement stages), or R0 (no listing at
  all). **Load in a browser — per CLAUDE.md house rule, don't rely on
  typecheck + diff for render changes.**

**STOP if**:
- `listing.asking_price` doesn't exist on the schema. It should — see
  `supabase/migrations/0003_deal.sql`. If not, the schema drift is a
  bigger problem than this plan can address.
- The Rand component signature changed (it's imported from
  `@/app/components/format`; check its props before assuming
  `<Rand value={x} />` still compiles).

### Step 3: Order property-page `listingRow` query by liveness

**Do:**

1. Add a listing-status priority helper to `lib/pipeline.ts` (or a
   new small module if you prefer — but keeping it in `lib/pipeline.ts`
   colocates it with the existing status vocabulary). Append at the
   bottom of the file:

   ```ts
   // Listing status priority for "which single listing best represents
   // this property's current state" lookups (e.g. the property record
   // hero, the AgentPicker default). Lower number = higher priority.
   // Actively-marketable statuses win over terminal statuses; among
   // terminals, sold beats withdrawn/expired.
   export const LISTING_STATUS_PRIORITY: Record<string, number> = {
     under_offer: 1,
     live:        2,
     draft:       3,
     sold:        4,
     withdrawn:   5,
     expired:     6,
   };
   ```

2. Edit `app/properties/[id]/page.tsx:119-127` — the `listingRow` query.
   Currently:

   ```ts
   const { data: listingRow } = await supabase
     .from("listing")
     .select("id, agent_user_id, agent:agent_user_id(name), mandate:mandate(type, expiry_date, evidence)")
     .eq("property_id", params.id)
     .order("created_at", { ascending: false })
     .limit(1)
     .maybeSingle();
   ```

   Change to fetch multiple rows, then sort in TypeScript using the
   priority table (Supabase can't sort by a JS-defined table). Pull
   `status` in the select:

   ```ts
   const { data: listingRows } = await supabase
     .from("listing")
     .select("id, status, agent_user_id, agent:agent_user_id(name), mandate:mandate(type, expiry_date, evidence), created_at")
     .eq("property_id", params.id);
   const listingRow = (() => {
     const rows = (listingRows ?? []) as any[];
     if (rows.length === 0) return null;
     rows.sort((a, b) => {
       const pa = LISTING_STATUS_PRIORITY[a.status as string] ?? 99;
       const pb = LISTING_STATUS_PRIORITY[b.status as string] ?? 99;
       if (pa !== pb) return pa - pb;
       // Same status priority — newer first
       return (b.created_at ?? "").localeCompare(a.created_at ?? "");
     });
     return rows[0];
   })();
   ```

   Add the import at the top:

   ```ts
   import { LISTING_STATUS_PRIORITY } from "@/lib/pipeline";
   ```

3. The downstream code (lines 129-145 — `listingForPicker`,
   `currentMandate`) already handles `listingRow` being null OR a
   single row. Nothing else changes.

**Verify**:
- `npm run typecheck` exits 0
- `grep -n "LISTING_STATUS_PRIORITY" app/ lib/` returns exactly two
  matches: the export in `lib/pipeline.ts` and the import in the
  property page
- Manual verify with a property that has multiple listings (any of
  the ones flagged in the 2026-09-28 walkthrough should do): confirm
  the property page shows the live listing, not a withdrawn/expired
  one.

**STOP if**:
- The property page has a second listing query later in the file that
  this plan didn't scope — the plan assumed only one listing lookup
  exists per property page. If there's a second, either it's
  functionally identical (should also be updated in the same PR) or
  it has a different purpose (leave it alone). Grep first:
  `grep -n "\.from(\"listing\")" app/properties/[id]/page.tsx` should
  return only one call.

### Step 4: Regression check + commit

**Do:**
1. `npm run test:dedup` — regression baseline.
2. `npm run build` — full route compile.
3. `git status` — confirm only the four in-scope files changed plus
   `plans/README.md`.
4. Update `plans/README.md` — set plan 016 status to DONE.
5. Commit with the message in the Git workflow section.

**Verify**:
- All three commands succeed
- Manual browser check on `/dashboard`, `/pipeline`, and one property
  page has been done (house rule: don't merge render changes without
  loading the app)

## Test plan

No new automated tests here — pipeline totals and dashboard labels are
render outputs. The intent is:

- `npm run typecheck` proves the TransferCard/askingPrice type addition
  is consistent across producers and consumers.
- `npm run build` proves no route regressed.
- **Browser verification is the load-bearing check.** Simon runs
  `npm run dev`, opens `/pipeline`, confirms each column shows the
  expected asking/agreed pair; opens `/dashboard`, confirms the
  "In conveyancing" title; opens 6 Bowden Park (or another
  multi-listing property once plan 015 has landed), confirms the live
  listing wins over stale ones.

Automated coverage of dashboard/pipeline totals is a plan-012 follow-up
if it becomes worth automating.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm run test:dedup` exits 0
- [ ] `grep -rn "Deals in flight" app/` returns nothing
- [ ] `grep -n "In conveyancing" app/dashboard/page.tsx` returns >= 1
- [ ] `grep -n "askingByTransfer\|asking_price" app/pipeline/page.tsx`
  returns >= 2 matches (map + select column)
- [ ] `grep -n "LISTING_STATUS_PRIORITY" app/ lib/` returns exactly two
  matches
- [ ] `git status` shows only in-scope files
- [ ] Simon has visually confirmed the three screens post-change

## STOP conditions

Stop and report back (do not improvise) if:

- Any query the plan modifies returns unexpectedly shaped data
  (Supabase nested-join arrays vs single objects — mandate join at
  line 122 is one such case; the current code already handles both
  shapes at line 141-144, so if you break that, revert and re-read).
- The Rand component's props changed since the plan was written.
- A property has legitimately null `asking_price` on its live listing
  (e.g. price-on-request) — the pipeline total should just skip that
  contribution (`if (asking_price == null) continue;` already handles
  this in Step 2's map builder). No STOP condition here; just a
  reminder.

## Maintenance notes

- **The "listing status priority" table is a judgement call.** If
  Bronwyn later says "no, a sold listing should never appear on a
  property record when a draft exists" (a different intuition), swap
  the priority values without changing the shape. Keep the table in
  `lib/pipeline.ts` so it's one place to edit.
- **The pipeline column colours** follow the estate-agency-design
  skill's paper palette. If a future redesign changes the palette,
  the CSS-variable references (`--ink-600`, `--paper-mute`) auto-
  update; the inline styles here are safe.
- **Pipeline totals could accumulate a lot of R0 columns** once the
  pipeline grows (a stage with no priced listings shows R0 asking + R0
  agreed). Consider hiding the R0 total once there are more than ~10
  stages; not a concern at Bronwyn's current volume.

## Follow-ups explicitly deferred

- Fixing 6 Bowden Park's actual "three different things" symptom (see
  #2 in the walkthrough). That resolves when plan 015 fixes the dupe
  scan and Simon runs the merge. Plan 016's property-page ordering
  fix is a resilience layer that helps even if dedup misses.
- Adding a `daysInStage` heat-map colour to the pipeline. Out of
  scope; own small plan.
- Consolidating dashboard's `daysBetween`-based attention ranking
  with the pipeline's status-based ordering. Different concerns; no
  need to merge.
