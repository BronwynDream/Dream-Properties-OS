# Plan 011: Intake commit-path integrity — surface parse failures, catch link-insert errors, reject non-property subjects, split combined-name purchasers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 042b246..HEAD -- lib/intake/extract-batch.ts lib/intake/commit-batch.ts app/triage app/api/intake`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> real mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (one focused session; ~4–6 hours after the 2026-09-28 walkthrough extended the scope)
- **Risk**: LOW — every change adds signal or a defensive gate;
  nothing removes existing behaviour on the happy path. The one-line
  extract-prompt change is the highest-risk item (LLM regressions on
  edge cases) — verify against a few real intake batches before merge.
- **Depends on**: none (safe to run before or after plan 010)
- **Category**: correctness / bug
- **Planned at**: commit `042b246`, 2026-09-28. Extended 2026-09-28 evening
  after the live walkthrough (`docs/qa/2026-09-28-live-walkthrough.md`)
  found two more intake-time defects (#4B non-property subjects auto-become
  properties; #5A LLM extract copies "X and Y" as one purchaser).

## Why this matters

Four intake defects in one plan, because the fixes are all in the same
two files (`lib/intake/*`, `app/api/intake/email/route.ts`) and travel
better as one atomic change than four small ones. Items 1 and 2 came
out of the 2026-09-28 audit; items 3 and 4 came out of the live
walkthrough that afternoon.

**1. `lib/intake/extract-batch.ts:63-65` — PDF/DOCX parse errors swallowed.**

```ts
async function textFromFile(filename: string, buf: Buffer): Promise<string> {
  const name = filename.toLowerCase();
  try {
    if (name.endsWith(".docx")) { ... }
    if (name.endsWith(".pdf")) { ... }
    return buf.toString("utf8");
  } catch {
    return "";                  // <-- swallow-all
  }
}
```

If `mammoth` or `pdf-parse` throws — corrupt file, encrypted PDF, malformed
DOCX zip, wrong MIME type stamped on upload — the file is treated as
empty. Downstream, the caller checks `text.trim().length < 40` and falls
through to Mistral OCR (which is right); but if OCR *also* returns nothing
(scan quality, unsupported image mode, OpenRouter rate-limit), the file
is silently dropped from the `gathered[]` array and the LLM sees fewer
documents than the batch actually contains. On auto-commit paths
(`ingest_batch.auto_commit_allowed = true`) the batch commits without any
signal that a file was unreadable — the operator has no idea a mandate
attachment was skipped.

The fix does not change the fallback behaviour (empty text still falls
through to OCR — that logic is right). It adds an in-batch log so the
operator sees which files failed to parse when they open the batch.

**2. `lib/intake/commit-batch.ts:157, 181-184` — `document_link` insert
errors dropped.**

```ts
// Existing document, add a link to this transfer:
docId = existingDocId;
await supabase.from("document_link").insert({          // <-- no error check
  document_id: docId,
  entity_type: "transfer",
  entity_id: result.transfer_id,
});
deduped++;

// New document, link to both transfer and property:
if (doc) {
  docId = doc.id;
  await supabase.from("document_link").insert([        // <-- no error check
    { document_id: doc.id, entity_type: "transfer", entity_id: result.transfer_id },
    { document_id: doc.id, entity_type: "property", entity_id: result.property_id },
  ]);
  existingByKey.set(key, doc.id);
  filed++;
}

if (docId) {
  await supabase.from("ingest_file")
    .update({ committed_document_id: docId, status: "committed" })       // <-- marks committed regardless
    .eq("id", f.id);
}
```

If the link insert fails (transient RLS glitch, unique constraint on
`document_link`, service outage), the `document` row is created but is
undiscoverable from either the transfer or the property. Worse, the
paired `ingest_file` row is then updated to `status: 'committed'` — the
batch UI reports success. The file is orphaned in the `document` table
and invisible to Bronwyn.

Blast radius: today the intake webhook is the primary auto-commit path.
Every uncaught link failure loses a document from the record permanently
unless the operator notices the batch has "filed 0" when they expected
"filed 3".

**3. `app/api/intake/email/route.ts:519-556` — non-property subjects auto-create property rows.**

```ts
async function resolveProperty(supabase, subjectValue, fallbackLabel) {
  const q = subjectValue.trim();
  if (q.length >= 3) {
    const { data: matches } = await supabase.rpc("match_property_by_address", {...});
    const best = matches?.[0];
    if (best) return { id: best.id, ... };
  }
  const primary_address = q || "(untitled intake)";
  const { data: newProp, error } = await supabase
    .from("property")
    .insert({ primary_address })
    .select("id, primary_address")
    .single();
  ...
}
```

Any forwarded email or dropped folder whose subject doesn't fuzzy-match
an existing property at `PROPERTY_MATCH_THRESHOLD` gets a brand-new
`property` row whose `primary_address` is the raw subject string. The
2026-09-28 live walkthrough found seven such rows on production —
`Dream Properties - Master Templates`, `26 Lower Duthie - Rates account`,
`26 Lower Duthie Pics`, `26 Lower Duthie Seller Details`,
`Pezula Private Estate information and Architectural Design Manual and Knysna General`,
`PLOT19 Eagles Way - proposed plans`,
`Plot: 21 Emu Crescent, The Heads continued` — several of which then got
associated deals in the pipeline. Data cleanup lives in
`docs/qa/2026-09-28-cleanup.sql`; this plan closes the door.

The fix is a small guard list (`lib/intake/subject-guard.ts`): if the
subject matches the non-property pattern set, do NOT create a property.
Park the batch's `property_id` as null and let triage assign one by
hand. This is a smaller intervention than "reject the batch" — the
files still land in staging, the batch still shows up in triage, the
operator just picks the property manually instead of accepting the
subject.

**4. `lib/extract.ts:5-47` — "X and Y" combined-name purchasers extract as one party.**

The extraction system prompt says "Capture ALL buyers and sellers"
(line 18) and the JSON schema shape says
`"purchasers": [ { "party_type": "individual", "name": "" ... } ]`
(line 41). But it does not tell the model how to handle the very
common case where Bronwyn's mandate or OTP has a joint signature line
like:

> Purchaser: PHILLIP ALFRED TRAYHORN DAVIS AND KATHERINE DAVIS

The LLM copies that verbatim into `purchasers[0].name`, creating one
purchaser row for two people. Later docs (FICA questionnaires) then
mention "Phil Davis" and "Kate Davis" separately, creating two more
rows. Result on 7 The Grove today: three purchaser parties for what
should be two individuals sharing a joint purchase.

Downstream damage:
- `/compliance` shows FICA gaps against three parties instead of two,
  overstating outstanding work.
- The dupe finder can't repair it: it computes trigram similarity on
  `display_name`, and `similarity('Phil Davis', 'PHILLIP ALFRED TRAYHORN DAVIS and KATHERINE DAVIS')` is well under 0.5.
- Even a manual merge in `/dupes?kind=party` won't help — merging can
  only collapse two rows to one, not fuse "one row" into "two rows +
  joint link". The bad row has to be structurally decomposed first.

The fix is a rule added to `lib/extract.ts` SYSTEM_PROMPT that tells
the model to split names joined by ` and `, ` AND `, ` & ` into
separate purchaser (or seller) entries. Every downstream mechanic
already handles multiple parties per side (see 0002_core.sql —
`transfer_party` is many-to-many). This is a one-paragraph prompt
addition.

Cleanup of the existing bad rows (7 The Grove, 159 Sharples Close) is
out of scope here — the dedup surface won't help; a targeted admin
operation is needed. Track that separately in the QA doc.

## Current state

**Files this plan touches:**

- `lib/intake/extract-batch.ts` — the shared extract pipeline. Called by
  both `/api/extract` (session client) and the intake webhook
  (service-role). Contains `textFromFile` and the OCR fallback loop.
- `lib/intake/commit-batch.ts` — the shared commit pipeline. Called by
  `app/triage/actions.ts` and the intake webhook. Wraps
  `commit_batch` RPC + document promotion + `ingest_file` status update.
- `app/api/intake/email/route.ts` — the Resend inbound webhook. Its
  `resolveProperty()` (lines 519-556) is the auto-create-property site
  this plan guards.
- `lib/intake/subject-guard.ts` — **NEW file** owning the reject
  pattern list. Keeping the list in its own module makes it
  test-friendly and easy for Bronwyn/Simon to extend without
  re-reading the webhook route.
- `lib/extract.ts` — SYSTEM_PROMPT (lines 5-36) is where the
  "split X and Y into two purchasers" rule lands. No new file.

**Downstream call sites (context, not scope beyond above):**
- `app/triage/actions.ts` — invokes extract + commit from server actions when
  Simon or an admin manually walks a batch through review.
- `app/api/extract/route.ts` — invokes extract-batch only (called from
  the batch page UI).

**Repo conventions (match these):**
- Error propagation in the intake pipeline uses discriminated returns
  (`{ ok: false, error: string, ... }`), not thrown exceptions — see
  `CommitBatchResult` at `lib/intake/commit-batch.ts:19-26` and
  `ExtractBatchResult` at `lib/intake/extract-batch.ts` (existing shape;
  read it to match).
- `console.error` is used elsewhere in the intake path for non-fatal
  issues that the operator should be able to inspect after the fact —
  see `extract-batch.ts:279-281` where validation failures are logged.
  Match that pattern; no new logging library.
- Supabase writes destructure both `data` and `error` when the caller
  needs to act on either. See `commit-batch.ts:115-119`:
  ```ts
  const { data, error } = await supabase.rpc("commit_batch", {...});
  if (error) return { ok: false, error: error.message };
  ```
  Match this shape for the fixes below.

## Commands you will need

| Purpose         | Command                            | Expected                          |
|-----------------|------------------------------------|-----------------------------------|
| Typecheck       | `npm run typecheck`                | exit 0                            |
| Build           | `npm run build`                    | exit 0, 49+ routes                |
| Dedup test      | `npm run test:dedup`               | exit 0                            |
| Line lookup     | `grep -n "return \"\";" lib/intake/extract-batch.ts` | prints line 64 (empty-catch site) |

## Scope

**In scope (the only files you should modify or create):**
- `lib/intake/extract-batch.ts` (Step 1 — add parse-error surfacing on
  `textFromFile`; add a per-file error log line in the batch loop when
  BOTH text-extract and OCR fail)
- `lib/intake/commit-batch.ts` (Step 2 — destructure `.error` on both
  `document_link.insert` calls; on failure, log + increment a
  `linkFailed` counter; return counter in `CommitBatchResult` so callers
  can surface it)
- `lib/intake/subject-guard.ts` (Step 3 — CREATE; small module exporting
  a reject-pattern predicate)
- `app/api/intake/email/route.ts` (Step 3 — wire the guard into
  `resolveProperty`)
- `lib/extract.ts` (Step 4 — augment SYSTEM_PROMPT with a "split
  combined names" rule)
- `plans/README.md` (mark plan status on completion)

**Out of scope (do NOT touch):**
- `lib/intake/extract-batch.ts` OCR retry logic (lines ~205-221). It
  already logs-and-continues for the intended reason ("one bad scan
  shouldn't fail the whole extract"); don't change its behaviour.
- `commit_batch` RPC (`supabase/migrations/`) — the SQL side is fine.
  Only the TypeScript link inserts are the leak.
- Transaction semantics — do NOT wrap the loop in a transaction to
  "atomically" file all documents. `commit_batch` is not idempotent per
  file, and mid-loop rollbacks would compound the failure mode.
- `app/triage/actions.ts` UI surface — the plan adds a counter to the
  return value; if the triage batch page wants to render it, that is a
  UI plan of its own. This plan just makes the signal available.
- `app/api/intake/email/route.ts` — same. Consuming the counter is a
  follow-up. Just log the failure server-side today; the auto-commit
  webhook's Vercel logs are where an operator would look first.

## Git workflow

- Do NOT push. Simon owns push.
- One commit at the end:
  `Plan 011: surface intake parse failures + catch document_link errors`
- Body should list the two fix sites for the log:
  `- lib/intake/extract-batch.ts: return typed error from textFromFile; log per-file parse failures`
  `- lib/intake/commit-batch.ts: check document_link.insert errors; return linkFailed count`

## Steps

### Step 1: Change `textFromFile` to distinguish empty from failed

Small refactor of a private helper. Return `{ text: string; error?: string }`
instead of `string`. Caller decides whether an empty text is a "no text
layer, try OCR" case (unchanged behaviour) or a "parser threw, log it"
case (new behaviour, non-blocking).

**Do:**

1. At `lib/intake/extract-batch.ts:47-66`, replace `textFromFile`:

   ```ts
   type TextExtractResult = { text: string; error?: string };

   async function textFromFile(
     filename: string,
     buf: Buffer,
   ): Promise<TextExtractResult> {
     const name = filename.toLowerCase();
     try {
       if (name.endsWith(".docx")) {
         const mammoth = await import("mammoth");
         const { value } = await mammoth.extractRawText({ buffer: buf });
         return { text: value ?? "" };
       }
       if (name.endsWith(".pdf")) {
         const pdf = (await import("pdf-parse/lib/pdf-parse.js")).default as (
           b: Buffer,
         ) => Promise<{ text: string }>;
         const out = await pdf(buf);
         return { text: out.text ?? "" };
       }
       return { text: buf.toString("utf8") };
     } catch (e) {
       // A thrown error is qualitatively different from an empty text
       // layer: it means the parser rejected the file. Empty text alone
       // is normal (scanned PDF) and OCR is the right fallback; a thrown
       // error means the file is likely corrupt or wrong-typed and the
       // operator should know regardless.
       return { text: "", error: (e as Error).message ?? String(e) };
     }
   }
   ```

2. Update the single caller (currently line ~202) to read the new shape:

   Before:
   ```ts
   let text = await textFromFile(f.original_filename, buf);
   let source: "text" | "ocr" = "text";
   ```

   After:
   ```ts
   const parsed = await textFromFile(f.original_filename, buf);
   let text = parsed.text;
   let source: "text" | "ocr" = "text";
   const parseError = parsed.error ?? null;
   ```

3. In the same loop, after the OCR-fallback block (currently ending
   around line 221), add a new log-and-continue block when *both*
   text-extract failed AND OCR did not yield usable text. Find the
   existing tail:

   ```ts
   if (text.trim().length >= 40) {
     await supabase
       .from("ingest_file")
       .update({ ocr_text: text.slice(0, 100000) })
       .eq("id", f.id);
     gathered.push({ id: f.id, filename: f.original_filename, text, source });
   }
   ```

   Insert an `else` branch immediately after (before the `for` loop's
   next iteration):

   ```ts
   if (text.trim().length >= 40) {
     // ... existing block above unchanged ...
   } else if (parseError) {
     // Log so the operator can find which file died on which batch
     // when they wonder why the extract came back thin. This is the
     // signal that was missing until plan 011.
     console.error(
       `[extract] parse failed for batch ${batchId} file ${f.id} (${f.original_filename}): ${parseError}`,
     );
   }
   ```

   Do NOT change the `gathered.push` guard — a file whose text is empty
   after both paths should still be excluded from the LLM prompt (LLMs
   given a "file X: [empty]" line hallucinate around it). The change is
   log-only.

**Verify**:
- `npm run typecheck` exits 0
- `grep -n "TextExtractResult\|parseError" lib/intake/extract-batch.ts`
  shows both the type alias and the caller reference
- `grep -n "parse failed for batch" lib/intake/extract-batch.ts` shows
  the new log line exactly once

**STOP if**:
- Typecheck errors reference any file outside `lib/intake/extract-batch.ts`.
  If they do, another caller of `textFromFile` exists that this plan
  missed — investigate first.
- The existing OCR-retry `try/catch` block (lines ~211-221) needs to
  change to compile. It shouldn't; it operates on `text` after the new
  parsed-shape assignment. If it does, revert and re-read the file.

### Step 2: Catch and surface `document_link` insert failures in `commit-batch.ts`

Two insert sites to fix (lines ~157 and ~181-184 today). The fix
destructures `.error`, logs on failure, and increments a new counter
that flows into the return value.

**Do:**

1. Update the `CommitBatchResult` type at `lib/intake/commit-batch.ts:19-26`:

   Before:
   ```ts
   export type CommitBatchResult = {
     ok: boolean;
     error?: string;
     propertyId?: string;
     transferId?: string;
     filed?: number;
     deduped?: number;
   };
   ```

   After:
   ```ts
   export type CommitBatchResult = {
     ok: boolean;
     error?: string;
     propertyId?: string;
     transferId?: string;
     filed?: number;
     deduped?: number;
     linkFailed?: number;  // number of document_link inserts that errored
                           // during file promotion. Non-fatal (the batch
                           // still commits) but signals a data-integrity
                           // issue the operator needs to inspect.
   };
   ```

2. Initialise `linkFailed` next to `filed` and `deduped` (currently
   around line 146):

   ```ts
   let filed = 0;
   let deduped = 0;
   let linkFailed = 0;
   ```

3. Replace the first insert (existing document, add-link path — currently
   line 157):

   Before:
   ```ts
   if (existingDocId) {
     docId = existingDocId;
     await supabase.from("document_link").insert({
       document_id: docId,
       entity_type: "transfer",
       entity_id: result.transfer_id,
     });
     deduped++;
   }
   ```

   After:
   ```ts
   if (existingDocId) {
     docId = existingDocId;
     const { error: linkErr } = await supabase.from("document_link").insert({
       document_id: docId,
       entity_type: "transfer",
       entity_id: result.transfer_id,
     });
     if (linkErr) {
       linkFailed++;
       console.error(
         `[commit] document_link insert failed for batch ${batchId} file ${f.id} doc ${docId}: ${linkErr.message}`,
       );
     } else {
       deduped++;
     }
   }
   ```

   Note the counter change: `deduped++` moves inside the success branch.
   A failed link is neither `filed` nor `deduped` — it's a `linkFailed`
   event. Reporting truth beats reporting a nice number.

4. Replace the second insert (new document, link-to-both path — currently
   lines 181-184):

   Before:
   ```ts
   if (doc) {
     docId = doc.id;
     await supabase.from("document_link").insert([
       { document_id: doc.id, entity_type: "transfer", entity_id: result.transfer_id },
       { document_id: doc.id, entity_type: "property", entity_id: result.property_id },
     ]);
     existingByKey.set(key, doc.id);
     filed++;
   }
   ```

   After:
   ```ts
   if (doc) {
     docId = doc.id;
     const { error: linkErr } = await supabase.from("document_link").insert([
       { document_id: doc.id, entity_type: "transfer", entity_id: result.transfer_id },
       { document_id: doc.id, entity_type: "property", entity_id: result.property_id },
     ]);
     if (linkErr) {
       linkFailed++;
       console.error(
         `[commit] document_link insert failed for batch ${batchId} file ${f.id} doc ${doc.id}: ${linkErr.message}`,
       );
     } else {
       existingByKey.set(key, doc.id);
       filed++;
     }
   }
   ```

   Same counter logic: `filed++` and `existingByKey.set()` only happen
   on success. On failure the counter increments and the doc is NOT
   added to `existingByKey` — future files with the same key won't
   incorrectly reuse it.

5. **Leave the `ingest_file` status update alone** (lines 190-195). The
   file DID become a `document`; the failure was in linking it. Marking
   it committed reflects that step-1 (document creation) succeeded and
   prevents re-processing the same file. The `linkFailed` counter
   surfaces the orphan for triage.

6. Return the counter — update the final return around line 198-204:

   Before:
   ```ts
   return {
     ok: true,
     propertyId: result.property_id,
     transferId: result.transfer_id,
     filed,
     deduped,
   };
   ```

   After:
   ```ts
   return {
     ok: true,
     propertyId: result.property_id,
     transferId: result.transfer_id,
     filed,
     deduped,
     linkFailed,
   };
   ```

**Verify**:
- `npm run typecheck` exits 0
- `grep -n "linkFailed" lib/intake/commit-batch.ts` shows exactly four
  matches: the type field, the initializer, two `linkFailed++` sites,
  the return field. (That's 5 lines; the type field and return field
  are two of them.)
- `grep -n "document_link" lib/intake/commit-batch.ts` shows the same
  two insert sites, both preceded by `{ error: linkErr }` destructuring
- Build: `npm run build` exits 0

**STOP if**:
- Typecheck complains about `CommitBatchResult` at a call site — any
  such site is out of scope for this plan. Report the site and stop;
  the fix is either "no-op" (the caller doesn't read `linkFailed` — no
  change needed) or "consume the new field" (small UI plan).
- You find a third `document_link.insert` in this file that this plan
  did not enumerate. That would mean the file drifted since planning.

### Step 3: Guard `resolveProperty` against non-property subjects

The 2026-09-28 walkthrough surfaced seven `property` rows created from
subject strings that were never addresses ("Pics", "Rates account",
"Master Templates", etc.). The pattern re-runs every time an inbound
Resend email arrives with a garbled subject. Fix at the source.

**Do:**

1. Create `lib/intake/subject-guard.ts` with a small predicate module.
   Keep it deliberately conservative — false positives here are
   annoying (an intake batch shows up in triage without an
   auto-assigned property) but false negatives create the exact junk
   rows this plan is closing. Content:

   ```ts
   // Predicate: is this email subject / batch label plausibly a
   // property address, or is it something else (a document description,
   // a folder name, an admin annotation)?
   //
   // Used by app/api/intake/email/route.ts resolveProperty to decide
   // whether to auto-create a property row from the subject. If this
   // returns true, the batch's property_id stays null and triage picks
   // the property by hand.
   //
   // Extend the pattern list as new false-positive shapes are found in
   // production. Deliberately not exhaustive — a real address that
   // happens to include a matched substring will fall to the guard,
   // and the operator resolves in triage. That is the right trade-off
   // (property auto-created from a wrong subject silently pollutes
   // the map, dashboard, dupes; batch without a property just needs
   // one click in triage to attach).

   const NON_PROPERTY_PATTERNS: RegExp[] = [
     // Folder-name shapes seen 2026-09-28
     /\bmaster templates?\b/i,
     /\brates account\b/i,
     /\bseller details\b/i,
     /\bpics?\b/i,
     /\bphotos?\b/i,
     /\bproposed plans?\b/i,
     /\bdesign manual\b/i,
     /\bcondition report\b/i,
     // Document-shape subjects (invoices, quotations, etc.)
     /\b(quotation|invoice|receipt|statement)\b/i,
     // Bare fragments that are clearly not addresses
     /^(re|fw|fwd|forward)[: ]/i,
   ];

   export function looksLikeNonProperty(subject: string): boolean {
     const s = subject.trim();
     if (s.length < 3) return true; // too short to be an address
     return NON_PROPERTY_PATTERNS.some((re) => re.test(s));
   }
   ```

2. Wire it into `app/api/intake/email/route.ts` — modify `resolveProperty`
   (currently lines 519-556). Before the `insert into property` branch,
   check the guard. Add the import at the top of the file:

   ```ts
   import { looksLikeNonProperty } from "@/lib/intake/subject-guard";
   ```

   Then update `resolveProperty` so the CREATE branch becomes:

   ```ts
   async function resolveProperty(
     supabase: SupabaseClient,
     subjectValue: string,
     fallbackLabel: string,
   ): Promise<ResolveResult> {
     const q = subjectValue.trim();
     if (q.length >= 3) {
       const { data: matches } = await supabase.rpc("match_property_by_address", {
         q,
         min_sim: PROPERTY_MATCH_THRESHOLD,
       });
       const best = (matches as Array<{ id: string; primary_address: string; sim: number }> | null)?.[0];
       if (best) {
         return {
           id: best.id,
           batchLabel: best.primary_address ?? fallbackLabel,
           matched: true,
           matchedName: best.primary_address ?? null,
         };
       }
     }

     // NEW GUARD: if the subject looks like a document / folder name
     // rather than a property address, do NOT auto-create. Return a
     // ResolveResult with a null id (see caller for the null-id path).
     if (looksLikeNonProperty(q)) {
       return {
         id: null,
         batchLabel: fallbackLabel,
         matched: false,
         matchedName: null,
       };
     }

     const primary_address = q || "(untitled intake)";
     const { data: newProp, error } = await supabase
       .from("property")
       .insert({ primary_address })
       .select("id, primary_address")
       .single();
     if (error || !newProp) {
       throw new Error(`could not create property: ${error?.message ?? "no row"}`);
     }
     return {
       id: newProp.id,
       batchLabel: newProp.primary_address ?? fallbackLabel,
       matched: false,
       matchedName: null,
     };
   }
   ```

3. Update the `ResolveResult` type at `app/api/intake/email/route.ts:514-517`
   so `id` is `string | null` instead of `string`:

   ```ts
   type ResolveResult = {
     id: string | null;
     batchLabel: string;
     matched: boolean;
     matchedName: string | null;
   };
   ```

4. Update the caller of `resolveProperty` (grep for it in the same file
   — one site around line 220-260). When `resolveResult.id` is null,
   the batch is created without a `property_id` — do NOT abort intake.
   The rest of the batch flow (upload files, classify, extract) works
   fine on a null property_id; only auto-commit is blocked, which is
   the intended outcome. Set `auto_commit_allowed = false` explicitly
   for batches without a property_id, so triage has to attach a
   property before the batch can auto-commit.

   The exact edit depends on the current caller shape — read the file
   and make the null-safe change. If any downstream code assumes
   `property_id` is non-null and this creates a NOT NULL constraint
   violation on `ingest_batch`, STOP and report: `ingest_batch.property_id`
   was already nullable before (created with the batch, populated
   later in triage), so this should be safe, but confirm before
   pushing the migration state.

**Verify**:
- `npm run typecheck` exits 0 after the type widening
- `grep -n "looksLikeNonProperty" app/ lib/ --include="*.ts"` shows two
  matches: the definition and the one import in the webhook route
- `grep -n "id: null" app/api/intake/email/route.ts` shows exactly one
  match (the new guard branch)
- Manual smoke: send yourself an email with subject "Rates account" to
  the intake address on a preview deploy; confirm the batch appears in
  triage with no property_id and does not create a property row.

**STOP if**:
- The caller of `resolveProperty` chains directly into code that
  requires a non-null `property_id` and cannot be null-guarded. That
  would mean the intake batch model has drifted from what this plan
  expects.
- Wiring the guard requires touching `commit_batch` RPC or the batch
  schema — both out of scope. Report and stop.

### Step 4: Update the extract SYSTEM_PROMPT to split combined-name purchasers/sellers

**Do:**

1. Edit `lib/extract.ts:5-36` SYSTEM_PROMPT. Find the "Capture ALL
   buyers and sellers…" rule (line 18) and add the following paragraph
   immediately after it. Keep it inside the same `export const SYSTEM_PROMPT = \`...\`;` template literal:

   ```
   - Joint purchasers or joint sellers on ONE signature line ("X AND Y", "X & Y") are TWO separate entries in the JSON array, not one. If the document lists purchaser: "PHILLIP ALFRED TRAYHORN DAVIS AND KATHERINE DAVIS", produce purchasers with two entries: {"name": "PHILLIP ALFRED TRAYHORN DAVIS", ...} and {"name": "KATHERINE DAVIS", ...}. The same applies to sellers. Do not concatenate names into a single party. If additional docs (e.g. FICA questionnaires) name the same people as "Phil Davis" and "Kate Davis", still emit them as two individuals — the OS deduplicates downstream.
   ```

2. Do NOT change the JSON_SHAPE constant — the schema already supports
   multiple entries in the `purchasers` and `sellers` arrays. The LLM
   just needed the instruction.

**Verify**:
- `npm run typecheck` exits 0 (prompt is a string literal; can't break
  types)
- `grep -c "AND KATHERINE DAVIS" lib/extract.ts` returns 1 — proves the
  new rule text landed
- Manual smoke (optional but recommended before merging): re-run
  extraction on one of the historical batches where the bug is visible
  (7 The Grove, 159 Sharples Close) via `/api/extract` and confirm the
  LLM now produces two purchaser entries instead of one. Do NOT commit
  the extracted rows during this smoke — inspect and roll back.

**STOP if**:
- The LLM regresses on unrelated cases (e.g. now splits a single
  purchaser whose legal name contains "and"). If manual smoke reveals
  this, refine the prompt rule with a counter-example and re-test —
  but confine the change to that one rule paragraph.
- OpenRouter's response shape changes such that additional array
  entries fail JSON parsing downstream. Not expected; `mapExtractionToRows`
  in `lib/extract.ts` already iterates arrays.

### Step 5: Regression check — dedup test still passes, existing intake flow still ships

**Do:**
1. `npm run test:dedup` — the only existing test. Confirms the shared
   `SupabaseClient` type import stays working.
2. `npm run build` — confirms every downstream server component and
   route handler still resolves.
3. Grep for external callers of the return type:
   `grep -rn "CommitBatchResult\|commitBatchWithClient\|extractBatchWithClient\|resolveProperty" app/ lib/ --include="*.ts" --include="*.tsx"`
   Confirm every caller of `commitBatchWithClient` destructures `.ok`,
   `.error`, `.filed`, `.deduped` and does not directly access an
   undocumented field. Confirm every caller of the now-nullable
   `resolveProperty` result null-guards `.id` before use.

**Verify**:
- Test + build both exit 0
- No caller of `commitBatchWithClient` errors on the new return field
  (TypeScript widening handles it)
- No caller of `resolveProperty` unwraps `.id` unconditionally
  (typecheck will catch this)

**STOP if**:
- Any caller breaks. Report and stop.

### Step 6: Update `plans/README.md` and commit

**Do:**
1. Edit `plans/README.md` — set plan 011 status to DONE.
2. Commit with the message in the "Git workflow" section — updated to
   reflect the extended scope:
   `Plan 011: intake commit-path integrity (parse+link errors, subject guard, purchaser split)`

**Verify**:
- `git status` shows only the five in-scope files modified plus
  `plans/README.md`
- `git log --oneline -1` shows the new commit

## Test plan

No new test files this plan. The two changes are:
- Adding a return field (proven by typecheck + build).
- Adding conditional log lines (proven by reading the diff; no runtime
  test setup exists for the intake pipeline yet — plan 012 addresses
  that).

**Explicit follow-up covered by plan 012**: an integration test that
mocks a corrupt PDF and asserts the new `[extract] parse failed` log
line fires; another that mocks a `document_link.insert` error and
asserts `linkFailed` increments. Both belong in plan 012 (test baseline)
because setting up the mock harness is the majority of that work.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm run test:dedup` exits 0
- [ ] `grep -n "linkFailed" lib/intake/commit-batch.ts` shows exactly
  5 lines (type field, initializer, two `++` sites, return field)
- [ ] `grep -n "return \"\";" lib/intake/extract-batch.ts` returns
  nothing (the old empty-catch return is gone)
- [ ] `grep -n "parse failed for batch" lib/intake/extract-batch.ts`
  returns exactly one line
- [ ] `grep -n "document_link insert failed" lib/intake/commit-batch.ts`
  returns exactly two lines
- [ ] `lib/intake/subject-guard.ts` exists and exports `looksLikeNonProperty`
- [ ] `grep -n "looksLikeNonProperty" app/api/intake/email/route.ts`
  returns exactly one match (the import) plus the call site
- [ ] `grep -n "id: null" app/api/intake/email/route.ts` returns
  exactly one match (the guard branch)
- [ ] `grep -c "AND KATHERINE DAVIS" lib/extract.ts` returns 1
  (the new split-combined-names rule)
- [ ] `git status` shows only `lib/intake/extract-batch.ts`,
  `lib/intake/commit-batch.ts`, `lib/intake/subject-guard.ts` (new),
  `app/api/intake/email/route.ts`, `lib/extract.ts`, `plans/README.md`
  modified

## STOP conditions

Stop and report back (do not improvise) if:

- Any caller of `textFromFile` outside `lib/intake/extract-batch.ts`
  exists (the plan assumes it's a private helper).
- Any caller of `commitBatchWithClient` breaks on the new
  `CommitBatchResult` shape (widening should be transparent; if it
  isn't, a call site is doing something the plan didn't scope).
- The `document_link` table has a unique constraint the plan didn't
  anticipate and every second run of the same batch trips it. That
  would mean the "dedup on existing document" branch is incomplete —
  investigate before "fixing" by swallowing the error.
- Build reports a route regression — a downstream import chain broke.

## Maintenance notes

For the human/agent who owns this next:

- **Surfacing `linkFailed` in the UI is a follow-up.** The counter is
  now available in `CommitBatchResult`. When the triage batch page
  (`app/triage/[batchId]/page.tsx` and its actions) grows a "commit
  results" panel, render the counter as a warning row when > 0.
  Similarly, `app/api/intake/email/route.ts` may want to surface
  `linkFailed > 0` in the webhook return / an alert email to Bronwyn.
- **When plan 012 lands a testing harness**, add two regression tests
  for this plan's fixes: (1) mock `textFromFile`'s `mammoth.extractRawText`
  to throw; assert the `[extract] parse failed` log fires and the file
  is excluded from `gathered`. (2) Mock the second `document_link.insert`
  to return `{ error: ... }`; assert `linkFailed` increments and `filed`
  does not.
- **The `console.error` pattern here matches `extract-batch.ts:279-281`.**
  If a structured logging library ever lands (`pino`, `winston`), migrate
  both sites together — they're the same class of operator-visibility
  log, not free-form debug.
- **Do NOT retrofit these fixes to look like transactions.** The intake
  pipeline is deliberately a series of independent RPCs, each of which
  can fail cleanly. Wrapping them in a Supabase transaction (or a
  homegrown "rollback on failure" wrapper) would introduce a worse
  failure mode: half-committed state after a mid-loop error.

## Follow-ups explicitly deferred out of this plan

- UI surfacing of `linkFailed` in triage / webhook return.
- Integration tests for the four fix sites (plan 012 — its scope now
  includes the subject-guard predicate and a corrupt-doc extract test).
- Structured logging migration.
- **Data cleanup for the seven junk property rows** already created
  by past intake runs: `docs/qa/2026-09-28-cleanup.sql` (Simon runs
  after per-row approval). Not code, not this plan.
- **Data cleanup for the existing bad "X and Y" party rows** (7 The
  Grove, 159 Sharples Close). The dupe finder + `merge_parties` won't
  help — a "one row" can't be structurally split into "two rows +
  joint link" via merge. Needs a small admin operation (delete the
  combined row, re-run extract on the source docs so the fixed prompt
  emits two rows). Track separately in the QA doc.
- **Plan 015 — dupe-scan fixes.** Related but different scope: fixes
  the dedup surface itself (deed-match not firing on 6 Bowden Park,
  party trigram missing combined-name pairs). Pending Simon's SQL
  investigation of the 6 Bowden Park pair — see the walkthrough at
  `docs/qa/2026-09-28-live-walkthrough.md` items #1 and #5.
