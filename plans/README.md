# Implementation Plans

Two `/improve` runs to date:
- 2026-07-26 at commit `f3b6711` — plans 001–006 (all DONE).
- 2026-09-28 at commit `042b246` — plans 009–012.

Plans 007 and 008 came out of standalone Simon+Claude sessions, not from an improve run. Execute in the order below unless dependencies say otherwise. Each executor: read the plan fully before starting, honor its STOP conditions, and update your row when done.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | Parallelise signed-URL generation on Property Record | P1 | S | — | DONE (merged 2026-07-26 as `daf44f0`) |
| 002  | Harden LLM extraction against document-borne prompt injection | P1 | M | — | DONE (merged 2026-07-26 as `46f6811` + `d994154`; migration 0043 pending manual application in Supabase Studio) |
| 003  | Lead Inbox v1 — unified view of email-sourced enquiries | P1 | M | 002 | DONE (merged 2026-07-26 as `a5e0dff` + `6d3bfc0`) |
| 004  | Firecrawl Property24 scraper as a new `external_listing` source | P2 | M | — | DONE (merged 2026-07-26 as `dd17bd2`; `FIRECRAWL_API_KEY` set in Vercel) |
| 005  | Replace map pins with cadastral polygon shading | P1 | M | — | DONE (merged 2026-07-27 as `f4af39e` + `49e9c45`; migration 0045 pending manual application in Supabase Studio) |
| 006  | Contact CRM — party search + role timeline | P1 | M | — | DONE (merged 2026-07-27 as `86baf7f` + `d04a3c6`; migration 0046 pending manual application in Supabase Studio) |
| 007  | Document engine — template library, clause library, context-aware fill | P1 | L | 006 | IN PROGRESS (design done 2026-08-05; slice 1a broken out into plan 009; slice 1b = resolver + `/documents` hub + editor + PDF, still to be planned once Bronwyn's VAT-inclusive wording arrives) |
| 008  | Contact CRM v2 — agent contact books, interest matching, compliant outreach | P1 | L | 006 | IN PROGRESS (planned 2026-08-06; migration 0066 written, not applied. Slice 1 = import + interests + consent; bulk send GATED on NCC registration) |
| 009  | Document engine slice 1a — apply migration 0065, consolidate `mandate.type` sole→exclusive, seed clause library | P1 | M | 007 (design) | TODO |
| 010  | Dependency vulnerability sweep — `npm audit fix` non-breaking (mailparser, pdfjs-dist, transitives) | P1 | S | — | TODO |
| 011  | Intake commit-path integrity — surface parse failures, catch `document_link` insert errors | P2 | S | — | TODO |
| 012  | Characterization test baseline — 3 new tests for dedup match, extract parse, commit link-fail | P2 | M | 011 (recommended, not required) | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

## Dependency notes

- **003 depends on 002** because the Lead Inbox pulls more untrusted email content through the same classify/extract path — the extraction hardening should land first so the wider firehose is safe.
- **004 is standalone** — plugs into the existing `external_listing` table and the map's merge/dedup pipeline; can run in parallel with any other plan.
- **001 is a pure perf win** — no dependencies, safe warm-up for the executor.
- **009 depends on 007's design.** Read `plans/007-document-engine.md` "Slice 1" section (lines 133-165) once before starting 009; the plan itself is self-contained for execution.
- **010 is standalone.** Safe to run before or after any other plan.
- **011 is standalone**, and lands two silent-corruption fixes in the intake pipeline. Recommend running it before 012 so 012 can assert against the post-011 return shapes. Plan 012 has a fallback path if 011 hasn't landed.
- **012 unblocks the god-file refactors** for MapView.tsx (1953 LOC) and PropertyRecord `page.tsx` (1278 LOC). Neither should be attempted without at least this test baseline in place — the existing single test covers a real but narrow slice, and a Mapbox / Property Record split without characterization is exactly the pattern that shipped the 2026-07-31 clustering revert.

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

## Direction options not yet planned

The 2026-09-28 audit surfaced direction options:

- **D3 — Fix Dream's WordPress scraper's dishonest geocoding.** State file 2026-08-05 documents: Dream's own website is the least trustworthy source on the map because its geocoder returns a fallback point and stamps it `exact`. M effort. Small credibility win. Candidate for the next planning batch after 009-012 land.
- **D4 — "View as agent" admin preview.** Never built. S effort. Momentum win for admin QA. Candidate for a housekeeping plan.
- **D5 — Outbound P24 syndication feed.** Regulatory tailwind. XL, product bet, deferred (see above).
- **Prior direction batch** (Agent commission tracker, Lightstone comparables cache) is still parked — Simon has not returned to it since picking Lead Inbox in 2026-07-26. Not urgent.
