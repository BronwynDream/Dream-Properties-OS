# Plan 019: Revamp roadmap — closing the gap to PROJECT.md

> **Status**: APPROVED by Simon, 2026-10-14. Supersedes the ordering in
> `plans/README.md`. Arc A starts immediately.
>
> **Planned at**: commit `414a8be`. Sources: `../PROJECT.md` (the original
> vision, June 2026), the 16 wireframes in `../wireframes/`, the capability
> map (`docs/research/Capability-Map-*.html`, 122 rows), the 2026-09-28 UX
> audit, and the 2026-10-14 `/improve` audit.

## Why this plan exists

Simon, 2026-10-14: *"I want you to revamp this OS into something it is not
today. It doesn't match the ambitions I had when I started it."*

Measured against `PROJECT.md`, what was built is the **spine** — property →
transfer → seller/buyer parties, FICA, the cadastral map, triage/intake,
mandates as records. What was never reached is **Phases 3–5** of the original
plan: the unified inbox, the knowledge-base search (wireframe 07), clause
search and draft-from-precedent, AI CMA in Bronwyn's voice, and a document
engine that actually keeps what it generates.

The capability map says the same thing numerically: 34 built, 10 partial,
8 planned, **68 absent** of 122. The competitive-landscape work (2026-08-31)
named three structural holes: money never flows, nothing goes out, documents
vanish.

## Scope, as set by Simon

**In**: all deal documents; all market research and the property knowledge
base; all CRM detail. Designed for Bronwyn (principal) and the agents equally.

**Out**: money. No commission engine, no trust ledger, no Xero integration.
(`commission` table stays as-is; nothing new reads or writes it.)

**Parked**: e-signature. PDF + signed-document register first; signed copies
are uploaded back into the register. Provider choice is Simon's, later.

**Approach**: straight at new capability. Foundations (lint, tests,
god-file splits) land *inside* the arcs where the code is touched, not as
a blocking prelude. Simon chose this knowing the trade-off; the mitigation
is that each PR adds characterization tests around the code it changes.

## The four arcs

### Arc A — Documents, end to end (first)

Bronwyn's 13 final templates (2026-09-17) are extracted and verbatim in
`docs/templates/2026-final/`. Migration 0068 seeded the three mandates
(9 clauses, 19 variants). Everything else is unseeded, and nothing
generated is stored.

