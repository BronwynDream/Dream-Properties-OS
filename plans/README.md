# Implementation Plans

Two `/improve` runs to date:
- 2026-07-26 at commit `f3b6711` — plans 001–006 (all DONE).
- 2026-09-28 at commit `042b246` — plans 009–012, then 015–017 from the same-day live walkthrough at `docs/qa/2026-09-28-live-walkthrough.md`.

Plans 007 and 008 came out of standalone Simon+Claude sessions. Plans 013 and 014 are reserved (see the numbering note under the table). Execute in the order below unless dependencies say otherwise. Each executor: read the plan fully before starting, honor its STOP conditions, and update your row when done.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | Parallelise signed-URL generation on Property Record | P1 | S | — | DONE (merged 2026-07-26 as `daf44f0`) |
| 002  | Harden LLM extraction against document-borne prompt injection | P1 | M | — | DONE (merged 2026-07-26 as `46f6811` + `d994154`; migration 0043 pending manual application in Supabase Studio) |
| 003  | Lead Inbox v1 — unified view of email-sourced enquiries | P1 | M | 002 | DONE (merged 2026-07-26 as `a5e0dff` + `6d3bfc0`) |
| 004  | Firecrawl Property24 scraper as a new `external_listing` source | P2 | M | — | DONE (merged 2026-07-26 as `dd17bd2`; `FIRECRAWL_API_KEY` set in Vercel) |
| 005  | Replace map pins with cadastral polygon shading | P1 | M | — | DONE (merged 2026-07-27 as `f4af39e` + `49e9c45`; migration 0045 pending manual application in Supabase Studio) |
| 006  | Contact CRM — party search + role timeline | P1 | M | — | DONE (merged 2026-07-27 as `86baf7f` + `d04a3c6`; migration 0046 pending manual application in Supabase Studio) |
| 007  | Document engine — template library, clause library, context-aware fill | P1 | L | 006 | IN PROGRESS (design done 2026-08-05; slice 1a DONE via plan 009 2026-09-28; slice 1b = resolver + `/documents` hub + editor + PDF, unblocked 2026-09-28: "plus VAT" is final, inclusive is a rare manual edit; plan as 013) |
| 008  | Contact CRM v2 — agent contact books, interest matching, compliant outreach | P1 | L | 006 | IN PROGRESS (planned 2026-08-06; migration 0066 written, not applied. Slice 1 = import + interests + consent; bulk send GATED on NCC registration) |
| 009  | Document engine slice 1a — apply migration 0065, consolidate `mandate.type` sole→exclusive, seed clause library | P1 | M | 007 (design) | DONE: code on main (085982f); migrations 0065, 0066, 0067, 0068 applied to Bon Bon 2026-09-28 via SQL editor, verified (9 clauses, 19 variants, 3 templates, 0 sole) |
| 010  | Dependency vulnerability sweep — `npm audit fix` non-breaking (mailparser, pdfjs-dist, transitives) | P1 | S | — | TODO |
| 011  | Intake commit-path integrity — parse failures, `document_link` errors, non-property subject guard, purchaser split | P2 | M | — | TODO — extended 2026-09-28 evening after the live walkthrough added #4B (intake guard) and #5A (extract split-combined-names) |
| 012  | Characterization test baseline — 3 new tests for dedup match, extract parse, commit link-fail | P2 | M | 011 (recommended, not required) | TODO |
| 013  | *reserved* — Document engine slice 1b (resolver + `/documents` hub + editor + PDF) | P1 | L | 009 | RESERVED — will be written after 009 lands on Bon Bon |
| 014  | *reserved* — Next.js major upgrade (14 → 15 → 16 + postcss) | P2 | L | 010 | RESERVED — the "breaking" half of plan 010's `npm audit fix --force` path |
| 015  | Dupe-scan v2 — SG/muni-deed match on 6 Bowden Park; deed normalisation + backfill; party combined-name detection | P2 | M | — | TODO — SQL results confirmed 2026-09-28: 0af3d8a4 has NULL deed, deed lives on muni_property via erf.sg_number |
| 016  | Screens agree — Dashboard "In conveyancing" label; Pipeline "asking" + "agreed" totals; property page listing ordered by liveness | P2 | M | — | TODO |
| 017  | Classifier extensions — 7 new doc_types (valuation_roll, zoning, electric_fence_coc, quotation_invoice, sectional_title, condition_report_appendix, ppra_vacant_land); broadened FICA-promotion guard; filename rules | P2 | M | — | TODO (revised 2026-09-28 evening: 7 codes not 3; broader guard; GV row cleanup moved to `docs/qa/2026-09-28-cleanup.sql`) |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale) | RESERVED (numbering reserved for a plan not yet written) | PENDING (spec ready, one input still outstanding)

