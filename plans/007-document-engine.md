# Plan 007: Document engine — template library, clause library, context-aware fill

> **Executor instructions**: Read this plan fully before starting. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> Update the status row in `plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat bd5305c..HEAD -- app/documents app/properties lib/agency.ts supabase/migrations`
> If those paths moved since this plan was written, re-read the live code
> before proceeding; on a real mismatch treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L (multi-session; slice 1 is M)
- **Risk**: MED — legally binding documents; a wrong or missing clause is a
  real liability, not a cosmetic bug
- **Depends on**: Phase 1 mandate render (`app/documents/`, shipped `9d2b334`)
- **Category**: direction
- **Planned at**: commit `bd5305c`, 2026-08-05

## Why this matters

Bronwyn sent thirteen master templates (email 2026-08-04). Today the OS can
render exactly one of them — the Sole/Joint mandate — as HTML that the browser
prints. Nothing is stored: no `document` row, no version history, no record of
what was actually sent to a conveyancer.

Simon's ask, in his words: a documents section, wired through from the other
pages, where the agent can *either* let it fill automatically *or* be
interviewed for the fields that can't be derived — and where how much gets
pre-populated depends on how they arrived. A mandate opened from a property
record already knows the seller. The same mandate opened from a cold
`/documents` page knows nothing.

He also has a **clause library** — Bronwyn keeps suspensive-condition variants
by entity type (natural person, company, trust) — and intends to feed past
contracts through AI to extract more variants. That requirement is what shapes
the architecture below, so it is not an afterthought.

## Domain note, established 2026-08-05

**There is no separate Offer to Purchase.** In SA practice the Agreement of
Sale *is* the offer: the purchaser signs first, and clause 13 of Bronwyn's
master makes that "an irrevocable offer" until the seller accepts. "Generate an
OTP" and "generate an Agreement of Sale" are the same document at different
signature stages. Model one document with a signature state, not two documents.

## The three layers

The templates decompose cleanly, and each layer wants a different home. This is
the answer to "code or database" — it is both, at different levels.

**1. Skeleton — in code** (`app/documents/templates/*.tsx`)

Which clauses appear, in what order, the layout, the letterhead, the signature
blocks. A React component, same as the existing `MandateSole.tsx`: a TypeScript
file in the repo that takes data and returns the rendered document. It lives in
git, so a wording change shows up in a diff and is reviewable before it goes
live. For a binding contract, needing a deploy to change the structure is a
feature.

**2. Clause bodies — in the database** (`clause` / `clause_variant`)

The actual paragraph text, versioned, tagged with when it applies. This is the
layer Simon wants to grow by feeding AI past contracts, and it is exactly the
layer that *should* be data: a suspensive condition for a trust purchaser is
the same clause slot with different wording, and there will eventually be
dozens of variants per slot. Putting these in code would mean a deploy per
clause Bronwyn remembers.

**3. Field values — per document** (`document_draft.field_values`)

The fill-ins: names, erf, price, dates. Instance data, jsonb.

The split matters because the templates themselves already show all three
kinds of variability. From the House Sale master:

| Kind | Example from the master | Layer |
|------|------------------------|-------|
| Pure fill-in | `Erf _____ Knysna`, `R________` | 3 |
| Include/exclude | cl. 15 "DELETE or state whichever is NOT APPLICABLE" — electrical CoC, beetle, gas, electric fence | 1 (slot) + 2 (text) |
| Either/or wording | cl. 21.1 building plans — two alternative paragraphs | 2 (variants) |
| Rule-driven | cl. 16 Alienation of Land Act (natural person AND price ≤ R250k); cl. 23 non-resident seller (price > R2m); cl. 24 estate recordal / Thesen entry fee | 1 (condition) |
| Free drafting | cl. 26 suspensive conditions | 2 + AI |

## Fill sources — the rule that makes entry point matter

Every field on a template declares where it comes from, resolved in order:

1. **record** — read straight from the DB given the context we arrived with
2. **derived** — computed (Rand-in-words, expiry = signed + term, commission
   from agency default)
3. **asked** — the agent is interviewed

Entry point sets the context, and the context decides how many fields fall
through to *asked*:

| Entry point | Context carried | Prefilled |
|---|---|---|
| Property record → Mandate | property, listing, seller party | erf, extent, title deed, address, seller name/ID/marital regime/address, asking price |
| Deal/transfer → Agreement | + purchaser party, offer, conveyancer | everything above plus purchaser block, price, deposit, conveyancer |
| `/documents` → new, cold | nothing | property picker first, then as above; if no property record exists, everything is asked |