| Slice | Delivers | Capability rows |
|---|---|---|
| A1 | Fix audit #1 (UI still writes `type:"sole"`); `.eslintrc` so `npm run lint` works; migration 0069 seeds the remaining 10 templates verbatim (two sale agreements, sectional title, movables, two addenda, PPRA ×2, condition-report appendix, letterhead) | M02, M06 |
| A2 | `lib/documents/resolve.ts` — fill-source rule (record → interview → default) for every template field; deterministic interview for clause toggles | P02 |
| A3 | `/documents` hub + nav entry; entry points from property, contact, transfer; "Prepare …" for every template, not only mandates | P01 |
| A4 | Draft editor; `document` + `document_version` rows on every save; AI only for free-text suspensive conditions, proposing from the clause library first | P03, P07 |
| A5 | PDF at finalisation (letterhead + page numbers per Bronwyn's layout file); **signed-document register per transfer**; upload-signed-copy flow; "what did we send the Wilsons in March" answerable | M08, P05 |
| A6 | Mandatory PPRA disclosure modelled (house + vacant-land question sets), annexed to the agreement of sale, blocking flag when missing — direct liability today | M11 |

Replace `MandateSole.tsx` wholesale from the Exclusive master (it was built
from the Business mandate as a placeholder — see state file 2026-08-06).

Open with Bronwyn: PPRA condition report as shared annexure vs inside the
Open mandate; whether Business Mandate is retired; lease template or dead
enum.

### Arc B — Knowledge base and "ask your data"

Wireframe 07 made real. The Phase-5 promise in PROJECT.md.

| Slice | Delivers | Capability rows |
|---|---|---|
| B1 | Postgres full-text (tsvector) across property, party, listing, document text, external_listing, valuation roll; one search RPC | — |
| B2 | ⌘K omni-search in the shell: typed results grouped by kind, keyboard-first | — |
| B3 | AI question-answering over the database (SQL-generating, read-only role, result shown with the query) — *"which Pezula sales had an occupational-rent clause?"* | A06 |
| B4 | Clause search across stored documents; draft-from-precedent into Arc A's editor | A07 (partial) |
| B5 | Market research layer: comparables from Dream's own scraped stock, price history per erf, R/m² by suburb, 5-year history layer on the map; buyer-shareable comparables view (D3 from the audit) | V09, L12 |

### Arc C — CRM that works a lead

| Slice | Delivers | Capability rows |
|---|---|---|
| C1 | Buyer requirement profile on the contact; matching both ways (new stock → buyers, new buyer → stock) | C02, C03, C04 |
| C2 | Lead source attribution end-to-end from intake | C06 |
| C3 | Email from the record (Microsoft 365 via Graph — Bronwyn is on Outlook), templates with merge fields, every send logged to the timeline | K01, K05 |
| C4 | Task & reminder engine finished; vendor progress report generated from viewings + feedback + enquiries | K10, V06 |
| C5 | Unified inbox (wireframe 06): email + P24 + PP in one feed with AI-drafted replies. WhatsApp stays blocked on a Business API subscription | — |

### Arc D — The shell, as drawn in June

| Slice | Delivers | Source |
|---|---|---|
| D1 | Operator console (Bronwyn) and agent cockpit (Vanessa, Angie) as distinct home screens | wireframes 01, 05 |
| D2 | Property record re-ordered: status + next deadline → parties → agreement money → deed card → documents → compliance. Keep the stamp. | UX audit #14 |
| D3 | Properties list: status pill, asking price, hide empty fields, search/filter | UX audit #15 |
| D4 | Pipeline on phones: stage picker, one "Move to…" action | UX audit #13 |
| D5 | "View as agent" for admins, with a visible banner | audit D1 |
| D6 | Split `MapView.tsx` (1,953 LOC) and `properties/[id]/page.tsx` (1,280 LOC) as each is touched; retire inline styles file by file | plan 012 intent |

### Slice H — Data Health page (pulled forward; runs before A2)

Added 2026-10-14 after Simon saw the live map rail: *"not sure all these
left-hand buttons will go down well with the agents … we need a dashboard
that has green lights for each section."* Agreed.

| Step | Delivers |
|---|---|
| H1 | `feed_run` table: one row per scheduled/manual run (feed, started, finished, status, items, error). Each cron/refresh route writes one. |
| H2 | `/admin/health` page: one row per feed with a green / amber / red light, last run, count, queue depth, and that feed's refresh button. Feeds: Dream website, Property24 (index + Firecrawl + drain queue), Private Property (red until built), municipal valuation roll, geocoding (pinned / missing), inbound email webhook, enquiry intake. |
| H3 | Map rail slimmed to basemap, sources, cadastral outlines, mandate filter. Every refresh / drain / re-geocode button and the "n / m processed" counters move to H2. Source chips get a small dot mirroring the health light (read-only for agents). Legend label "Sole / Open / None" → "Open / None". |

Half a session. H3 is a map change, so it is loaded in a browser before
merge (house rule).

## Ordering and why

A1 → **H** → A2 … → B → C → D, with D2–D3 allowed to interleave once A5
lands (the document register changes what the property record should show
first).

A first because the templates are ready, it closes the "documents vanish"
hole, and it is the most visible change for Bronwyn. B depends on A storing
document text. C is largest and least dependent. D is cheapest once the
content it frames exists.

## What this plan absorbs or parks

- **Absorbed**: plan 010 (vuln sweep → done inside A1 as `npm audit fix`
  non-breaking), plan 012 (test baseline → per-PR characterization tests),
  audit findings #1 (A1), #4 #5 #6 #9 (A1 housekeeping), #2 #3 (first B5
  map/compliance PR).
- **Still queued, unchanged**: plans 011, 015, 016, 017. Run when an arc
  touches their code or when a session is short.
- **Parked**: e-signature; D5 outbound P24 syndication (XL); WhatsApp
  Business API (needs subscription); commission/trust (out of scope);
  Lightstone API (declined at R5k/mo).

## Per-PR done criteria (every slice)

- `npm run typecheck`, `npm run build` (in the cloud container — see the
  Cowork handbook), `npm run lint` green.
- Any map-render change loaded in a browser before merge (house rule).
- Migrations applied to Bon Bon land in the repo in the same commit.
- `project.state.md` gets a section; header `_Last updated_` bumped.
- Commit locally over the bridge; Simon pushes.

## Session plan

| Session | Slice | Est. |
|---|---|---|
| 1 | A1 | done 2026-10-14 |
| 2 | H + start A2 | 1 |
| 2–3 | A2 + A3 | 1 |
| 3–4 | A4 | 2 |
| 5 | A5 | 1 |
| 6 | A6 | 1 |
| 7–9 | B1–B3 | 3 |
| 10 | B4 + B5 | 1–2 |
| 11–14 | C1–C5 | 4 |
| 15–17 | D1–D6 | 3 |

Roughly 17 sessions. Re-estimate after Arc A.
