# Drop-and-Triage — specification

How a folder Bronwyn drags in becomes clean rows in the database, with a human
confirm step in the middle and nothing touching live data until she says so.

_Status: v0.1 spec. Staging tables shipped in `0007_staging.sql`. Front-of-house
sketched in `wireframes/11-migration-triage.html`. Target output shape = the
7 The Grove golden record._

---

## 1. The principle

Bronwyn's folders are unstructured (emails, scanned PDFs, Word docs, ID images).
The database is structured (parties, transfers, agreements…). The gap between them
is extraction, and extraction is never fully trustworthy — so a person confirms
before anything commits.

Three rules, carried straight from the migration philosophy:

1. **Nothing hits live tables until confirmed.** Everything lands in *staging*
   first (`ingest_batch` / `ingest_file` / `extraction`). Discard a batch and the
   real data is untouched.
2. **Controlled pace.** Two folders a day, not a bulk dump. Each one teaches us
   something; we adjust the extractors as new shapes appear.
3. **Reversible.** Raw files stay in the `staging` bucket; a committed batch can be
   traced back to exactly which file proposed which value.

## 2. The pipeline

```
  ┌─ DROP ──────────┐   ┌─ PARSE ─────────┐   ┌─ CLASSIFY ──────┐
  │ Bronwyn drags a │   │ text + OCR per   │   │ each file →      │
  │ folder onto the │──▶│ file; images     │──▶│ document_type    │──┐
  │ triage screen   │   │ OCR'd            │   │ (+ confidence)   │  │
  └─────────────────┘   └──────────────────┘   └──────────────────┘  │
        creates                writes                writes           │
     ingest_batch          ingest_file.ocr_text   detected_doc_type   │
                                                                       ▼
  ┌─ EXTRACT ───────────┐   ┌─ CONFIRM ──────────┐   ┌─ COMMIT ─────────────┐
  │ AI proposes field   │   │ Bronwyn reviews on  │   │ accepted values →     │
  │ values → extraction │──▶│ ONE screen; accept, │──▶│ real rows (party,     │
  │ (target table.col,  │   │ edit, or reject     │   │ transfer, agreement…) │
  │  confidence, source)│   │ each; fills gaps    │   │ files → documents     │
  └─────────────────────┘   └─────────────────────┘   └───────────────────────┘
       status=extracted          status=in_review          status=committed
```

Each stage writes to the staging tables and flips a status, so the screen can
always show "where is this batch" and resume after interruption.

### 2.1 Drop
A drag-drop zone creates one `ingest_batch` (label = folder name) and uploads each
file to the private `staging` bucket as an `ingest_file`. Folder name is a strong
hint for the property (e.g. "7 The Grove, Leisure Isle").

### 2.2 Parse
A Supabase **edge function** extracts text from each file. Native-text PDFs and
Word docs are read directly; scanned/image PDFs and ID JPEGs go through **OCR**
(the signed agreements come in image-only — this is why `document.ocr_text` exists).
Result stored in `ingest_file.ocr_text`.

### 2.3 Classify
Each file is classified to a `document_type` (the seeded lookup) with a confidence
score. Filenames + content both feed this — "Final Signed Agreement…" → `agreement_of_sale`,
"kyc katie" → `kyc_form`, "Sellers ID" → `id_document`. Low-confidence files are
flagged for Bronwyn to set the type manually. PII default comes from the doc type.

### 2.4 Extract
For the deal-shaping documents (agreement, FICA questionnaire, transfer instruction)
the AI proposes structured values as `extraction` rows — each one naming its
`target_table.target_field`, a `proposed_value`, a `confidence`, and the
`source_file_id` it came from. Examples from a Grove-shaped folder:

| target_table.field | proposed_value | from |
|---|---|---|
| property.title_deed_no | T62677/2025 | Agreement |
| property.extent_sqm | 614 | Agreement |
| party[seller].party_type | partnership | Agreement |
| party[seller].entity_name | The Leisure Partnership | Agreement |
| agreement.price | 7600000 | Agreement |
| agreement.deposit | 760000 | Agreement |
| milestone[transfer_date].due_date | 2026-08-14 | Agreement cl.4 |
| suspensive_condition.status | waived | WhatsApp screenshot |

`entity_hint` (`seller_1`, `purchaser_2`) disambiguates when there are several
parties of the same kind.

### 2.5 Confirm (the human step)
One screen (`11-migration-triage.html`). Left: the file list with detected types.
Right: the proposed record, grouped as **Property · Seller(s) · Purchaser(s) ·
Agreement · Conditions · Milestones · FICA · Documents**. Each proposed value shows
its confidence and a link to the source file. Bronwyn can **accept**, **edit**, or
**reject** each, and fill anything left blank. High-confidence values are pre-ticked;
low-confidence and PII-critical values (ID numbers) always require an explicit look.

