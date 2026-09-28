# Plan 015: Dupe-scan fixes — SG/muni-deed match, deed backfill, deed normalisation, party combined-name detection

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 147ca38..HEAD -- supabase/migrations lib/deed.ts`
> If a migration numbered above 0066 or a new `lib/deed.ts` appeared since
> this plan was written, re-read against "Current state" before proceeding.

## Status

- **Priority**: P2
- **Effort**: M (one focused session; ~4–6 hours)
- **Risk**: MED — three of the four scope items change the
  `find_property_dupes` / `find_party_dupes` SQL functions (via
  `create or replace`); the fourth is a one-shot data backfill on
  `property.title_deed_no`. Every change is reversible via a paired
  revert migration, but a wrong function definition would cause
  `/dupes` to show noise until fixed.
- **Depends on**: none for the code work. Data cleanup in
  `docs/qa/2026-09-28-cleanup.sql` should land BEFORE Simon runs the
  post-plan `/dupes` sweep, so cleaned-up junk properties don't
  clutter the results.
- **Category**: bug / correctness
- **Planned at**: commit `147ca38`, 2026-09-28

## Why this matters

The 2026-09-28 live walkthrough at `docs/qa/2026-09-28-live-walkthrough.md`
found two dupe-scan failures on real production data. Simon's SQL
follow-up confirmed root causes for both.

**1. `find_property_dupes` misses the two 6 Bowden Park rows.**

Simon's query result:
- `0af3d8a4` "6 Bowden Park, Leisure Isle, Knysna" — `title_deed_no` **NULL**
- `bab4629a` "6 Bowden Park Road, Knysna, Western Cape" — `title_deed_no` **T51294/2008** (length 11, exact)

The scan (0013_dupe_finder.sql:39-99) matches on trigram address
similarity OR `a.title_deed_no = b.title_deed_no`. The property page
for 0af3d8a4 shows T51294/2008 in the hero because line 504 of
`app/properties/[id]/page.tsx` reads:

```ts
const heroTitleDeed = prop.title_deed_no ?? muniPrimary?.title_deed_no ?? null;
```

So the deed is coming from `muni_property.title_deed_no` (linked via
the SG-code path: erf.sg_number → muni_property.sg_number). The dupe
scan doesn't look there.

Fix: extend the scan to consider the deed on `muni_property` via the
`erf.sg_number` link, AND treat two properties sharing the same SG
code as a duplicate (same surveyed erf = same property). Also backfill
`property.title_deed_no` from muni data where it's currently null, so
the property table stops being a lie-by-omission.

Also flagged separately (walkthrough P2 #14): title deed `43788/2018`
on 4 Waterfront Drive is missing its "T" prefix. If a future property
row's deed reads `T43788/2018` and another reads `43788/2018`, the
scan's `a.title_deed_no = b.title_deed_no` returns false. Normalise
before comparing.

**2. `find_party_dupes` misses combined-name purchasers.**

On 7 The Grove, three purchaser rows exist for two people:
- "Phil Davis"
- "Kate Davis"
- "PHILLIP ALFRED TRAYHORN DAVIS and KATHERINE DAVIS" (one party row
  holding two people, from an OTP/mandate signature line)

`similarity('Phil Davis', 'PHILLIP ALFRED TRAYHORN DAVIS and KATHERINE DAVIS')`
is well below 0.5 (trigram similarity of a 9-char string against a
45-char string with overlap on 3 substrings). The scan can't see the
match.

The upstream fix — the extract prompt splits "X and Y" into two rows —
is plan 011 Step 4. This plan is the downstream fix: extend
`find_party_dupes` so it detects a combined-name row and matches each
half against other individual parties.

## Current state

**Schema:**

- `property.title_deed_no` — `text`, nullable. Populated by intake
  extract and by manual edits. NOT reliably populated for older
  imports.
- `muni_property.title_deed_no` — `text`, populated by the muni
  import + valuation-roll upload flows. Primary key: `sg_number`.
- `erf.sg_number` — `text`, added by `supabase/migrations/0042_erf_sg_number.sql`.
  Links `erf` (property-scoped) to `muni_property` (municipality-wide).
- `erf.property_id` — FK to `property.id`.
- `party.display_name` — `text`, used by dupe scan.
- `party.party_type` — enum; scan only compares within same type.

**Dupe-scan RPCs**, both in `supabase/migrations/0013_dupe_finder.sql`:

- `find_property_dupes(p_threshold, p_limit)` (lines 39-99). Matches
  on trigram address OR exact `property.title_deed_no`. Does NOT
  consider erf → muni_property.
- `find_party_dupes(p_threshold, p_limit)` (lines 107-173). Matches
  on trigram `display_name` OR exact `id_number` OR exact
  `registration_no`. Compares only within same `party_type`.

**Property page hero deed fallback:** `app/properties/[id]/page.tsx:504`:

```ts
const heroTitleDeed = prop.title_deed_no ?? muniPrimary?.title_deed_no ?? null;
```

Where `muniPrimary` is populated at lines 75-112 from
`muni_property_public` view via the erf's sg_number.

**Repo conventions:**

- Migrations are numbered SQL, one concern per file. Match the header
  style of `0013_dupe_finder.sql`.
- The `find_*` RPCs use `create or replace function ... language sql
  stable`. Match this shape.
- Grants: `grant execute on function ... to authenticated;` at the
  end of each function definition.
- Long queries use CTEs (`with pairs as (...)`), scored via
  `greatest(...)`, filtered by threshold OR exact-match legs.
- Read-only helper functions use `language sql immutable`; data-modifying
  helpers use `language plpgsql security definer`.

## Commands you will need

| Purpose         | Command                            | Expected                    |
|-----------------|------------------------------------|-----------------------------|
| Typecheck       | `npm run typecheck`                | exit 0                      |
| Build           | `npm run build`                    | exit 0                      |
| Dedup regression| `npm run test:dedup`               | PASS                        |
| SQL parse       | `npx pglast supabase/migrations/00NN_*.sql` | exit 0 (if pglast present) |

## Scope

**In scope:**
- `supabase/migrations/NNNN_dupe_scan_v2.sql` (new — consolidates
  Steps 1, 3, 4 into one migration for atomic apply)
- `supabase/migrations/NNNN+1_backfill_property_title_deed.sql`
  (new — one-shot data migration for Step 2)
- `plans/README.md` (mark status on completion)

**Out of scope:**
- Fixing the intake path so `title_deed_no` gets set correctly at
  extract time — plan 011 already handles the extract prompt; the
  property.title_deed_no field is nullable by design (some intakes
  won't yet know the deed).
- Modifying `find_transfer_dupes` (if it exists — it doesn't) or any
  other dedup RPC.
- The property page's `heroTitleDeed` fallback — it's already correct;
  this plan brings the scan up to parity with what the page shows.
- Adding a "confidence tier" to party dupe matches. Keep the existing
  binary match/no-match.

## Git workflow

- Do NOT push. Simon owns push.
- One commit at the end:
  `Plan 015: dupe-scan v2 (SG/muni-deed match, deed backfill + normalise, combined-name party detection)`

## Steps

### Step 1: Add a deed-normalisation helper + new migration `NNNN_dupe_scan_v2.sql`

**Do:**

1. Determine next migration number: `ls supabase/migrations/ | tail -3`.
   Use next-number in place of `NNNN` (and `NNNN+1` for Step 2). If
   plan 017 also lands in the same session and takes a migration
   number, coordinate — this plan's migrations should number AFTER
   plan 017's.

2. Create `supabase/migrations/NNNN_dupe_scan_v2.sql`. Full content
   below. The migration:
   - Adds a `normalise_deed_no(text) returns text` immutable helper.
   - Redefines `find_property_dupes` to include the erf/muni join
     branch AND normalised-deed comparison.
   - Redefines `find_party_dupes` to include the combined-name split
     branch.

   ```sql
   -- ============================================================================
   -- Dream Knysna OS — 00NN dupe-scan v2
   -- ----------------------------------------------------------------------------
   -- Three fixes to the 2026-07 dupe finder, motivated by the 2026-09-28 live
   -- walkthrough (docs/qa/2026-09-28-live-walkthrough.md):
   --
   -- 1. find_property_dupes now considers the deed found on the muni_property
   --    row linked via erf.sg_number, not just property.title_deed_no. The
   --    6 Bowden Park pair (0af3d8a4 title_deed_no NULL; bab4629a T51294/2008)
   --    was invisible to the old scan because the NULL side made the deed-
   --    equality leg return NULL/false. The property page has always shown
   --    T51294/2008 for both because it reads muniPrimary.title_deed_no as a
   --    fallback (app/properties/[id]/page.tsx:504); the scan now does the same.
   --
   -- 2. Deeds are normalised before comparison — whitespace stripped,
   --    uppercased, "T" prefix ensured for the "43788/2018" shape (see
   --    walkthrough P2 #14). Two properties whose deeds differ only in
   --    formatting now count as duplicates.
   --
   -- 3. find_party_dupes now surfaces the "PHILLIP AND KATHERINE" combined-name
   --    row against separate "Phil" and "Kate" rows. The old scan compared
   --    trigram similarity on display_name; the combined-name row scored
   --    well below threshold against either half.
   --
   -- Companion migration: NNNN+1_backfill_property_title_deed.sql backfills
   -- property.title_deed_no from muni_property where currently NULL, so the
   -- scan works on both directions (join AND direct) without a second miss.
   -- ============================================================================

   -- ---------------------------------------------------------------------------
   -- normalise_deed_no — deterministic normalisation for equality comparisons.
   -- Handles: trailing whitespace, mixed case, missing "T" prefix,
   -- internal whitespace ("T 51294/2008").
   -- ---------------------------------------------------------------------------
   create or replace function normalise_deed_no(deed text)
   returns text
   language sql
   immutable
   as $$
     select case
       when deed is null then null
       when btrim(deed) = '' then null
       else
         case
           -- Bare digits/2018 shape ("43788/2018") — add T prefix.
           when upper(regexp_replace(deed, '\s+', '', 'g')) ~ '^[0-9]+/[0-9]{4}$'
             then 'T' || upper(regexp_replace(deed, '\s+', '', 'g'))
           -- Already has T (possibly with whitespace) — normalise to uppercase, no whitespace.
           else upper(regexp_replace(deed, '\s+', '', 'g'))
         end
     end;
   $$;

   grant execute on function normalise_deed_no(text) to authenticated;

   -- Quick sanity checks (comment block, not executed):
   -- select normalise_deed_no('T51294/2008')       -> 'T51294/2008'
   -- select normalise_deed_no(' T 51294/2008 ')    -> 'T51294/2008'
   -- select normalise_deed_no('t51294/2008')       -> 'T51294/2008'
   -- select normalise_deed_no('43788/2018')        -> 'T43788/2018'
   -- select normalise_deed_no('')                  -> NULL
   -- select normalise_deed_no(null)                -> NULL


   -- ---------------------------------------------------------------------------
   -- find_property_dupes v2 — adds muni_property + SG-code match legs.
   -- ---------------------------------------------------------------------------
   create or replace function find_property_dupes(
     p_threshold numeric default 0.5,
     p_limit     int     default 50
   )
   returns table (
     a_id uuid, a_label text, a_deed text, a_suburb text, a_extent numeric,
     a_transfer_count int, a_listing_count int, a_erf_count int,
     b_id uuid, b_label text, b_deed text, b_suburb text, b_extent numeric,
     b_transfer_count int, b_listing_count int, b_erf_count int,
     score numeric
   )
   language sql stable as $$
     -- Effective deed per property = property.title_deed_no if present,
     -- else muni_property.title_deed_no via erf.sg_number join. First
     -- match wins (a property with multiple erfs collapses to the first
     -- non-null deed).
     with property_deed as (
       select
         p.id as property_id,
         normalise_deed_no(
           coalesce(
             nullif(p.title_deed_no, ''),
             (
               select mp.title_deed_no
                 from erf e
                 join muni_property mp on mp.sg_number = e.sg_number
                where e.property_id = p.id
                  and nullif(mp.title_deed_no, '') is not null
                order by e.created_at asc
                limit 1
             )
           )
         ) as eff_deed,
         (
           -- Collect all SG codes for this property (may have multiple erfs)
           select coalesce(array_agg(distinct nullif(e.sg_number, '')) filter (where e.sg_number is not null), '{}')
             from erf e
            where e.property_id = p.id
         ) as sg_codes
       from property p
     ),
     pairs as (
       select
         a.id as a_id,
         a.primary_address as a_addr, a.title_deed_no as a_deed_raw,
         a.suburb_id as a_suburb_id, a.extent_sqm as a_extent,
         ad.eff_deed as a_eff_deed, ad.sg_codes as a_sg,
         b.id as b_id,
         b.primary_address as b_addr, b.title_deed_no as b_deed_raw,
         b.suburb_id as b_suburb_id, b.extent_sqm as b_extent,
         bd.eff_deed as b_eff_deed, bd.sg_codes as b_sg,
         greatest(
           -- Address trigram.
           case when a.primary_address is not null and b.primary_address is not null
                then similarity(a.primary_address, b.primary_address) else 0 end,
           -- Effective-deed equality (post-normalisation).
           case when ad.eff_deed is not null and bd.eff_deed is not null
                     and ad.eff_deed = bd.eff_deed
                then 1.0 else 0 end,
           -- Shared SG code (any overlap between the two arrays = same surveyed erf).
           case when array_length(a.sg_intersection(ad.sg_codes, bd.sg_codes), 1) > 0
                then 1.0 else 0 end
         ) as score
       from property a
       join property b on a.id < b.id
       join property_deed ad on ad.property_id = a.id
       join property_deed bd on bd.property_id = b.id
       where (
         (a.primary_address is not null and b.primary_address is not null
           and similarity(a.primary_address, b.primary_address) >= p_threshold)
         or (ad.eff_deed is not null and bd.eff_deed is not null
             and ad.eff_deed = bd.eff_deed)
         or (array_length(a.sg_intersection(ad.sg_codes, bd.sg_codes), 1) > 0)
       )
       and not exists (
         select 1 from dupe_dismissal d
         where d.target_kind = 'property' and d.a_id = a.id and d.b_id = b.id
       )
     )
     select
       p.a_id,
       coalesce(p.a_addr, p.a_deed_raw, p.a_eff_deed, 'Unknown'),
       coalesce(p.a_deed_raw, p.a_eff_deed),
       (select name from suburb where id = p.a_suburb_id),
       p.a_extent,
       (select count(*)::int from transfer t where t.property_id = p.a_id),
       (select count(*)::int from listing l where l.property_id = p.a_id),
       (select count(*)::int from erf e where e.property_id = p.a_id),
       p.b_id,
       coalesce(p.b_addr, p.b_deed_raw, p.b_eff_deed, 'Unknown'),
       coalesce(p.b_deed_raw, p.b_eff_deed),
       (select name from suburb where id = p.b_suburb_id),
       p.b_extent,
       (select count(*)::int from transfer t where t.property_id = p.b_id),
       (select count(*)::int from listing l where l.property_id = p.b_id),
       (select count(*)::int from erf e where e.property_id = p.b_id),
       round(p.score::numeric, 3)
     from pairs p
     order by p.score desc, p.a_id, p.b_id
     limit p_limit;
   $$;

   grant execute on function find_property_dupes(numeric, int) to authenticated;

   -- Array-intersection helper (SQL doesn't ship one that returns an array).
   create or replace function a.sg_intersection(a text[], b text[])
   returns text[]
   language sql immutable as $$
     select coalesce(array_agg(x), '{}') from (
       select unnest(a) as x
       intersect
       select unnest(b)
     ) t;
   $$;

   grant execute on function a.sg_intersection(text[], text[]) to authenticated;


   -- ---------------------------------------------------------------------------
   -- find_party_dupes v2 — adds combined-name split detection.
   -- ---------------------------------------------------------------------------
   -- Extraction can create one party row with display_name "X AND Y" (a joint
   -- signature line). The old scan compared trigram against other rows, and
   -- a 45-char combined string scored well below 0.5 against either half.
   -- v2 splits display_name on ' and | AND | & ', trigrams each fragment
   -- against every other individual party, and returns hits.

   create or replace function find_party_dupes(
     p_threshold numeric default 0.5,
     p_limit     int     default 50
   )
   returns table (
     a_id uuid, a_label text, a_type text, a_id_number text, a_reg text,
     a_transfer_count int, a_fica_count int, a_member_count int,
     b_id uuid, b_label text, b_type text, b_id_number text, b_reg text,
     b_transfer_count int, b_fica_count int, b_member_count int,
     score numeric
   )
   language sql stable as $$
     with
     -- Existing scan legs (trigram, id_number, registration_no).
     direct_pairs as (
       select
         a.id as a_id, a.display_name as a_name, a.party_type as a_type,
         a.id_number as a_idnum, a.registration_no as a_reg,
         b.id as b_id, b.display_name as b_name, b.party_type as b_type,
         b.id_number as b_idnum, b.registration_no as b_reg,
         greatest(
           case when a.display_name is not null and b.display_name is not null
                then similarity(a.display_name, b.display_name) else 0 end,
           case when nullif(a.id_number, '') is not null and a.id_number = b.id_number
                then 1.0 else 0 end,
           case when nullif(a.registration_no, '') is not null
                     and a.registration_no = b.registration_no
                then 1.0 else 0 end
         ) as score
       from party a
       join party b on a.id < b.id
       where a.party_type = b.party_type
         and (
           (a.display_name is not null and b.display_name is not null
             and similarity(a.display_name, b.display_name) >= p_threshold)
           or (nullif(a.id_number, '') is not null and a.id_number = b.id_number)
           or (nullif(a.registration_no, '') is not null
                and a.registration_no = b.registration_no)
         )
         and not exists (
           select 1 from dupe_dismissal d
           where d.target_kind = 'party' and d.a_id = a.id and d.b_id = b.id
         )
     ),
     -- Combined-name split: parties whose display_name is "X AND Y" (or & or and).
     -- Each fragment >= 4 chars (guards against noise), scanned against every
     -- other individual party. Split on any of: " AND ", " and ", " & ".
     combined_fragments as (
       select
         p.id as combined_id,
         trim(both from frag) as fragment
       from party p,
            regexp_split_to_table(p.display_name, '\s+(AND|and|&)\s+') as frag
       where p.party_type = 'individual'
         and p.display_name is not null
         and p.display_name ~* '\s+(AND|and|&)\s+'
     ),
     combined_pairs as (
       select
         c.combined_id as a_id, p_combined.display_name as a_name, p_combined.party_type as a_type,
         p_combined.id_number as a_idnum, p_combined.registration_no as a_reg,
         other.id as b_id, other.display_name as b_name, other.party_type as b_type,
         other.id_number as b_idnum, other.registration_no as b_reg,
         similarity(c.fragment, other.display_name) as score
       from combined_fragments c
       join party p_combined on p_combined.id = c.combined_id
       join party other
         on other.party_type = 'individual'
        and other.id <> c.combined_id
        and other.display_name is not null
        and length(c.fragment) >= 4
        and similarity(c.fragment, other.display_name) >= p_threshold
       where not exists (
         select 1 from dupe_dismissal d
         where d.target_kind = 'party'
           and d.a_id = least(c.combined_id, other.id)
           and d.b_id = greatest(c.combined_id, other.id)
       )
     ),
     -- Union direct + combined, normalise pair ordering (a_id < b_id).
     unified as (
       select a_id, a_name, a_type, a_idnum, a_reg,
              b_id, b_name, b_type, b_idnum, b_reg,
              score
       from direct_pairs
       union all
       select
         least(a_id, b_id)                          as a_id,
         case when a_id < b_id then a_name else b_name end as a_name,
         case when a_id < b_id then a_type else b_type end as a_type,
         case when a_id < b_id then a_idnum else b_idnum end as a_idnum,
         case when a_id < b_id then a_reg else b_reg end as a_reg,
         greatest(a_id, b_id)                       as b_id,
         case when a_id < b_id then b_name else a_name end as b_name,
         case when a_id < b_id then b_type else a_type end as b_type,
         case when a_id < b_id then b_idnum else a_idnum end as b_idnum,
         case when a_id < b_id then b_reg else a_reg end as b_reg,
         score
       from combined_pairs
     ),
     -- Keep only the highest score per pair (a fragment match + a direct
     -- trigram hit on the same pair collapses to one row).
     deduped as (
       select distinct on (a_id, b_id)
              a_id, a_name, a_type, a_idnum, a_reg,
              b_id, b_name, b_type, b_idnum, b_reg,
              score
         from unified
        order by a_id, b_id, score desc
     )
     select
       u.a_id,
       coalesce(u.a_name, 'Unknown'),
       u.a_type::text,
       u.a_idnum,
       u.a_reg,
       (select count(*)::int from transfer_party tp where tp.party_id = u.a_id),
       (select count(*)::int from fica f where f.party_id = u.a_id),
       (select count(*)::int from party_member m
         where m.entity_party_id = u.a_id or m.member_party_id = u.a_id),
       u.b_id,
       coalesce(u.b_name, 'Unknown'),
       u.b_type::text,
       u.b_idnum,
       u.b_reg,
       (select count(*)::int from transfer_party tp where tp.party_id = u.b_id),
       (select count(*)::int from fica f where f.party_id = u.b_id),
       (select count(*)::int from party_member m
         where m.entity_party_id = u.b_id or m.member_party_id = u.b_id),
       round(u.score::numeric, 3)
     from deduped u
     order by u.score desc, u.a_id, u.b_id
     limit p_limit;
   $$;

   grant execute on function find_party_dupes(numeric, int) to authenticated;
   ```

3. Parse-check with pglast if available:
   `npx pglast supabase/migrations/NNNN_dupe_scan_v2.sql`.

4. Post to Simon:
   > **"Please apply `supabase/migrations/NNNN_dupe_scan_v2.sql` to Bon
   > Bon. It's a function replace + one helper add; no data change.
   > After applying, please run these smoke queries and paste output:**
   >
   > ```sql
   > -- Should now surface the 6 Bowden Park pair with score = 1.00
   > -- (from the effective-deed match via muni_property).
   > select a_id, b_id, a_label, b_label, score
   >   from find_property_dupes(0.5, 20)
   >  where a_label ilike '%bowden%' or b_label ilike '%bowden%';
   >
   > -- Should now surface the 7 The Grove combined-name pair(s).
   > select a_id, b_id, a_label, b_label, score
   >   from find_party_dupes(0.4, 50)
   >  where a_label ilike '%davis%' or b_label ilike '%davis%';
   > ```

**Verify**:
- File exists at `supabase/migrations/NNNN_dupe_scan_v2.sql`
- pglast parse passes (if available)
- Simon confirms both smoke queries return the expected pairs

**STOP if**:
- The migration errors on apply. Most likely candidates: schema drift
  on `muni_property` (column renamed) or on `erf.sg_number` (0042 not
  applied). Do NOT amend the migration in place; report to Simon.
- The `array_intersection` / `intersection` helper name collides with
  a pre-existing function of the same name. Rename to
  `dupe_sg_intersection` and update the caller.
- The 6 Bowden Park pair still doesn't surface — the effective-deed
  logic works but the pair may still be in `dupe_dismissal` from an
  earlier scan. Simon runs:
  `select * from dupe_dismissal where target_kind='property' and (a_id='0af3d8a4' or b_id='0af3d8a4' or a_id='bab4629a' or b_id='bab4629a');`
  If any row exists, delete it first, then re-scan.

### Step 2: Backfill `property.title_deed_no` from muni_property

**Do:**

1. Create `supabase/migrations/NNNN+1_backfill_property_title_deed.sql`.
   The migration is a one-shot data update; idempotent (won't repopulate
   an already-non-null value).

   ```sql
   -- ============================================================================
   -- Dream Knysna OS — 00NN+1 backfill property.title_deed_no
   -- ----------------------------------------------------------------------------
   -- Companion to 00NN_dupe_scan_v2.sql. That migration extended the dupe
   -- scan to consider the deed via erf → muni_property; this migration
   -- backfills property.title_deed_no itself so future queries that read
   -- property.title_deed_no directly (property list page, dashboard, etc.)
   -- also stop showing NULL where the deed is knowable.
   --
   -- One-shot. Idempotent — the WHERE clause guards against overwriting
   -- an already-populated value.
   -- ============================================================================

   update property p
      set title_deed_no = (
        select mp.title_deed_no
          from erf e
          join muni_property mp on mp.sg_number = e.sg_number
         where e.property_id = p.id
           and nullif(mp.title_deed_no, '') is not null
         order by e.created_at asc
         limit 1
      )
    where p.title_deed_no is null
      and exists (
        select 1 from erf e
          join muni_property mp on mp.sg_number = e.sg_number
         where e.property_id = p.id
           and nullif(mp.title_deed_no, '') is not null
      );
   ```

2. Post to Simon:
   > **"Please apply `supabase/migrations/NNNN+1_backfill_property_title_deed.sql`
   > to Bon Bon. Data-only UPDATE; paste back rowcount."**

3. After Simon confirms rowcount:
   > **"Please run this verification:**
   > ```sql
   > select p.id, p.primary_address, p.title_deed_no
   >   from property p
   >  where p.id in ('0af3d8a4'::uuid, 'bab4629a'::uuid);
   > ```
   > **Both rows should now show T51294/2008 (bab4629a was already; 0af3d8a4
   > should be newly populated from muni_property via erf.sg_number)."**

**Verify**:
- File exists
- Simon confirms UPDATE N > 0
- Simon confirms 0af3d8a4 now shows T51294/2008 populated

**STOP if**:
- The UPDATE returns 0 rows but you expected non-zero. Either no
  property row has both a NULL deed AND an erf with a sg_number that
  matches a muni_property row — check by hand.
- Simon's post-check shows 0af3d8a4 still NULL. Then the erf for
  0af3d8a4 either has no sg_number or the sg_number doesn't match a
  muni_property row. Investigate:
  `select e.sg_number, mp.title_deed_no from erf e left join muni_property mp on mp.sg_number = e.sg_number where e.property_id = '0af3d8a4'::uuid;`.

### Step 3: (Deferred to plan 011 Step 4) Extract-time split for combined-name parties

**Nothing to do here.** Plan 011 Step 4 already covers the upstream
fix (extract SYSTEM_PROMPT tells the model to split "X and Y" into
two individuals). This plan's downstream fix (Step 1's
`find_party_dupes` v2) surfaces the existing bad rows.

Cleanup of the existing bad row on 7 The Grove and 159 Sharples Close
is out of scope for both plans — a merge on the combined-name row
won't help (it's one row that structurally should be two). The
sequence Simon needs to run manually once both fixes are live:

1. Find the combined-name party row (via the extended `find_party_dupes`
   surfacing it).
2. Note its `transfer_party.transfer_id` links.
3. Delete the combined-name row's `transfer_party` rows.
4. Delete the combined-name `party` row.
5. Re-run `/api/extract` for the source batch (extract now splits per
   plan 011 Step 4).
6. Confirm the two purchaser rows land + get linked.

This is a Simon operation, not a plan. Track in the post-plan-011
notes.

### Step 4: Regression check + commit

**Do:**
1. `npm run typecheck` — nothing TypeScript changed, but the check
   is cheap and catches any accidental TS drift.
2. `npm run build`.
3. `npm run test:dedup` — the existing test uses `find_property_dupes`
   only through the client via `dupes.ts`; unchanged.
4. Update `plans/README.md` — set plan 015 status to DONE.
5. Commit with the message in the Git workflow section.

**Verify**:
- Test + build both exit 0
- `git status` shows only the two migration files + README modified

## Test plan

No new automated tests here (RPC changes are testable in Postgres
directly, not through the existing `tsx` test harness). Manual
verification path:

- Simon's smoke queries (in Step 1's post-apply post) confirm both
  pairs surface.
- Load `/dupes` in browser — confirm the pairs render as cards.
- Attempt a merge on the 6 Bowden Park pair via the merge UI (only
  after Simon confirms Bronwyn's "sold 8 Jul" fact and the live
  R24.5m listing has been CLOSED, per the walkthrough note — the
  merge should not carry over a live listing on a registered property).

Automated regression tests for the RPCs are a plan-012 follow-up.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm run test:dedup` exits 0
- [ ] `supabase/migrations/NNNN_dupe_scan_v2.sql` exists
- [ ] `supabase/migrations/NNNN+1_backfill_property_title_deed.sql` exists
- [ ] Simon confirmed the migration + backfill applied on Bon Bon
- [ ] Simon confirmed the 6 Bowden Park smoke query returns the pair
      with score 1.00
- [ ] Simon confirmed the Davis smoke query returns the combined-name
      pair(s)
- [ ] 0af3d8a4's title_deed_no is populated post-backfill

## STOP conditions

- Migration errors on apply — do NOT amend in place; report and stop.
- The array-intersection helper name conflicts with something existing.
- Bowden Park pair still doesn't surface after apply — check
  `dupe_dismissal`.
- Backfill rowcount is unexpectedly zero.
- 6 Bowden Park's live R24.5m listing is still `status='live'` when
  Simon runs the merge — cancel/withdraw the listing first
  (`update listing set status='sold' or 'withdrawn'`); merging shouldn't
  carry a live listing forward onto a registered property.

## Maintenance notes

- **The `normalise_deed_no` helper is IMMUTABLE.** If a new
  deed-format quirk appears (e.g. old Cape deeds prefixed "CT",
  fractional numbering), extend the CASE branches and bump the
  function version via `create or replace`. Since it's immutable,
  any expression indexes using it will need reindex.
- **The `sg_codes` array on `property_deed`** is computed per query.
  If dupe scans grow slow at N properties, materialise as a view or
  denormalise onto property.
- **`find_property_dupes` now returns a fabricated "effective deed"
  when property.title_deed_no is null.** Callers reading the
  `a_deed` / `b_deed` column may see a value that isn't in
  `property.title_deed_no` (yet) — this is intentional. The backfill
  in Step 2 closes that gap for existing rows; future new rows may
  transiently show the effective deed until the property.title_deed_no
  is populated by a subsequent intake or Simon-run backfill.
- **The party combined-name split is regex-only** — it handles
  " and ", " AND ", " & ". If Bronwyn's forms use " en " (Afrikaans),
  add it to the split pattern. If a purchaser's legal name contains
  " and " (rare but possible: "David Smith and Sons Trust"), the
  scanner will produce noise — that's caught by trigram threshold on
  each fragment (a match against unrelated names scores low).

## Follow-ups explicitly deferred

- Reclassify sweep to fix existing property.title_deed_no populated
  from non-normalised sources. Not urgent; the backfill in Step 2
  fills NULL cases which is the load-bearing gap.
- Party-side backfill (analogous to Step 2) that decomposes existing
  combined-name party rows into two individuals + a joint marker.
  Manual per row today; a batch script is worth building only if the
  count exceeds ~20 rows post-cleanup.
- Adding a `combined_name_source` column to `party` to preserve the
  original signature-line text when decomposing. Would help audit
  trail; own tiny plan if it becomes an issue.
- Adding a `find_transfer_dupes` scan for the "duplicate transfers on
  one property" case surfaced by the existing DuplicateTransfersBanner
  in `app/pipeline/DuplicateTransfersBanner.tsx`.
