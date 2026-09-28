# Plan 009: Document engine slice 1a — foundation (migration 0065 applied, mandate.type consolidated, clause library seeded)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 042b246..HEAD -- app/mandates app/documents app/globals.css lib/extract.ts supabase/migrations docs/templates`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> real mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (one focused session; ~4–6 hours including verification)
- **Risk**: MED — schema changes on live DB; wrong data migration would
  fragment mandate counts on `/mandates` and the expiry watchlist. All
  writes are reversible via the paired down-migration snippets in each
  step.
- **Depends on**: plan 007 (design) for the architectural rationale — read
  its "Slice 1" section (`plans/007-document-engine.md:133-165`) once
  before starting, then work from this plan.
- **Category**: migration + tech-debt
- **Planned at**: commit `042b246`, 2026-09-28

## Why this matters

Plan 007 designed the document engine and shipped the schema in
`supabase/migrations/0065_document_engine.sql` on 2026-08-05. Two things
have blocked slice 1b (resolver + `/documents` hub + editor + PDF) from
starting:

1. **Migration 0065 was never applied to Bon Bon.** The state file's
   "Next session starts here" (top of `project.state.md`) opens with this.
   Every downstream slice reads from these tables.
2. **`mandate.type` still carries `sole` and `exclusive` as separate enum
   values for the same legal concept** (Simon confirmed 2026-08-06). Any
   filter or count on one type undercounts the other. The mandates page
   currently offers both as separate chips.

This plan lands the data foundation so slice 1b can be a pure code slice:
tables present, mandate data consolidated on `exclusive`, and the clause
library seeded verbatim from Bronwyn's four mandate masters (three
property mandates plus the Business Mandate — the one already in scope for
slice 1). Bronwyn's masters are legally binding; **any wording difference
from her originals is a defect, not a preference** — the seed copies text
verbatim.

## Current state

The facts an executor needs, inlined.

**Schema files (already in repo, not yet applied to Bon Bon):**
- `supabase/migrations/0065_document_engine.sql` — 270 lines, adds:
  - `clause` + `clause_variant` tables (with `clause_category` and
    `clause_source` enums)
  - `doc_template` + `doc_template_slot` tables
  - `document_draft` table + `document_draft_status` enum
  - Four new columns on `mandate`: `asking_price`, `commission_pct`,
    `commission_incl_vat`, `term_months`
  - RLS policies for all five new tables (staff read; admin write on the
    library; agents own their drafts).

**Enum definition (from the original schema):**
```
supabase/migrations/0001_init.sql:48
  create type mandate_type as enum ('sole', 'joint', 'open', 'exclusive');
```

**Callers of `mandate.type` in the TypeScript code:**
- `app/mandates/page.tsx:12-13`:
  ```ts
  type MandateType = "exclusive" | "sole" | "joint" | "open";
  const MANDATE_TYPES: MandateType[] = ["exclusive", "sole", "joint", "open"];
  ```
- `app/mandates/TypeFilterChips.tsx:6`:
  ```ts
  const TYPES = ["exclusive", "sole", "joint", "open"] as const;
  ```
- `app/globals.css:1899`:
  ```css
  .mandate-sole      { --m-fill: var(--forest); --m-ink: #ffffff; }
  ```
  (And a paired `.mandate-exclusive` rule immediately above or below.
  Confirm both exist by grepping.)
- `lib/extract.ts:20`: prompt line
  `- mandate type is one of: sole, joint, open, exclusive.`
- `app/map/page.tsx:19-27` — `normaliseMandate()` already maps
  `.includes("exclusive")` before `.includes("sole")`; leave it as-is
  (still valid after consolidation, and it's the guard that stays honest
  if any legacy `sole` row appears in a backfill).

**Master template extracts (verbatim source for the clause seed):**
- `docs/templates/dream-properties-exclusive-mandate-template.md` (610 words)
- `docs/templates/dream-properties-dual-mandate-template.md` (1347 words —
  this is what Dream calls the "Joint" mandate, per the file heading and
  the plan 007 slice-1 mapping)
