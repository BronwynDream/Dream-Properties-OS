# Dream Knysna OS — project state

Running log of what's decided, built, and next. Updated at the end of each working
session. `PROJECT.md` remains the canonical business/design doc; this file is the
"where are we right now" companion.

_Last updated: 2026-07-02_

---

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
- [ ] Next: move files to documents/fica buckets; wire match-review UI to `propose_matches`; lead inbox; map; agent RLS test.
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