### 2.6 Commit
On confirm, a single transactional function (mirroring `pilot_7_the_grove.sql`)
writes the accepted values into the real tables — creating/matching the `property`,
the `transfer` and its `transfer_party` links, `party` + `party_member` (juristic
handled), `agreement` + `suspensive_condition` + `milestone`, `fica`, and promoting
each `ingest_file` to a `document` (PII ones into the `fica` bucket) with the right
`document_link`. Batch flips to `committed`; raw files stay in staging for audit.

## 3. Matching vs creating (avoid duplicates)
Before creating, the commit step tries to **match**:
- **Property** by title deed no, then erf, then fuzzy address+suburb.
- **Party** by ID/registration number, then name. A person seen as a seller in 2018
  and buyer in 2026 is the *same* `party` — this is the whole point of the model.
Matches are shown on the confirm screen ("This looks like an existing property/
contact — link instead of create?") so Bronwyn decides.

## 4. What makes a batch "done"
The target is the 7 The Grove shape: property + transfer + parties (incl. any
juristic entity and its members) + executed agreement + conditions + milestones +
FICA per party + documents in the right buckets + the correspondence. If a batch
commits to that and the read-back query returns sensible counts, it's done.

## 5. Honest gaps (by design)
- **Unknowns stay null with a note**, never invented (purchaser IDs supplied as
  images, exact deposit date). The confirm screen surfaces them as "pending capture"
  rather than blocking the commit.
- **Image-only signed docs** rely on OCR quality; low-confidence extractions are
  always human-checked.
- **Commission** is often blank on the contract — allowed to commit as pending.

## 6. Scaling to the full back-catalogue (500+ folders)

Dropping and confirming one folder at a time doesn't scale to ~500. The fix is to
**decouple ingestion from confirmation**: ingestion is automated and can run in bulk;
only confirmation costs human time, so we make that queue cheap to clear.

### 6.1 Bulk drop
The drop zone accepts **many folders at once**, and a **parent folder fans out into
one `ingest_batch` per subfolder** (grouped by `ingest_batch.parent_drop_id`). All
500 can be parsed / OCR'd / classified / extracted in background waves — no human
time spent. The staging model already supports N batches.

### 6.2 Confidence tiers (`ingest_batch.tier`)
After extraction each batch is scored:
- **Green** — high confidence, key fields found, property/parties matched cleanly, no
  juristic entity, no missing IDs → **bulk one-click approve** (auto-commit for historical).
- **Amber** — a few low-confidence or blank fields → ~30-second glance.
- **Red** — juristic seller (company/CC/trust/partnership), a duplicate/merge decision,
  missing IDs, or a conflict → full manual review.

Most of Dream's back-catalogue is ordinary house sales that land green; human time
concentrates on the amber/red minority.

### 6.3 Priority, not chronology (`ingest_batch.priority`)
Work the queue by value: **active** in-flight deals first (must be right, few in
number) → **recent** closed → **historical** back-catalogue in bulk. For historical
completed deals the bar is deliberately lower — the goal is a *searchable record
attached to the property*, not perfect structured capture; those can commit with light
extraction and be enriched later if ever needed.

### 6.4 Matching / merge review (`match_candidate`)
At scale the same property and people recur (buyer in 2018, seller in 2026). Every
create is preceded by a match attempt (property by deed→erf→address; party by
ID/registration→name); ambiguous ones go to a small **merge-review queue** so Dream
never ends up with duplicate contacts. Build this early.

### 6.5 Reframing "two a day"
That pace applies only to the **first learning wave** (~10–20 folders) — reviewed
carefully so we tune the extractors and catch new document shapes. Once the extractor
behaves, bulk-ingest the rest and clear the queue in waves of 25–50, mostly green
one-clicks. Realistic shape: week one tune on ~15; then ingest all 500 in the
background; then Bronwyn (Vanessa testing first, per the two-tier beta) works a
prioritized queue over a couple of weeks, spending real time only on exceptions.

### 6.6 The queue feed
`v_triage_queue` (view, shipped in `0008`) is what the confirm screen lists: per batch
its tier, priority, confidence, file/proposed/confirmed counts, low-confidence count,
and open match decisions — ordered priority → tier → confidence.

## 7. Build order
1. **Storage + batch create + file list** — drop a folder (or many), see files listed
   and classified. (No extraction yet — proves the plumbing.) Ship.
2. **Queue view** — the `v_triage_queue` list screen: batches by priority/tier with counts.
3. **Extraction for the agreement** — the highest-value document; populate `extraction`
   and compute batch `tier` + `confidence`.
4. **Confirm screen** wired to accept/edit/reject → the transactional commit function,
   with **bulk one-click approve** for green batches.
5. **Match-or-create + merge review** for property + party (`match_candidate`).
6. **OCR** for scanned agreements + ID images.
7. Widen extractors to FICA, transfer instruction, compliance, mandates as folders
   surface new shapes — tuning as we go, then scaling the waves up.

## 8. Interim reality
Until steps 2–3 exist, "triage" can be Bronwyn dropping files (step 1) plus a
Grove-style `commit` script we run per deal. That already lets her start populating
now, with the fully-automated confirm screen arriving behind it.