- `docs/templates/dream-properties-open-mandate-template-with-delcaration.md`
  (1105 words; note the misspelling in the filename is real, not a typo)
- `docs/templates/business-mandate--dream-knysna.md` (436 words — kept in
  the seed because plan 007's schema `doc_template.code` already
  enumerates business_mandate as a template; the row is registered even
  if the UI slice defers it).

**Repo conventions (match these):**
- **Migrations are numbered, verbatim SQL, one concern per file.** See
  `supabase/migrations/0063_no_snap_sectional_title.sql` for the header
  style (one paragraph explaining *why*, then SQL, then a paired backfill
  or one-time-effect note). New files this plan adds:
  `supabase/migrations/0067_consolidate_mandate_type.sql`,
  `supabase/migrations/0068_seed_clause_library.sql`.
- **Schema changes applied to Bon Bon must also land in the repo.** The
  reverse is the current problem — 0065 is in the repo, not on Bon Bon.
  See CLAUDE.md ("House rules") — schema drift is the load-bearing
  hazard.
- **Comments in SQL explain why, not what.** Match the header style of
  0065 itself (line 1-19).
- **Real quotes from Bronwyn go into `-- Simon, YYYY-MM-DD:` or
  `-- Bronwyn, YYYY-MM-DD:` inline comments where they shape a
  decision.** State file lines 46-54 and plan 007 lines 223-260 are the
  source for the mandate.type + commercial-terms decisions.

**Not applied to Bon Bon (per state file top):** 0065. This plan applies
it via the "Studio SQL editor" route described in `README.md:60-63`
(Option A), not the CLI (Option B) — because Bon Bon is a shared prod DB
and the CLI's `db push` behaviour on a project with an existing
`schema_migrations` divergence is not something Simon wants any executor
guessing at.