This is Simon's point restated as a rule: **the interview is the difference
between what the context supplies and what the template requires.** One
resolver, three entry points, no special-casing.

## Interview design

Two distinct mechanisms, deliberately not one:

**Deterministic questions** for everything the templates already enumerate —
clause toggles, either/or wording, and unresolved fields. Generated from the
template manifest, so the question set is predictable and auditable. A missed
electrical CoC clause is a liability; that path must never depend on a model.

**AI drafting** only for free-text legal wording — turning "buyer has to sell
his Sedgefield house first" into a properly worded suspensive condition. The
model must **propose against the clause library first** (retrieve the closest
existing variant, offer it) and only draft fresh text when nothing fits. Any
freshly drafted clause is flagged for review and becomes a candidate variant.

## The learning loop

`document_draft.clause_overrides` captures every edit an agent or Bronwyn makes
to a clause body on a specific document. Those edits are the highest-quality
training signal available — a human lawyer-adjacent correction on a real deal.
Overrides accumulate as candidate variants for the library, which is how the
clause library grows from use rather than only from bulk AI extraction.

## Slice 1 — mandates only, all four (agreed 2026-08-05)

Scope: Sole, Exclusive, Open, Joint. Business Mandate is out (different
document — sells a business, not a property). Agreement of Sale is out.

Rationale: mandates are simple enough to prove the machinery — clause library,
fill resolver, entry-point context, edit-then-PDF — without betting the hardest
legal document on an unproven engine.

### Steps

1. **Migration 0065** — `clause`, `clause_variant`, `doc_template`,
   `doc_template_slot`, `document_draft`; typed columns on `mandate`
   (`asking_price`, `commission_pct`, `commission_incl_vat`, `term_months`) to
   fix the Phase 1 gap where these were concatenated into `mandate.notes` as a
   string.
2. **Seed the clause library** from the four mandate masters, clause by clause,
   verbatim. Verbatim matters: these are Bronwyn's words and she signs them.
3. **Fill resolver** (`lib/documents/resolve.ts`) — context in, resolved
   fields + list of unresolved out.
4. **Template manifests** for the four mandates — slots, conditions, questions.
5. **`/documents` hub** — template picker, drafts in progress, finalised
   documents.
6. **Entry points** — property record, listing, mandates page.
7. **Draft editor** — fields on the left, live document on the right, clause
   bodies editable inline. Extends `DocumentPage` rather than replacing it.
8. **Finalise → PDF** — snapshot to PDF, write `document` + `document_link`,
   set `mandate.document_id`.

### The PDF decision

Simon: *"Once the agent is happy, then it comes out as a PDF. But they must be
able to edit the document within the OS system."* So the draft stays structured
data, edited in-app, and PDF is a one-way snapshot at finalisation — not a
DOCX round-trip. That avoids the worst outcome, where someone edits a Word file
offline and silently bypasses the clause logic.

Recommendation: `puppeteer-core` + `@sparticuz/chromium` on a Node-runtime
route, rendering the *same* HTML the editor shows. One source of truth, no
second renderer to keep in sync. It is the heaviest dependency in the repo, so
isolate it behind `lib/documents/render.ts` — if Vercel's bundle limits bite,
that one file gets swapped for a hosted render service and nothing else moves.

Rejected: `@react-pdf/renderer` (means writing every template twice, in HTML
and in its own component set — the two will drift, and the drift will be
discovered on a signed contract).

## Verification

- `npm run typecheck` and `npm run build` green.
- Render each of the four mandates against the 7 The Grove pilot record and
  diff the output against Bronwyn's master, clause by clause. **Any wording
  difference is a defect, not a preference** — these are her contracts.
- Confirm entry-point behaviour: from a property record the seller block is
  filled; from `/documents` cold, the same template asks for it.
- Load in a browser before merge — house rule.

## STOP conditions

- Any clause whose wording cannot be reproduced exactly from the master.
- The PDF dependency pushing the Vercel bundle past its limit — stop and report
  rather than switching renderer mid-plan.
- Discovering that `mandate` rows already in production depend on the `notes`
  string format being parsed anywhere.

## Open questions for Bronwyn

- Commission is hardcoded 5% in the Exclusive and Open masters but a blank
  `__%` in the Joint. Is 5% the default to pre-fill, and is it ever varied?
- Exclusive master fixes the term at 12 months; Open and Joint leave it blank.
  Default term per mandate type?
- The Open mandate has the full PPRA Immovable Property Condition Report
  appended (11 questions plus additional-information block). Should that ship
  as part of the Open mandate document, or as a separately generated annexure
  that any mandate can attach? `lib/ppraDisclosure.ts` already models the
  question set, so it wants to be one shared annexure.