## Numbering

- **013** is reserved for **Document engine slice 1b** (plan 007's remaining scope: resolver, `/documents` hub, entry-point wiring, draft editor, PDF renderer). Will be written after plan 009's migrations land on Bon Bon and Simon confirms the clause library seed spot-checks clean.
- **014** is reserved for **Next.js major upgrade** (14 → 15 → 16). Plan 010's `npm audit fix` clears 8 of 10 advisories non-breaking; the remaining critical (postcss chain) needs `next@16` which is a full major upgrade with its own smoke matrix.
- New walkthrough plans slot in from **015** onward.

## Dependency notes

- **003 depends on 002** because the Lead Inbox pulls more untrusted email content through the same classify/extract path — the extraction hardening should land first so the wider firehose is safe.
- **004 is standalone** — plugs into the existing `external_listing` table and the map's merge/dedup pipeline; can run in parallel with any other plan.
- **001 is a pure perf win** — no dependencies, safe warm-up for the executor.
- **009 depends on 007's design.** Read `plans/007-document-engine.md` "Slice 1" section (lines 133-165) once before starting 009; the plan itself is self-contained for execution.
- **010 is standalone.** Safe to run before or after any other plan.
- **011 is standalone**, and now lands four fixes in the intake pipeline (parse failures, `document_link` errors, non-property subject guard, purchaser split). Recommend running it before 012 so 012 can assert against the post-011 shapes. Plan 012 has a fallback path if 011 hasn't landed.
- **012 unblocks the god-file refactors** for MapView.tsx (1953 LOC) and PropertyRecord `page.tsx` (1278 LOC). Neither should be attempted without at least this test baseline in place — the existing single test covers a real but narrow slice, and a Mapbox / Property Record split without characterization is exactly the pattern that shipped the 2026-07-31 clustering revert.
- **013 depends on 009's Bon Bon apply.** Slice 1b reads from the tables plan 009 creates and seeds; writing 013 before 009 lands on production is speculative and risks the plan drifting from what the seed actually looks like.
- **014 depends on 010.** After 010 clears the non-breaking advisories, 014 is the plan that takes on the `next@14 → 15 → 16` major with its full smoke matrix.
- **015 is standalone** — root cause confirmed 2026-09-28: 0af3d8a4 has `title_deed_no = NULL`; the deed lives on `muni_property` via `erf.sg_number`. Plan extends `find_property_dupes` to consider the muni-linked deed AND the SG code, backfills `property.title_deed_no`, normalises deed formats, and adds combined-name detection to `find_party_dupes`.
- **016 is standalone.** Cleanly composes with 015 — plan 015 fixes dedup, plan 016's property-page ordering is a resilience layer that helps even without dedup.
- **017 is standalone.** No hard dependencies. Recommended ordering: plan 015 first (any 6 Bowden Park merge re-parents the GV documents, so cleanup.sql's GV block should run after any Bowden merge to avoid fighting a stale ownership).
- **`docs/qa/2026-09-28-cleanup.sql`** is the data-only companion. Runs alongside these plans, not before or after in a strict sense — Simon uncomments per row and executes on Bon Bon.

## Findings considered and rejected

From the 2026-07-26 audit (conversation), the following were considered and dropped so nobody re-audits them:

- **`createProperty` role gate** — RLS on the `property` table already prevents non-admin writes; adding an app-layer check is defense-in-depth but LOW impact.
- **Plus-addressing spoof on sender allow-list** — LOW confidence, single-tenant deployment, requires attacker to already control a domain-configured mailbox.
- **LLM API key rotation docs** — operational, not code.
- **`createProperty` address length upper bound** — cosmetic; DB constraint would surface it.
- **Mapbox `styledata` listener leak** — MED confidence, unproven impact; defer until profiling flags it.
- **Suburb-marker linear parse in muni importer** — subagent's own note to skip; not a bottleneck.
- **`PropertyRecord` page 798 lines** — just redesigned; wait a sprint before decomposing. (Since grew to 1278 LOC — plan 012 unblocks the split.)
- **`.env.example` missing five vars, stale `.property-hero-*` CSS, `deriveLabel` duplication, orphaned `SpendMeter`, silent OCR errors** — bundle into a future "housekeeping" plan when triggered; each too small to plan individually. (Silent OCR errors turned out to be a real bug — plan 011 addresses the parse-failure half of it.)

From the 2026-09-28 audit, additionally considered and dropped:

- **Missing index on `external_listing.matched_property_id`** — index exists at `supabase/migrations/0025_external_listing.sql:58`. Subagent-reported false positive.
- **CRON_SECRET empty-string bypass** — `if (secret && bearer === secret)` guards it in every cron route; `sources/property24/refresh` and `dream/refresh` additionally use `constantTimeEq`.
- **Inbox page filter push-down to SQL** — `app/inbox/page.tsx:23-40` deliberately filters in-memory with `LIMIT 200`; comment explicitly notes "simpler than a SQL predicate, cheap at this scale".
- **`dedup.ts:317` non-null assertion on `.find()`** — the `memberIds` array is populated from `rows` itself two lines above; the find cannot miss.
- **LLM model-name env-variable injection** — env vars are server-side only, not user-supplied.
- **`app/documents/` folder has no `page.tsx`** — intentional per state file 2026-08-06; plan 007 slice 1b creates the `/documents` hub.
- **Direction option "outbound P24 syndication feed"** — parked. Regulatory tailwind is real (SA Comp Comm 2023) but the plan is XL, needs legal review, and Bronwyn isn't paying for it yet. Revisit when the daily-use phase begins.

From the 2026-09-28 live walkthrough (`docs/qa/2026-09-28-live-walkthrough.md`), additionally considered:

- **P2 #7 Transfers past date still "in conveyancing"** (181/45/10 days overdue) — not a plan; the dashboard "Overdue" attention row is doing its job by shouting. The real fix is Bronwyn (or Simon) confirming registrations in-app after the fact. If a "confirm registration" nudge is worth building later, own small plan; not needed now.
- **P2 #8 CoC checklist always asks Gas + Electric Fence** — real UX bug (should allow N/A) but low urgency; folded into an eventual compliance-page polish plan.
- **P2 #10 Estates vault shows 0 properties** — the `estate_id` link on `property` isn't being populated by the intake path. Real, low-urgency; consolidates with plan 011's territory in a future round.
- **P2 #11 Team page: "No team members yet"** — RLS or query bug. Small; folded into a future admin-page polish plan.
- **P2 #13 Erf Lookup renders entire muni roll into a dropdown** — real perf issue; own small plan when someone opens on a phone and shouts.

## Direction options not yet planned

The 2026-09-28 audit surfaced direction options:

- **D3 — Fix Dream's WordPress scraper's dishonest geocoding.** State file 2026-08-05 documents: Dream's own website is the least trustworthy source on the map because its geocoder returns a fallback point and stamps it `exact`. M effort. Small credibility win. Candidate for the next planning batch after 009-012 land.
- **D4 — "View as agent" admin preview.** Never built. S effort. Momentum win for admin QA. Candidate for a housekeeping plan.
- **D5 — Outbound P24 syndication feed.** Regulatory tailwind. XL, product bet, deferred (see above).
- **Prior direction batch** (Agent commission tracker, Lightstone comparables cache) is still parked — Simon has not returned to it since picking Lead Inbox in 2026-07-26. Not urgent.