**What the executor CANNOT do without Simon**: apply SQL to Bon Bon. The
executor's scope stops at authoring the migration files + verifying they
parse. Simon runs them in Studio when he reads the plan output. This
matches how 0065 shipped originally (see 2026-08-05 state entry:
"SQL parse-checked with pglast (42 statements) ... Migration not applied
to Bon Bon yet").

## Commands you will need

| Purpose             | Command                                    | Expected on success                                |
|---------------------|--------------------------------------------|----------------------------------------------------|
| Install             | `npm install`                              | exit 0                                             |
| Typecheck           | `npm run typecheck`                        | exit 0, no errors                                  |
| Build               | `npm run build`                            | exit 0, 49+ routes compiled                        |
| Dedup test          | `npm run test:dedup`                       | exit 0, 2 assertions pass                          |
| SQL parse (locally) | `npx pglast supabase/migrations/0067_*.sql`| exit 0 (if pglast not present, skip — see below)   |
| SQL parse fallback  | copy the SQL into a Supabase SQL editor tab and click "Explain" — no execute | Explain succeeds without a syntax error |

`pglast` is a pip package (`pip install pglast`) — install locally if
convenient. The fallback works either way.

## Suggested executor toolkit

- Read `plans/007-document-engine.md:133-260` once for context on why
  slice 1 chooses these three mandate templates and why VAT-inclusive
  wording is a follow-up, not part of this seed.
- Read `docs/templates/README.md` for the ground rules on verbatim
  copying from Bronwyn's masters.

## Scope

**In scope (the only files you should create or modify):**
- `supabase/migrations/0067_consolidate_mandate_type.sql` (create)
- `supabase/migrations/0068_seed_clause_library.sql` (create)
- `app/mandates/page.tsx` (edit lines 12-49 — narrow `MandateType`)
- `app/mandates/TypeFilterChips.tsx` (edit line 6 — drop `"sole"`)
- `lib/extract.ts` (edit line 20 — drop `sole` from the prompt enum)
- `plans/README.md` (add / update the row for this plan on completion)

**Out of scope (do NOT touch, even though they look related):**
- `supabase/migrations/0065_document_engine.sql` — already merged, in
  repo; not applied to Bon Bon yet, but the file itself is settled.
  If you find something broken about 0065's SQL, STOP and report — do
  not amend a merged migration.
- `app/documents/templates/MandateSole.tsx` — the placeholder template
  built from the wrong (Business) master. Its replacement is slice 1b,
  not this plan. Leave the file alone; do not rename it, do not delete
  it.
- `app/globals.css:1899` `.mandate-sole` — leave the CSS class alone.
  It is harmless if unused, and removing it now would touch a global
  file for cosmetic reasons. Slice 1b will retire it with the template
  rewrite.
- `app/map/page.tsx` `normaliseMandate()` — the `.includes("exclusive")`
  match already catches `"exclusive"` before `"sole"`. Leaving both
  branches in makes the code resilient if any legacy `sole` row ever
  appears (e.g. from a PropCtrl re-import).
- Anywhere else `sole` appears in comments or file names.
- Migration 0066 (`contact_crm_v2.sql`) — plan 008's territory. Also
  not-yet-applied per plans/README, but that's plan 008's problem.
- Anything under `docs/templates/` — content is Bronwyn's; do not edit,
  only read.
- Any code under `app/documents/`, `app/properties/`, `app/pipeline/`,
  `app/dashboard/`, `app/map/` beyond what is listed in scope. Slice 1b
  will change those.

## Git workflow

- Do NOT push. Do NOT open a PR. Simon owns the push step from this
  device (device-bridge / Cowork writes can't push — see CLAUDE.md
  "Running from Cowork").
- Commit style from `git log --oneline -20`: short subject in the tense
  the change reads in (e.g. `Plan 009: apply migration 0065 and
  consolidate mandate.type`). No conventional-commits prefixes.
- One commit per step is fine; a single squashable commit at the end is
  also fine. Simon squashes to taste on the merge.

## Steps

### Step 1: Verify the drift check and inspect current DB state

Confirm the plan's assumptions about what's on `main` and what's on Bon
Bon before doing anything else.

**Do:**
1. `git rev-parse --short HEAD` — confirm it reports `042b246` or a
   descendant. If it doesn't, run the drift-check command in the header
   block and read the diff.
2. Read `supabase/migrations/0065_document_engine.sql:1-30` — confirm the
   header still describes the same three-layer split (skeleton / clause /
   field values). If the file's opening paragraphs have shifted from what
   this plan describes, STOP.
3. **Ask Simon to run this SQL in Bon Bon Studio and paste the result
   back** (do not proceed without it — the migration 0067 you author in
   Step 3 depends on knowing exactly what type values exist):

   ```sql
   -- Read-only: how many rows carry each mandate.type value today?
   select type, count(*) as n
   from mandate
   group by type
   order by n desc;
   ```

   Expected shape of the answer: a small table, likely with `exclusive`,
   `sole`, `joint`, and/or `open` rows. There may be zero `sole` rows
   (early days), in which case Step 3's data migration is a no-op that's
   still safe to author.

**Verify**:
- `git rev-parse --short HEAD` → `042b246` or a descendant
- `head -30 supabase/migrations/0065_document_engine.sql` → matches the
  quoted opening in "Current state"
- Simon has returned the row-count table from Bon Bon

**STOP if**:
- The count query returns any value NOT in `{sole, joint, open, exclusive}`
  — an unexpected fifth type means the plan's assumptions are wrong.
- Bon Bon reports `mandate` table does not exist — the schema is far
  further out of sync than expected.

### Step 2: Apply migration 0065 to Bon Bon

The migration is authored; this step ships it. **Executor: you cannot do
this directly.** Hand it to Simon and wait for confirmation.

**Do:**
1. Read the full 0065 file: `supabase/migrations/0065_document_engine.sql`
   (270 lines). Confirm it references `document_type`, `document`,
   `app_user`, `transfer`, `mandate`, `agreement`, `property`, `listing`
   — all present in earlier migrations. It also calls `is_staff()` and
   `is_admin()` and `set_updated_at()` — all defined in earlier
   migrations (search `supabase/migrations/` for the function
   definitions to confirm).
2. Post to Simon: **"Please apply `supabase/migrations/0065_document_engine.sql`
   to Bon Bon via Supabase Studio → SQL Editor → paste the full file →
   Run. If it errors, paste the error back."**
3. **Wait for Simon's "applied" confirmation** (or an error to
   troubleshoot together — most likely candidate: a shared function like
   `is_staff()` has changed signature since 0065 was authored, in which
   case investigate before altering).
