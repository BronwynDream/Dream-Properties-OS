# Plan 017: Document classifier extensions — 7 new document types, broader PII/FICA guard, filename rules for roll/zoning/electric-fence/guest-house

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 147ca38..HEAD -- lib/classify.ts lib/content-classify.ts`
> If either file changed since this plan was written, re-read against the
> "Current state" excerpts before proceeding.

## Status

- **Priority**: P2 (was P3 before the SQL results confirmed the misfile
  scope — plan now seeds 7 doc_types and gates FICA promotion, both
  higher-value than the original three-rule slice)
- **Effort**: M (one focused session; ~3–4 hours)
- **Risk**: LOW — new rules extend the ordered list, new codes seed
  idempotently, the broader guard tightens (never loosens) an existing
  check. Existing matches keep winning; nothing removes behaviour.
- **Depends on**: none for the code changes. For the GV cleanup, plan
  015 first (a Bowden Park merge in plan 015 would re-parent one of
  the two GV document rows onto the merge winner — clean that first
  so the GV-unlink SQL in `docs/qa/2026-09-28-cleanup.sql` doesn't
  fight with a stale ownership).
- **Category**: dx / tech-debt
- **Planned at**: commit `147ca38`, 2026-09-28. Revised 2026-09-28
  evening after Simon's SQL confirmed the GV was mis-tagged
  `id_document` (fa53fec3, category `fica`, is_pii_default true) and
  added six more missing doc_types (see Step 3).

## Why this matters

The 2026-09-28 live walkthrough at
`docs/qa/2026-09-28-live-walkthrough.md` and Simon's follow-up SQL
found several documents classified into wrong buckets — some visible
in the UI, some structural gaps in the type vocabulary:

1. **`KNYSNA-FULL-GV 2023-2028.pdf` mis-tagged `id_document`.** Two
   copies exist in production (document ids `4e64d78b`, `6ced0b39`),
   both in `storage_bucket='staging'`, both with `is_pii=true`, both
   with `doc_type_id=fa53fec3` (which resolves to `id_document`,
   category `fica`, `is_pii_default=true`). The content classifier
   matched the `id_document` rule on the density of names and ID
   numbers in the 22k-row roll. **The data cleanup for these two rows
   is in `docs/qa/2026-09-28-cleanup.sql` (GV CLEANUP block).** This
   plan closes the classifier hole so it can't happen again.

2. **`Quotation - Mr Smith.pdf` and guest-house / management accounts
   filed under OTHER.** Neither filename nor content classifier has a
   rule; they fall to the black-hole "other" bucket and Bronwyn can't
   filter for them.

3. **Six document types Bronwyn's workflow uses regularly that don't
   have a `document_type` row.** Missing codes (Simon, 2026-09-28):
   - `valuation_roll` — municipal roll (this plan seeds it, so GV
     files stop mis-classifying to `id_document`)
   - `zoning_certificate` — municipal zoning cert
   - `electric_fence_coc` — CoC checklist requires it but no code
     exists; agents can never mark the electric-fence compliance
     item complete because there's nothing to file
   - `quotation_invoice` — one code covering both (agents don't
     distinguish in practice per Simon)
   - `sectional_title_agreement` — new document from Bronwyn's final
     2026 templates
   - `condition_report_appendix` — the 2026 "Appendix to Property
     Condition Report (seller unable to complete)" template
   - `ppra_disclosure_vacant_land` — the vacant-land variant of the
     PPRA form Bronwyn added in the 2026 set

4. **The `id_document` (and any FICA-category) rule fires on any large
   document containing SA-ID-form text.** Even after adding
   `valuation_roll` rules, a differently-titled roll or a large
   legislation-style document with owner sections could trip the same
   bad promotion. Fix: broaden the guard — a document over a size
   threshold OR with a filename matching GV/valuation-roll can NEVER
   classify as `id_document` or any FICA-category code.

Fix: filename + content rules for the missing types, seed the six new
codes, broaden the FICA promotion guard, and cross-reference the
one-off GV cleanup that lives in the QA doc.

## Current state

**Files this plan touches:**

- `lib/classify.ts` — filename-based classifier, ~68 lines, ordered
  regex rules. Fall-through returns `"other"` if nothing matches.
  Adding a rule = one entry in the `RULES` array at lines 9-44.

- `lib/content-classify.ts` — content/text classifier, ~232 lines,
  ordered rules matched against the first 4000 chars of extracted
  text. Same shape. `CLASSIFIABLE_CODES` at lines 217-231 is the LLM
  fallback vocabulary — new codes must be added here too.

- `supabase/migrations/NNNN_doc_type_seeds_extended.sql` — new file
  seeding the six new `document_type` rows (see Step 3 for the code +
  category list).

**Documents that the GV cleanup addresses live in the QA doc**, not
here: see `docs/qa/2026-09-28-cleanup.sql` (GV CLEANUP block). This
plan does not include a "one-off fix specific GV row" step — that
data operation is a Simon-run SQL block already drafted there.

**Document types (schema-side):** the `document_type` table (seeded
via `supabase/migrations/0058_estate_seeds_and_doc_types.sql` and
earlier). New codes referenced by the classifier need matching seed
rows. Check current codes before inventing new ones:

```sql
select code, label, category from document_type order by category, code;
```

**Codes already present** relevant to this plan:
- `id_document` (fa53fec3 per Simon's SQL, category `fica`,
  `is_pii_default=true`) — the misfiring rule. Kept, gated with a
  size + filename guard in Step 2.
- `rates_account` — has filename + content rules. Handles per-property
  rates statements. A valuation roll is a municipality-wide document,
  not a per-property rates statement — the two are different.
- `estate_design_manual` — filename rule already exists at
  `lib/classify.ts:35`. Confirm the DB seed row exists (Row 6 of
  cleanup.sql relies on this code).
- `mandate` — see plan 009 for a related label update ("Mandate
  (Exclusive/Joint/Open)"). Not this plan's territory.

**Codes NOT present, seeded by this plan (Step 3):**
- `valuation_roll` (category `municipal`)
- `zoning_certificate` (category `municipal`)
- `electric_fence_coc` (category `compliance`)
- `quotation_invoice` (category `other`) — one code covering both
- `sectional_title_agreement` (category `agreement`)
- `condition_report_appendix` (category `mandate`)
- `ppra_disclosure_vacant_land` (category `mandate`)

**Repo conventions:**
- Regex rules are ordered; specific first, generic last (see
  `lib/classify.ts:5-6`).
- Content rules focus on the first 4000 chars (see `classifyContent`
  at line 206).
- Confidence values in `content-classify.ts` are 0.8-0.95.
- New document_type codes require a seed migration. Number the file
  as `supabase/migrations/NNNN_doc_type_seeds_extended.sql` using the
  next available number.

## Commands you will need

| Purpose         | Command                            | Expected                    |
|-----------------|------------------------------------|-----------------------------|
| Typecheck       | `npm run typecheck`                | exit 0                      |
| Build           | `npm run build`                    | exit 0                      |
| Dedup regression| `npm run test:dedup`               | PASS                        |

## Scope

**In scope:**
- `lib/classify.ts` (Step 1 — filename rules)
- `lib/content-classify.ts` (Step 2 — content rules + broadened
  FICA-promotion guard)
- `supabase/migrations/NNNN_doc_type_seeds_extended.sql` (Step 3 —
  seed six new codes)
- `plans/README.md` (mark plan status on completion)

**Out of scope:**
- **GV row unfile** — Simon-run SQL in `docs/qa/2026-09-28-cleanup.sql`
  (GV CLEANUP block). Cross-referenced from this plan but not
  duplicated.
- The LLM fallback classifier (`lib/classify-deep.ts`) — filename +
  content rules are cheaper and already the primary path.
- Bucket-selection UI on upload — separate UX question.
- Retroactive reclassify sweep across existing `other`-tagged
  documents — own future plan.
- The `/admin/valuation-rolls` flow — it handles the parse + apply
  path for muni rolls; whether the GV file should also live as a
  `document` row is a decision the cleanup SQL surfaces.
- Cancelling out-of-scope compliance items (electric-fence CoC
  requirement on properties that don't have an electric fence) —
  separate compliance-page UX plan.

## Git workflow

- Do NOT push. Simon owns push.
- One commit:
  `Plan 017: classifier rules for quotation/invoice/valuation-roll + GV unfile`

## Steps

### Step 1: Add filename rules for the six new codes

**Do:**

1. Read `lib/classify.ts` in full.

2. Insert the following rules into the `RULES` array. Ordering
   matters — insert them BEFORE line 38's `rates_account` rule so
   more-specific patterns win over the generic "rates|utility" match:

   ```ts
   // Valuation roll — municipality-wide statutory list of every
   // property's valuation. Distinct from a per-property rates account.
   // Placed BEFORE rates_account so 'KNYSNA-FULL-GV' doesn't fall to
   // the generic 'rates' rule. `full[- ]gv` is the exact shape Bronwyn's
   // uploads used (walkthrough 2026-09-28 flagged two such files).
   { re: /valuation\s*roll|\bgv[- ]?\d{4}|full[- ]gv/i, code: "valuation_roll" },
   // Zoning certificate — municipal certificate confirming permitted
   // uses on a property.
   { re: /zoning\s*(certif|schedule|rights)/i, code: "zoning_certificate" },
   // Electric-fence CoC — required by the compliance checklist but
   // no code existed until this plan (Simon, 2026-09-28).
   { re: /electric\s*fence.*(coc|cert)/i, code: "electric_fence_coc" },
   // Quotation + invoice — one code covering both (Simon: agents don't
   // distinguish in practice).
   { re: /\bquot(e|ation)\b|\binvoice\b|\btax\s*invoice\b|\bpro\s*forma\b/i, code: "quotation_invoice" },
   // Guest-house / management accounts — recurring statements from
   // a management company or letting agent. Bronwyn's sellers often
   // provide these when a guest-house is on the market. NOTE: this
   // rule routes to `rates_account` because `management_account` was
   // NOT in Simon's Step-3 seed list. If a distinct code is added
   // later, change the code below in-place.
   { re: /management\s*account|guest[- ]?house.*(account|statement|ledger)/i, code: "rates_account" },
   // Sectional-title agreement of sale — new template in the 2026
   // final set; distinct enough from freehold that Bronwyn wants
   // its own code.
   { re: /sectional[- ]?title.*(agreement|sale)/i, code: "sectional_title_agreement" },
   // Appendix to Property Condition Report (seller unable to complete)
   { re: /appendix.*condition report|condition report.*(appendix|seller unable)/i, code: "condition_report_appendix" },
   // PPRA disclosure — vacant land variant (distinct from the house
   // form). The house rule at line 15 stays as-is; this catches the
   // vacant-land subtype BEFORE it.
   { re: /ppra.*(vacant|land)|mandatory disclosure.*(vacant|land)/i, code: "ppra_disclosure_vacant_land" },
   ```

3. Do NOT modify the fall-through `IMAGE_EXT` block or the final
   `"other"` return. Do NOT reorder existing rules other than by
   inserting the new ones ahead of `rates_account`.

**Verify**:
- `grep -c "valuation_roll\|zoning_certificate\|electric_fence_coc\|quotation_invoice\|sectional_title_agreement\|condition_report_appendix\|ppra_disclosure_vacant_land" lib/classify.ts` >= 7
- `npm run typecheck` exits 0

**STOP if**:
- Any of the seven codes not-yet-seeded is used in a way that would
  hit a NOT NULL FK constraint before Step 3's migration lands.
  Order matters: Step 3 seeds the codes FIRST if a `.tsx` referring
  to them exists (grep confirms nothing today refers to them by name,
  so classifier + seed in either order is safe).
- Simon has confirmed the guest-house-account routing should NOT be
  `rates_account` (e.g. wants a new `management_account` code
  instead). Add the code to Step 3 and change the rule.

### Step 2: Add content rules + broaden the FICA-promotion guard

**Do:**

1. Read `lib/content-classify.ts` in full.

2. Add a shared FICA-promotion guard near the top of the file (above
   the `RULES` array, around line 8):

   ```ts
   // FICA-promotion guard (Simon, 2026-09-28).
   //
   // The id_document rule (and any FICA-category rule) fires on
   // "REPUBLIC OF SOUTH AFRICA + IDENTITY" text. That signature
   // appears in every SA ID card AND in every muni valuation roll,
   // deed lookup export, and any big legislation-heavy document —
   // because those documents list thousands of owners with their ID
   // numbers. The classifier tagged a 22k-row GV roll as an
   // id_document in production (walkthrough 2026-09-28, docs
   // 4e64d78b + 6ced0b39).
   //
   // A document is NOT eligible for id_document or any FICA-category
   // classification when either is true:
   //   (a) its extracted text is over 20_000 chars — real ID
   //       documents OCR to a few thousand chars, not tens of
   //       thousands. Even a full passport reads under 5k chars.
   //   (b) its filename matches GV / valuation roll patterns —
   //       these are municipal statutory documents regardless of
   //       PII content.
   //
   // Filename check is deliberately optional (many callers of
   // classifyContent pass only text). Text-length check is the
   // primary defence.

   const GV_FILENAME_RE =
     /valuation\s*roll|\bgv[- ]?\d{4}|full[- ]gv|knysna[- ]full[- ]gv/i;

   function isBlockedFromFica(text: string, filename?: string): boolean {
     if (text.length > 20_000) return true;
     if (filename && GV_FILENAME_RE.test(filename)) return true;
     return false;
   }
   ```

3. Extend `classifyContent`'s signature to accept an optional
   `filename`. Update the function signature at line 202:

   From:
   ```ts
   export function classifyContent(text: string): { code: string; confidence: number } | null {
   ```

   To:
   ```ts
   export function classifyContent(
     text: string,
     filename?: string,
   ): { code: string; confidence: number } | null {
   ```

   And inside the body, before the rule loop, add the guard:

   ```ts
   if (!text || text.length < 40) return null;
   const head = text.slice(0, 4000);
   const ficaBlocked = isBlockedFromFica(text, filename);
   for (const r of RULES) {
     // Skip id_document / FICA-category rules if the guard blocks.
     if (ficaBlocked && FICA_BLOCKED_CODES.has(r.code)) continue;
     if (r.test(head) || r.test(text)) {
       return { code: r.code, confidence: r.confidence ?? 0.85 };
     }
   }
   return null;
   ```

   Add the code allow-list constant near the guard function:

   ```ts
   // Codes that must be blocked from a document that trips the FICA
   // promotion guard. Kept in sync with the FICA category on the
   // document_type table (id_document, fica_questionnaire, kyc_form,
   // passport, marriage_certificate, proof_of_address).
   const FICA_BLOCKED_CODES = new Set<string>([
     "id_document",
     "fica_questionnaire",
     "kyc_form",
     "passport",
     "marriage_certificate",
     "proof_of_address",
   ]);
   ```

4. Update all callers of `classifyContent` to pass filename. Grep for
   them:

   ```
   grep -rn "classifyContent" app/ lib/ --include="*.ts" --include="*.tsx"
   ```

   Expected caller locations (verify): `lib/classify-batch.ts` and any
   route under `app/api/*` that does content-based classification.
   Each caller should already have the filename in scope; pass it as
   the second argument. If any caller doesn't have the filename,
   passing undefined is safe — the guard falls back to the text-length
   check.

5. Insert seven new content rules BEFORE the `rates_account` rule at
   lines 89-98, ordered specific-first:

   ```ts
   // Valuation roll — municipal-published statutory list. Header
   // usually names it explicitly. Placed above rates_account and
   // above id_document so it wins.
   {
     code: "valuation_roll",
     test: (t) =>
       /Valuation\s+Roll/i.test(t) ||
       /General\s+Valuation\s+Roll/i.test(t) ||
       /Municipal\s+Valuation\s+Roll/i.test(t) ||
       /Section\s+78.*Valuation/i.test(t),
     confidence: 0.9,
   },
   {
     code: "zoning_certificate",
     test: (t) =>
       /Zoning\s+Certificate/i.test(t) ||
       /Certificate of Zoning/i.test(t) ||
       /Zoning\s+Rights/i.test(t) ||
       /SPLUMA.*(certif|schedule)/i.test(t),
     confidence: 0.9,
   },
   {
     code: "electric_fence_coc",
     test: (t) =>
       /Electric\s*Fence.*(Certificate|COC|Compliance)/i.test(t) ||
       /SANS\s*10222.*3/i.test(t),
     confidence: 0.9,
   },
   {
     code: "quotation_invoice",
     test: (t) =>
       /^Quotation\b/im.test(t) ||
       /^Tax\s+Invoice\b/im.test(t) ||
       /^Pro[- ]?Forma\b/im.test(t) ||
       (/^Invoice\b/im.test(t) && !/statement of/i.test(t)) ||
       /Quote\s+(No|Number|Ref)\.?\s*[:#]?\s*\d/i.test(t) ||
       /Invoice\s+(No|Number|Ref)\.?\s*[:#]?\s*[A-Z\d-]+/i.test(t),
     confidence: 0.8,
   },
   {
     code: "sectional_title_agreement",
     test: (t) =>
       /Sectional\s*Title.*(Agreement|Sale)/i.test(t) ||
       (/Sectional\s*Title/i.test(t) && /PURCHASER/i.test(t) && /PURCHASE PRICE/i.test(t)),
     confidence: 0.9,
   },
   {
     code: "condition_report_appendix",
     test: (t) =>
       /Appendix.*Condition Report/i.test(t) ||
       /Condition Report.*(Appendix|Seller unable to complete)/i.test(t),
     confidence: 0.9,
   },
   {
     code: "ppra_disclosure_vacant_land",
     // Match FIRST — before the generic ppra_disclosure rule below.
     // The vacant-land form self-identifies by the additional-info
     // block reading "This Property is Vacant Land" (verbatim per
     // docs/templates/2026-final/mandatory-ppra-disclosure-form-vacant-land-2026.md).
     test: (t) =>
       (/PPRA/i.test(t) && /Vacant\s+Land/i.test(t)) ||
       /This Property is Vacant Land/i.test(t),
     confidence: 0.95,
   },
   ```

6. Add the seven codes to `CLASSIFIABLE_CODES` at lines 217-231.
   Group them alongside their nearest neighbours:

   ```ts
   export const CLASSIFIABLE_CODES = [
     "gas_coc", "electrical_coc", "electric_fence_coc", "beetle_cert", "boundary_relaxation",
     "fica_questionnaire", "kyc_form", "id_document", "passport",
     "marriage_certificate", "proof_of_address",
     "title_deed", "rates_account", "valuation_roll", "zoning_certificate",
     "company_resolution", "cipc_form", "trust_deed", "share_register", "vat_certificate",
     "mandate", "ppra_disclosure", "ppra_disclosure_vacant_land", "condition_report_appendix", "cma", "lightstone_report",
     "property_info", "detailed_listing",
     "offer_to_purchase", "agreement_of_sale", "sectional_title_agreement",
     "land_freehold_agreement", "movables_agreement", "addendum",
     "architectural_plan", "concept_plan", "estate_design_manual",
     "transfer_instruction", "email_thread",
     "photo",
     "quotation_invoice", "other",
   ];
   ```

**Verify**:
- `npm run typecheck` exits 0
- `grep -c "valuation_roll\|zoning_certificate\|electric_fence_coc\|quotation_invoice\|sectional_title_agreement\|condition_report_appendix\|ppra_disclosure_vacant_land" lib/content-classify.ts` >= 14 (7 rule keys × 2 sites each: rule + CLASSIFIABLE_CODES)
- `grep -n "isBlockedFromFica\|FICA_BLOCKED_CODES" lib/content-classify.ts` returns >= 3 matches (guard function, set, and one call site in the loop)
- `grep -rn "classifyContent(" app/ lib/ --include="*.ts" --include="*.tsx"` — every caller updated to pass filename OR explicitly justifies omitting it.

**STOP if**:
- Any caller of `classifyContent` fails typecheck after adding the
  optional argument. The `filename?: string` should make the change
  backwards-compatible; if it doesn't, one caller expects a specific
  arity (unlikely).
- The `id_document` size guard breaks classification of a real
  small ID document during manual verification.

### Step 3: Seed the six new document_type codes

**Do:**

1. Determine next migration number: `ls supabase/migrations/ | tail -3`.
   Use next-number + 1 in place of `NNNN`. If plan 015 is landing in
   the same session, coordinate — 015 doesn't add a migration but does
   change 0013's function definition; number this after 015's
   migration if it adds one.

2. Create `supabase/migrations/NNNN_doc_type_seeds_extended.sql`:

   ```sql
   -- Seed extended document_type codes surfaced by the 2026-09-28
   -- walkthrough + Simon's follow-up SQL. Categories match the
   -- existing document_type.category vocabulary — check before
   -- running:
   --   select distinct category from document_type;
   -- Adjust the category values below if any listed here isn't in
   -- the enum / accepted CHECK values.
   --
   -- Idempotent: ON CONFLICT DO NOTHING on the code column.

   insert into document_type (code, label, category, is_pii_default)
   values
     ('valuation_roll',             'Valuation Roll (municipality-wide)', 'municipal',  false),
     ('zoning_certificate',         'Zoning Certificate',                 'municipal',  false),
     ('electric_fence_coc',         'Electric Fence CoC',                 'compliance', false),
     ('quotation_invoice',          'Quotation / Invoice',                'other',      false),
     ('sectional_title_agreement',  'Sectional-Title Agreement of Sale',  'agreement',  false),
     ('condition_report_appendix',  'Condition Report Appendix (seller unable to complete)', 'mandate', false),
     ('ppra_disclosure_vacant_land','PPRA Disclosure Form — Vacant Land', 'mandate',    false)
   on conflict (code) do nothing;
   ```

3. Category values must be valid for the `document_type.category`
   column type. Check first:

   ```sql
   -- If category is a Postgres enum:
   select unnest(enum_range(NULL::document_category));
   -- If it's a text column with CHECK constraint:
   select conname, pg_get_constraintdef(oid)
     from pg_constraint
    where conrelid = 'document_type'::regclass and contype = 'c';
   ```

   The seven categories used above are `municipal`, `compliance`,
   `other`, `agreement`, `mandate`. `municipal` in particular is a
   likely gap — earlier migrations may only have `financial`,
   `agreement`, `mandate`, `fica`, `compliance`, `plans`, `other`.
   If `municipal` isn't a valid category:
   - Use `financial` for `valuation_roll` and `zoning_certificate`
     as a fallback (both are money-shaped municipal statements).
   - Note the deviation in the migration header.

   Similarly, if `is_pii_default` isn't a column on `document_type`
   (introduced later than the base seeds), drop that column from the
   INSERT.

4. Post to Simon:
   > **"Please apply `supabase/migrations/NNNN_doc_type_seeds_extended.sql`
   > to Bon Bon. Idempotent insert; paste back rowcount (expected 7)."**

**Verify**: file exists; Simon confirms rowcount 7 (or lower if some
codes already existed and hit ON CONFLICT).

**STOP if**:
- `municipal` isn't a valid `document_type.category`. Fall back to
  `financial` per the note above; update the migration in place
  before Simon runs it.
- `is_pii_default` isn't a column on `document_type`. Drop it from
  the INSERT.

### Step 4: Regression check + commit

**Do:**
1. `npm run typecheck`
2. `npm run build`
3. `npm run test:dedup`
4. Update `plans/README.md` — set plan 017 status to DONE.
5. Commit with the message in the Git workflow section.

## Test plan

No automated tests here (plan 012 is the harness). Manual verify:

- On preview deploy, send an email with attachment `Quotation - Test.pdf`
  to intake. Confirm `/triage` shows type `quotation_invoice`.
- Same for `Test Zoning Certificate.pdf` → `zoning_certificate`.
- Same for `Electric Fence CoC 2026.pdf` → `electric_fence_coc`.
- Upload a small valuation-roll snippet via `/admin/valuation-rolls`
  to sanity-check no double-storage vs the `document` row (the
  ingest path is separate; this is defensive).
- Simon: apply the GV CLEANUP block in `docs/qa/2026-09-28-cleanup.sql`
  and confirm the two GV rows (`4e64d78b`, `6ced0b39`) are unlinked
  from 6 Bowden Park.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm run test:dedup` exits 0
- [ ] `grep -c "valuation_roll\|zoning_certificate\|electric_fence_coc\|quotation_invoice\|sectional_title_agreement\|condition_report_appendix\|ppra_disclosure_vacant_land" lib/classify.ts` >= 7
- [ ] `grep -c "valuation_roll\|zoning_certificate\|electric_fence_coc\|quotation_invoice\|sectional_title_agreement\|condition_report_appendix\|ppra_disclosure_vacant_land" lib/content-classify.ts` >= 14 (7 rules + 7 in CLASSIFIABLE_CODES)
- [ ] `grep -n "isBlockedFromFica" lib/content-classify.ts` returns >= 2 (definition + one use)
- [ ] `grep -n "FICA_BLOCKED_CODES" lib/content-classify.ts` returns >= 2
- [ ] `ls supabase/migrations/NNNN_doc_type_seeds_extended.sql` exists
- [ ] Simon confirmed the migration applied to Bon Bon (rowcount 7)
- [ ] Simon confirmed the GV CLEANUP block in
      `docs/qa/2026-09-28-cleanup.sql` has run (separate from this
      plan's commit, but pre-req for the misfile to actually clear)
- [ ] `git status` clean

## STOP conditions

- `document_type.category` rejects any category in Step 3's insert.
  See Step 3's fallback (`municipal` → `financial`).
- `document_type.is_pii_default` isn't a column — drop from INSERT.
- The size / filename guard breaks classification of a real small
  ID document during manual verification.
- A caller of `classifyContent` doesn't have the filename in scope
  and can't reasonably pass it — safe to omit (guard falls back to
  text-length only), but note the site.

## Maintenance notes

- **The 20 000-char PII guard is a heuristic.** Adjust upward with
  evidence; do NOT adjust downward without recognising that some
  legitimate SA IDs OCR to 5–10 kB after full-page + reverse.
- **Filename regexes are English-only.** Bronwyn's documents are all
  English so this is fine today; extend to Afrikaans if that ever
  changes (e.g. "Waardasie Rolle" for valuation roll).
- **Guest-house / management accounts currently route to `rates_account`**
  per Simon's Step 1 note. If Dream starts handling many guest-house
  properties, elevate `management_account` to its own code + rule.
- **The `ppra_disclosure_vacant_land` rule uses the verbatim
  "This Property is Vacant Land" marker** from the 2026 template
  extract. If a future PPRA form changes that copy, the rule breaks
  — refresh from `docs/templates/2026-final/mandatory-ppra-disclosure-form-vacant-land-2026.md`.

## Follow-ups explicitly deferred

- Batch reclassify sweep over existing `other`-tagged documents.
- Bucket-selection UX audit (does upload UI let a user pick FICA
  bucket manually?).
- `management_account` distinct code (routed to `rates_account` for now).
- Cross-referenced but separate: GV CLEANUP in
  `docs/qa/2026-09-28-cleanup.sql` — data-only.
- Plan 009 addendum: relabel `document_type` code `mandate` to
  "Mandate (Exclusive/Joint/Open)". One UPDATE, added to plan 009's
  Step 7.