4. Once applied: run this read-only check via Simon in Studio to confirm
   the tables + columns are present:

   ```sql
   select
     (select count(*) from information_schema.tables
        where table_name in ('clause','clause_variant','doc_template','doc_template_slot','document_draft')) as new_tables,
     (select count(*) from information_schema.columns
        where table_name = 'mandate'
          and column_name in ('asking_price','commission_pct','commission_incl_vat','term_months')) as new_mandate_cols;
   ```

   Expected: `new_tables = 5`, `new_mandate_cols = 4`.

**Verify**: Simon confirms the check query returns `(5, 4)`.

**STOP if**:
- Applying 0065 errors with anything you can't attribute to a specific
  earlier missing function or table. Report the error verbatim and stop
  — do not amend 0065 in place.
- The check query returns anything other than `(5, 4)`.

### Step 3: Author migration 0067 to consolidate `mandate.type` sole → exclusive

Data migration only. Do NOT modify the `mandate_type` enum itself — its
existing values (`'sole', 'joint', 'open', 'exclusive'`) stay valid so
any legacy import path keeps parsing, but the app stops writing `sole`
after Step 5. The `sole` label becomes a permitted-but-deprecated value.

**Do:**
1. Create `supabase/migrations/0067_consolidate_mandate_type.sql` with
   this content — verbatim, header included:

   ```sql
   -- Consolidate mandate.type: 'sole' and 'exclusive' are the same
   -- mandate at Dream (Simon, 2026-08-06). The enum carried both since
   -- 0001_init.sql, and a mandate stored under either was invisible to
   -- a filter on the other, so /mandates counts and the expiry
   -- watchlist both undercounted.
   --
   -- Data-only migration: rewrite existing 'sole' rows to 'exclusive'.
   -- The mandate_type enum keeps both values (Postgres does not support
   -- dropping enum values without a rebuild, and 'sole' being tolerated
   -- on read is defensively fine). Code stops writing 'sole' in the same
   -- change set — see app/mandates/page.tsx, app/mandates/TypeFilterChips.tsx
   -- and lib/extract.ts.
   --
   -- One-time effect. Safe to re-run — the update is idempotent (no
   -- 'sole' rows after the first run).

   update mandate
      set type = 'exclusive'
    where type = 'sole';

   -- Downgrade note (kept in comments, not executed): to reverse this
   -- data change, the caller would need a record of which rows were
   -- originally 'sole' — which we do not retain here. If revert is
   -- ever required, restore from a Bon Bon point-in-time snapshot
   -- prior to this migration.

   comment on type mandate_type is
     'Kept literal values sole/joint/open/exclusive. sole is DEPRECATED as of migration 0067 and is treated as an alias for exclusive; no code writes it. Do not add new usage.';
   ```

2. If `pglast` is installed, run
   `npx pglast supabase/migrations/0067_consolidate_mandate_type.sql`
   and confirm it parses (exit 0). Otherwise skip.

3. Post to Simon: **"Please apply `supabase/migrations/0067_consolidate_mandate_type.sql`
   to Bon Bon via Studio. It's a two-statement data migration — should
   report `UPDATE N` and `COMMENT`. Paste back the reported N."**

4. Wait for Simon's confirmation and the reported N. Sanity-check: N
   should equal the `sole` count reported in Step 1.

**Verify**:
- The file exists at `supabase/migrations/0067_consolidate_mandate_type.sql`
  and its diff matches the block above
- Simon confirms `UPDATE <N>` where N matches the earlier count
- Bon Bon confirmation via a follow-up read-only query (ask Simon to run):

  ```sql
  select type, count(*) from mandate group by type;
  ```

  Expected: no rows with `type = 'sole'`.

**STOP if**:
- Simon's applied N does not match the earlier count.
- Any post-check query still shows a `sole` row.

### Step 4: Author migration 0068 to seed the clause library

Seed the `clause` and `clause_variant` tables from Bronwyn's mandate
masters. Slice 1's targets are three mandate templates (Exclusive, Joint
= "Dual", Open) plus the Business Mandate (kept for template registry
completeness). Every clause body copies **verbatim** from
`docs/templates/*.md` — no rewording, no summarising, no smart quotes.

**How to structure the seed:**
- One `insert into clause (key, label, category, description) values (...)`
  block for every clause slot that a template references.
- One `insert into clause_variant (clause_id, label, body, applies_when,
  is_default, source, approved, approved_by, approved_at) select ...`
  block per variant, keyed by `clause.key` (which is unique per 0065's
  schema). `source` is always `'master_template'`; `approved` is `true`;
  `approved_by` and `approved_at` are `null` (unowned system-seeded
  variants — the schema allows this).
- Populate `is_default = true` on the standard/first variant per clause.

**Clause key convention** (chosen to match plan 007's examples in
`plans/007-document-engine.md:64-71`):
- `mandate.commission` (variants: `exclusive_vat` = "plus VAT thereon"
  wording; do NOT seed an `inclusive_vat` variant — Bronwyn's wording is
  pending per plan 007 "Open questions" line 278-280).
- `mandate.marketing_price` — the "It is agreed that the property will
  be marketed at ZAR______" paragraph.
- `mandate.term` — the "sole and exclusive mandate ... for a period of
  12 (Twelve) months" paragraph. Tokenise the numeric per plan 007
  lines 264-274: `{{term_months}} ({{term_months_words}}) months`. The
  six-month tail (commission still due if purchaser introduced during
  mandate buys within six months of expiry) stays hardcoded as `six
  (6)` in that same paragraph — do NOT tokenise it to `{{term_months}}`
  (state file / plan 007 line 271-274 flags this specifically).
- `mandate.popia_consent` — the "The Seller hereby gives Dream Knysna
  (Pty) Limited consent to process my / our personal information..."
  paragraph.
- `mandate.juristic_warrant` — the "In the event of any of the parties
  to this Agreement being a company, close corporation, trust..."
  paragraph.
- `mandate.defect_disclosure` — the "The Seller hereby warrants that
  he has disclosed all known defects on the property..." paragraph.
- `mandate.marketing_efforts` — the "Dream Knysna (Pty) Limited shall
  use their every endeavor to market..." paragraph. (Exclusive-master
  wording; Open and Joint may have their own variants — read both files
  and add a variant per master if the wording differs beyond
  whitespace.)
- `mandate.ffc_warranty` — the "DREAM KNYSNA (PTY) LIMITED (FFC 2026 –
  2028 No. 20261501621) hereby warrant the validity of the required
  FFC's..." line.

Add other slots as you find them in the master text — the list above is
the floor, not the ceiling. Each new slot needs a `clause` row and at
least one `clause_variant` row.

**Also seed the `doc_template` rows:**

```sql
insert into doc_template (code, label, component, requires_property, requires_purchaser, description, sort_order)
values
  ('mandate_exclusive', 'Exclusive Mandate', 'MandateExclusive', true,  false, 'Sole and exclusive mandate to market the property. Bronwyn''s standard for a seller who commits to Dream alone.',              10),
  ('mandate_joint',     'Joint Mandate',     'MandateJoint',     true,  false, 'Dual mandate co-held with another agency (typically Pam Golding / Knysna Plett Property Professionals).',                          20),
  ('mandate_open',      'Open Mandate',      'MandateOpen',      true,  false, 'Non-exclusive mandate; seller may work with any number of agents.',                                                                30),
  ('mandate_business',  'Business Mandate',  'MandateBusiness',  false, false, 'Sale of a business rather than a property — kept in the registry for completeness; not part of slice 1 UI.',                       90);
```

`component` names reference React components that do not yet exist in
`app/documents/templates/`. That is fine — slice 1b creates them.
`doc_template.active` defaults to `true` per 0065's schema; leave it
that way. The `doc_type_id` column is nullable — leave it null (the
`document_type` reference is out of scope; slice 1b wires it up when
the finalised-PDF path lands).

**Do NOT seed `doc_template_slot` rows in this plan.** Slot wiring
(which clause appears in which template, in what order, with which
`applies_when` condition) requires a manifest per template that only
makes sense to author alongside the React skeleton in slice 1b. Adding
speculative slots now creates orphan rows that slice 1b would need to
either delete or fight around.

**File header** (match the 0065 style):

```sql
-- Seed the clause library from Bronwyn's master templates.
--
-- Source: docs/templates/*.md, which are verbatim text extracts of the
-- master .docx files Bronwyn emailed 2026-08-04 (see docs/templates/README.md).
-- Every clause_variant.body below is copied verbatim from those files;
-- underscores are fill-in blanks in the originals, unchanged here except
-- where a token replaces them per plan 007 lines 264-274.
--
-- Slice 1's UI covers three property mandates (Exclusive, Joint, Open).
-- Business Mandate is registered in doc_template for completeness but
-- has no slice-1 UI. Agreement of Sale (house/plot) and the addendum/
-- movables templates are slice 2+ and NOT seeded here.
--
-- The VAT-inclusive commission variant is NOT seeded: Bronwyn's masters
-- only carry the "plus VAT thereon" (exclusive) wording, and her
-- inclusive-wording answer is a pending question (plans/007-document-engine.md
-- lines 278-280). Seeding a guessed inclusive variant would risk shipping
-- a wrong commission clause. Slice 1b's editor will treat this as a
-- missing variant and prompt the agent until Bronwyn confirms.
--
-- Idempotent on re-run: uses ON CONFLICT (key) DO NOTHING on clause and
-- ON CONFLICT (clause_id, label) DO NOTHING on clause_variant (add the
-- unique index inline in this migration since 0065 doesn't have it).
```

Add the following unique constraint at the top of the file so the
`ON CONFLICT` clauses have somewhere to land:

```sql
create unique index if not exists uq_clause_variant_clause_label
  on clause_variant(clause_id, label);
```

**Do:**
1. Read the three mandate template files in full:
   - `docs/templates/dream-properties-exclusive-mandate-template.md`
   - `docs/templates/dream-properties-dual-mandate-template.md`
   - `docs/templates/dream-properties-open-mandate-template-with-delcaration.md`
   (and briefly the Business Mandate file for its clause set).
2. Author `supabase/migrations/0068_seed_clause_library.sql`. Structure:
   - Header (per above)
   - `uq_clause_variant_clause_label` unique index
   - `insert into clause ... on conflict (key) do nothing` per slot
   - `insert into clause_variant ... on conflict (clause_id, label) do
     nothing` per variant, using `(select id from clause where key = '...')`
     for the clause_id
   - `insert into doc_template ... on conflict (code) do nothing` for
     the four templates above
3. Preserve Bronwyn's punctuation exactly. Her masters use straight
   quotes and dashes in some places, curly in others. Copy what's in
   `docs/templates/*.md` — those files are already the ground truth.
4. Where the same clause has a different wording across two masters
   (e.g. Exclusive vs. Open), create **one clause slot with two
   variants** (label them by which master they came from,
   e.g. `'Exclusive master'`, `'Open master'`) rather than two clauses.
5. Post to Simon: **"Please apply `supabase/migrations/0068_seed_clause_library.sql`
   to Bon Bon. It's insert-only; should report N inserts per statement.
   Paste back the total row counts."**
6. Wait for confirmation.

**Verify**:
- The file exists and parses (`npx pglast ...` if available)
- Simon confirms row counts land in a sensible ballpark:
  - `clause` count: >= 8 rows (the floor list above)
  - `clause_variant` count: >= 8 rows (at least one per clause)
  - `doc_template` count: exactly 4 new rows
- Ask Simon to spot-check by running:

  ```sql
  select c.key, cv.label, left(cv.body, 60) as body_preview
  from clause c
  join clause_variant cv on cv.clause_id = c.id
  order by c.key, cv.label;
  ```

  Read the previews back. Any wording that reads "close to Bronwyn's but
  not exact" is a defect — STOP and correct before proceeding.

**STOP if**:
- Any clause body has been paraphrased vs the master file.
- The unique index creation errors (a prior seed run may have created a
  conflicting index shape — investigate).
- Simon's row counts don't match your inserts.

### Step 5: Narrow `MandateType` in the TypeScript code so `sole` is no longer written

Only three files carry the string enum in the app layer. Change all three
so `"sole"` is no longer a valid value going forward. The DB enum keeps
tolerating it (see 0067's comment).

**Do:**

1. Edit `app/mandates/page.tsx` lines 12-13 from:

   ```ts
   type MandateType = "exclusive" | "sole" | "joint" | "open";
   const MANDATE_TYPES: MandateType[] = ["exclusive", "sole", "joint", "open"];
   ```
   to:
   ```ts
   type MandateType = "exclusive" | "joint" | "open";
   const MANDATE_TYPES: MandateType[] = ["exclusive", "joint", "open"];
   ```

2. Edit `app/mandates/TypeFilterChips.tsx` line 6 from:

   ```ts
   const TYPES = ["exclusive", "sole", "joint", "open"] as const;
   ```
   to:
   ```ts
   const TYPES = ["exclusive", "joint", "open"] as const;
   ```

3. Edit `lib/extract.ts` line 20 from:

   ```ts
   - mandate type is one of: sole, joint, open, exclusive.
   ```
   to:
   ```ts
   - mandate type is one of: joint, open, exclusive.
   ```

   Rationale: this is inside the LLM prompt for extracting mandate data
   from documents. Since 0067 collapses `sole` into `exclusive`, the
   model should be told the same. If a source document reads "sole
   mandate", the model should produce `exclusive`; the prompt drives
   that inference.

**Verify**:
- `npm run typecheck` → exit 0
- `npm run build` → exit 0, 49+ routes
- `npm run test:dedup` → exit 0 (regression check; unrelated but cheap)
- `grep -rn "'sole'" app/ lib/ --include="*.tsx" --include="*.ts"` → the
  only matches allowed are inside `app/map/page.tsx:19-27`
  (`normaliseMandate` fallback — deliberately kept). Any other hit is a
  missed edit; go find and fix it.
- `grep -rn "MandateType" app/ lib/ --include="*.tsx" --include="*.ts"`
  → every type union has three members, not four.

**STOP if**:
- Typecheck reports errors in files outside the in-scope list.
- The grep finds a `'sole'` hit outside `app/map/page.tsx`.

### Step 6: Update `plans/README.md` and commit

**Do:**

1. Edit `plans/README.md`:
   - Add the row for plan 009 with `Status: DONE (this session)`.
   - Update plan 007's status row to reflect that slice 1a is done and
     slice 1b (resolver + `/documents` hub + editor + PDF) is the
     remaining scope.
   - Under "Findings considered and rejected", add the audit rejections
     from this session (the advisor will provide the exact list — copy
     from the audit `## Considered and rejected` block).

2. Commit with one message, e.g.:
   ```
   Plan 009: apply migration 0065, consolidate mandate.type, seed clause library
   ```
   Include the three migration files, the three TypeScript edits, and
   the plans/README.md update in the same commit.

3. Do NOT push. Report back with the commit SHA and hand the push to
   Simon.

**Verify**:
- `git status` shows only the six in-scope files (five new/edited files
  + `plans/README.md`)
- `git log --oneline -1` shows the new commit

## Test plan

No new test files this plan — the changes are schema + data + type
narrowing, all covered by:
- `npm run typecheck` (proves the TypeScript narrowing is consistent)
- `npm run build` (proves the build still resolves)
- `npm run test:dedup` (regression baseline; unrelated but cheap)
- Simon's Bon Bon spot-check on clause bodies (proves the seed matches
  Bronwyn's wording)

**A characterization test for `lib/extract.ts` prompt behaviour would
be valuable but is out of scope** — plan 012 (test baseline) covers it.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git rev-parse --short HEAD` reports a new commit descended from
  `042b246`
- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm run test:dedup` exits 0
- [ ] `grep -rn "'sole'" app/ lib/ --include="*.tsx" --include="*.ts"`
  returns matches only in `app/map/page.tsx` (defensive
  `normaliseMandate`)
- [ ] The three new files exist:
  `supabase/migrations/0067_consolidate_mandate_type.sql`,
  `supabase/migrations/0068_seed_clause_library.sql`, plus the three
  TypeScript edits are in the commit
- [ ] `git status` reports a clean tree
- [ ] `plans/README.md` shows plan 009 as DONE and plan 007 as
  IN PROGRESS / slice 1a done, slice 1b remaining
- [ ] Simon has confirmed 0065, 0067, 0068 applied cleanly on Bon Bon
  and the spot-check clause-body previews read verbatim as Bronwyn's

## STOP conditions

Stop and report back (do not improvise) if:

- The Step-1 SQL result shows any `mandate.type` value not in
  `{sole, joint, open, exclusive}`.
- Applying 0065 errors — do not amend the file; report and wait.
- Simon's applied row count for 0067 does not match the Step-1 `sole`
  count.
- Any clause body would require paraphrasing to fit the SQL — Bronwyn's
  wording contains a character (curly quote, non-breaking space, em-dash)
  that trips the SQL string quoting. If you find one, ESCAPE it (single
  quotes double up as `''`; other characters pass through fine in
  Postgres) — do NOT rewrite the master.
- The clause library seed exposes a clause type that plan 007's
  `clause_category` enum doesn't have a value for. Report the missing
  category — do not amend the enum yourself.
- You discover that a template file in `docs/templates/` has been edited
  after this plan was written. That would mean the "verbatim" source has
  shifted; re-align with Simon before seeding.
- The check query in Step 2 returns anything other than `(5, 4)`.

## Maintenance notes

For the human/agent who owns this next:

- **Slice 1b (the next plan) will need to author `doc_template_slot`
  rows** — the many-to-many that says which clause appears in which
  template, in what order. That's deferred here because the ordering and
  `applies_when` conditions want to be authored in the same session as
  the React skeleton components, not speculatively.
- **The `MandateSole.tsx` component is still on disk.** It's the
  placeholder built from the wrong (Business) master; state file
  2026-08-06 documents this. Slice 1b will replace it with three
  properly-derived components (`MandateExclusive`, `MandateJoint`,
  `MandateOpen`). Do not delete it until its replacement lands, because
  `app/properties/[id]/documents/mandate/new/MandateEditor.tsx:6` still
  imports it and removing the file mid-session would break the mandate
  editor for Bronwyn.
- **DECIDED 2026-09-28 (Simon, confirmed with Bronwyn): **"plus VAT thereon" is final** and is the only seeded commission wording. VAT-inclusive commission happens in ~1 in 20 mandates a year; handle it as a per-document manual edit of the commission clause in the slice-1b draft editor (flagged on the document). Do not seed an inclusive variant. Seed source is `docs/templates/2026-final/`.** The note below is superseded.
- ~~**VAT-inclusive commission wording is a pending Bronwyn ask** (plan
  007 lines 278-280). The seed deliberately omits that variant so the
  slice-1b editor prompts an agent for it rather than silently defaulting
  to guessed text. When Bronwyn's wording arrives, add a new
  `clause_variant` on `mandate.commission` labelled e.g. `'Inclusive
  VAT'` with `applies_when = '{"commission_incl_vat": true}'::jsonb`
  and `is_default = false` (the exclusive variant stays default because
  it matches the master).~~
- **The `sole` enum value is now deprecated but still tolerated.** Do
  not later "clean it up" by dropping it from the enum without a schema
  rebuild plan — Postgres cannot drop an enum value with an outstanding
  reference in comments/checks, and the rebuild is disruptive on a live
  DB. Leaving it as an alias-on-read is the correct posture.

## Follow-ups explicitly deferred out of this plan

- Slice 1b — resolver, `/documents` hub, entry-point wiring, draft
  editor, PDF renderer. (Plan 007's remaining scope. Now unblocked:
  becomes plan 013. VAT decision recorded above.)
- Consolidating the `.mandate-sole` CSS class in `app/globals.css:1899`.
  Cosmetic; touching global CSS for this alone risks incidental
  regressions. Slice 1b will retire it with the template rewrite.
- Applying migration 0066 (contact CRM v2). Plan 008's territory.
