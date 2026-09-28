# Plan 012: Characterization test baseline for the intake + extract + dedup critical paths

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 042b246..HEAD -- lib/external-listings lib/intake lib/valuation-rolls package.json`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> real mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (unblocks P3 god-file refactors)
- **Effort**: M (one focused session; ~4–6 hours)
- **Risk**: LOW — adds files only. Uses the same `npx tsx` pattern the
  existing test uses, so no devDependency changes and no `package-lock.json`
  drift. If the tests turn up characterization gaps that surprise the
  executor, STOP — a gap is a real finding, not something to paper over
  in the test.
- **Depends on**: none (safe to run any time). Composes well with plan
  011 (which adds the `linkFailed` field this plan asserts on).
- **Category**: tests
- **Planned at**: commit `042b246`, 2026-09-28

## Why this matters

One test file exists in the repo:
`lib/external-listings/__tests__/dedup.collision.ts`. It regressed a
real over-merge bug (2026-08-05) and is the only automated safety net.
Every other risky change in this codebase — pdfjs upgrades, mandate
enum consolidation, god-file splits, LLM prompt changes — ships against
`tsc --noEmit` + a browser click, which is why the state file's most
expensive incidents (P24 clustering regression, dedup over-merge,
pdfjs worker path) were caught after they merged, not before.

This plan establishes a **minimum viable characterization test layer**
across the three hazardous shared modules the intake pipeline runs
through, using the same `npx tsx` pattern the dedup test uses so:

- **No devDependency changes** — no Jest, no Vitest, no `ts-jest`. Adding
  any of these desyncs `package-lock.json` and breaks Vercel's `npm ci`
  (state file 2026-08-05 explicitly records this constraint).
- **No test runner** — each file is a self-contained script that
  `process.exit(1)`s on failure and `console.log("PASS")`s on success.
  Mirror `lib/external-listings/__tests__/dedup.collision.ts` line-for-line.
- **Every test runnable individually** via `npm run test:X` scripts, and
  collectively via `npm test`.

Scope of coverage this plan adds:
1. **`lib/external-listings/dedup.ts`** — a second test beyond the
   existing collision one, covering the `prcl_key` and `lightstone_id`
   match rungs (highest-precedence match paths; regression risk when
   plan 007/013 slice 1b touches nearby code).
2. **`lib/intake/extract-batch.ts`** — the `textFromFile` helper's new
   error-surfacing behaviour (introduced by plan 011); the OCR-fallback
   silence guarantee; the `gathered` filter contract.
3. **`lib/intake/commit-batch.ts`** — the `document_link` failure
   counter (introduced by plan 011); the `existingByKey` dedup path;
   the extraction-rows-empty short-circuit.

Not in scope: LLM output validation (`lib/extract.ts`), the entire
webhook route, the Mapbox render path. Those need integration harnesses
this plan deliberately does not build.

## Current state

**The existing test pattern (read this fully before writing any test):**
`lib/external-listings/__tests__/dedup.collision.ts` — 123 lines. Every
new test in this plan mirrors its structure exactly:

- Doc-comment header explaining what regression the test guards and
  why. Every assertion has a "reverting X makes this fail" line so the
  next reader knows how to prove the test isn't vacuous.
- Fixture data as `const` literals at the top of the file.
- A hand-mocked `supabase` object typed `any`, using method chains that
  return either resolved promises or the next chain node. **Do not
  import any mocking library** — this is a bare-hands convention on
  purpose (see line 82: `/* eslint-disable @typescript-eslint/no-explicit-any */`).
- An IIFE at the bottom that runs the function under test, evaluates
  assertions into a `failures: string[]`, prints each failure with
  `console.error("FAIL ...")`, `process.exit(1)`s if any, otherwise
  `console.log("PASS ...")`.

**How the existing test runs:**
`package.json:11`:
```json
"test:dedup": "npx --yes tsx lib/external-listings/__tests__/dedup.collision.ts"
```

`npx --yes tsx` is the deliberate mechanism: it runs the file with
TypeScript+ESM support without pinning `tsx` as a devDependency (see
state file 2026-08-05: "Uses `npx --yes tsx` deliberately: adding tsx
to devDependencies would desync `package-lock.json` and break Vercel's
`npm ci`.").

**Files under test (what this plan reads, not modifies):**
- `lib/external-listings/dedup.ts` — the clustering + match module.
  Key entry point: `rebuildDedupAndMatch(supabase)`. Match precedence:
  lightstone_id > prcl_key > normalised address exact > token-subset >
  geo-proximity.
- `lib/intake/extract-batch.ts` — the shared LLM extract pipeline.
  Entry point: `extractBatchWithClient(supabase, batchId, opts)`. Helper
  under test: `textFromFile(filename, buf)` (private today; see below
  for how to reach it).
- `lib/intake/commit-batch.ts` — the shared commit pipeline. Entry
  point: `commitBatchWithClient(supabase, batchId, userId)`. Reads
  extraction + match_candidate rows, calls `commit_batch` RPC, promotes
  files to `document` + `document_link`.

**Constraint: `textFromFile` is currently a module-private helper.** To
test it directly requires exporting it. This is acceptable — the export
becomes part of the module's public API for the test's sake, and the
existing convention (see `lib/external-listings/dedup.ts` which exports
its internals for the test) matches.

## Commands you will need

| Purpose            | Command                                                         | Expected                     |
|--------------------|-----------------------------------------------------------------|------------------------------|
| Existing test      | `npm run test:dedup`                                            | PASS line                    |
| Typecheck          | `npm run typecheck`                                             | exit 0                       |
| Build              | `npm run build`                                                 | exit 0                       |
| Run new dedup test | `npm run test:dedup:match` (added in this plan)                 | PASS line                    |
| Run extract test   | `npm run test:extract:parse` (added in this plan)               | PASS line                    |
| Run commit test    | `npm run test:commit:linkfail` (added in this plan)             | PASS line                    |
| Run all            | `npm test` (added in this plan; runs the four in sequence)      | 4 PASS lines, exit 0         |

## Scope

**In scope (the only files you should create or modify):**
- `lib/external-listings/__tests__/dedup.match.ts` (create)
- `lib/intake/__tests__/extract-parse.ts` (create)
- `lib/intake/__tests__/commit-linkfail.ts` (create)
- `lib/intake/extract-batch.ts` — export `textFromFile` (one keyword
  change) so the extract-parse test can call it directly
- `package.json` — add three new test scripts + an aggregating `test`
  script
- `plans/README.md` — mark plan status on completion

**Out of scope:**
- Any devDependency change. Do NOT add `tsx`, `vitest`, `jest`,
  `ts-jest`, `@types/node` bumps, or anything else to `dependencies` or
  `devDependencies`. The `npx --yes tsx` invocation is intentional.
- Any refactor of the code under test to make it "more testable". If
  the test needs a change the code doesn't offer, either work around
  it in the mock (as the existing test does) or STOP.
- Testing `commit_batch` RPC SQL behaviour. That is Postgres-side and
  needs a live DB to test; out of scope here.
- Testing LLM output (`lib/extract.ts`). LLM I/O testing needs cassettes
  or a fake OpenRouter; too much scaffolding for this plan.
- Testing Mapbox render. Requires a browser. See "verify in browser"
  house rule.
- Testing the `/api/intake/email` webhook end-to-end. Requires a live
  Resend webhook or a captured payload; different plan.
- Testing plan 011's fixes if plan 011 has not yet landed. See "Ordering
  with plan 011" below.

## Ordering with plan 011

Plan 011 introduces:
- `textFromFile` returns `{ text: string; error?: string }` instead of
  `string`
- `commitBatchWithClient` returns a new `linkFailed` field

**If plan 011 has landed by the time you read this** (check
`grep -n "linkFailed" lib/intake/commit-batch.ts` — if it returns
matches, 011 is in): write the tests exactly as this plan describes
them. They assert against the post-011 behaviour.

**If plan 011 has NOT landed:** either (a) execute plan 011 first, then
this plan (recommended); or (b) drop the two 011-specific assertions
from the tests in this plan and note the omission in the test's header
doc-comment. The tests still add value in that case (they characterize
the current behaviour and will fail loudly when 011 lands, at which
point the assertions are trivially fixable).

## Git workflow

- Do NOT push. Simon owns push.
- One commit at the end:
  `Plan 012: test baseline for dedup, extract, commit paths (4 tests)`

## Steps

### Step 1: Add the `npm test` aggregator + three new test scripts

**Do:**

1. Edit `package.json` scripts block (currently lines 5-12). After the
   existing `"test:dedup"` line, add:

   ```json
       "test:dedup": "npx --yes tsx lib/external-listings/__tests__/dedup.collision.ts",
       "test:dedup:match": "npx --yes tsx lib/external-listings/__tests__/dedup.match.ts",
       "test:extract:parse": "npx --yes tsx lib/intake/__tests__/extract-parse.ts",
       "test:commit:linkfail": "npx --yes tsx lib/intake/__tests__/commit-linkfail.ts",
       "test": "npm run test:dedup && npm run test:dedup:match && npm run test:extract:parse && npm run test:commit:linkfail"
   ```

   Preserve trailing commas per JSON spec (the last `test` entry has
   no trailing comma).

2. Confirm the plan structure: three new test files live in two
   `__tests__/` directories:
   - `lib/external-listings/__tests__/` — already exists.
   - `lib/intake/__tests__/` — create it in Step 3.

**Verify**:
- `cat package.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('\n'.join(d['scripts'].keys()))"`
  shows all four `test:*` scripts + `test`.
- `npm run test:dedup` still exits 0 (regression baseline unchanged).

**STOP if**:
- `package.json` fails to parse — a trailing-comma slip. Re-format and
  retry.
- The existing test regresses to failure (that would be a real
  problem — either the environment changed or an earlier plan touched
  `dedup.ts`).

### Step 2: Add the second dedup test — match-precedence characterization

**File**: `lib/external-listings/__tests__/dedup.match.ts`

**What to assert:**
1. Two external_listings with the same non-null `lightstone_property_id`
   both get `matched_property_id` set to the same property, regardless
   of address or coordinates.
2. Two external_listings sharing a `prcl_key` with a property that has
   a `prcl_key` both attach to that property (proves the prcl_key rung
   works below lightstone_id and above address).
3. A row with `matched_property_id` already set does NOT get overwritten
   by the rebuild (manual overrides are preserved — see `dedup.ts:322-324`
   comment).

**Do:**

1. Read `lib/external-listings/dedup.ts` fully — pay attention to lines
   322-380 where the property-matching passes run, and to the
   `propByLs`, `propByPrcl` maps.
2. Read `lib/external-listings/__tests__/dedup.collision.ts` again for
   the fixture and mock-supabase shape.
3. Create `lib/external-listings/__tests__/dedup.match.ts` following the
   same layout:
   - Doc-comment header: what this guards and why. Include "reverting
     the lightstone precedence check in dedup.ts makes assertion 1 fail"
     and similar for assertions 2 and 3.
   - Fixture: 2 properties with distinct `lightstone_property_id` and
     `prcl_key`, plus 3 external_listings — one anchored by lightstone,
     one by prcl_key, one with a pre-existing manual match.
   - Mock: extend the existing `dedup.collision.ts` mock shape. The
     rebuild reads from `property` in addition to `external_listing`;
     grep dedup.ts for the exact `.from("property").select(...)` and
     match its column list. Return the fixture properties there.
   - IIFE: call `rebuildDedupAndMatch(supabase)`, inspect the
     `patches` map, evaluate the three assertions, exit with a PASS or
     FAIL exactly like the collision test.

**Verify**:
- `npm run test:dedup:match` prints one PASS line and exits 0.
- Reverting `dedup.ts` line ~332 (the `propByLs.set(...)` line) makes
  assertion 1 fail. **Do this reversion ephemerally, run the test,
  confirm FAIL, revert your reversion, re-run and confirm PASS.** This
  is the "proves the test isn't vacuous" step the existing test does
  implicitly and this plan makes explicit.

**STOP if**:
- The test PASSes even when you revert the property-match code — the
  test is asserting something that doesn't need the code under test.
  Rework the fixture or assertions.

### Step 3: Add the extract-parse test — `textFromFile` error surfacing

**Prep**: If plan 011 has NOT landed yet, this step becomes "characterize
the current behaviour" (empty-return-on-throw). Note the mode in the
test header and rewrite the assertions to match — see the "if plan 011
hasn't landed" branch at the bottom of this step.

**File**: `lib/intake/__tests__/extract-parse.ts`

**What to assert (post-011 behaviour):**
1. `textFromFile("foo.txt", Buffer.from("hello world"))` returns
   `{ text: "hello world" }` with no `error` field. (utf8 fast path)
2. `textFromFile("foo.docx", <bytes that make mammoth throw>)`
   returns `{ text: "", error: <string> }`. Use a Buffer of random
   bytes — mammoth rejects it as not a zip.
3. `textFromFile("foo.pdf", <bytes that make pdf-parse throw>)`
   returns `{ text: "", error: <string> }`. Same approach: random bytes.
4. `textFromFile("empty.pdf", <valid empty-text-layer PDF>)` returns
   `{ text: "" }` with NO error (empty text is valid; do NOT set
   `error` in this case).

Assertion 4 needs a real "empty text layer" PDF. Rather than shipping a
PDF fixture in the repo, cover the discrimination differently: use a
zero-byte or one-byte input that pdf-parse rejects. That collapses 3
and 4 into one assertion path. **Alternative: skip assertion 4 and rely
on assertion 3 alone.** Note the skip in the test header.

**Do:**

1. First, export `textFromFile` from `lib/intake/extract-batch.ts`:
   Change (currently line 47):
   ```ts
   async function textFromFile(filename: string, buf: Buffer): Promise<TextExtractResult> {
   ```
   to:
   ```ts
   export async function textFromFile(filename: string, buf: Buffer): Promise<TextExtractResult> {
   ```
   Also export the `TextExtractResult` type if it isn't already:
   ```ts
   export type TextExtractResult = { text: string; error?: string };
   ```

2. Create `lib/intake/__tests__/extract-parse.ts`:
   - Doc-comment header covering the four assertions.
   - Import: `import { textFromFile } from "../extract-batch";`
   - Assertions: run each case, collect failures, PASS/FAIL as the
     existing test does.

**Verify**:
- `npm run test:extract:parse` prints PASS.
- Reverting plan 011's `textFromFile` refactor (i.e. going back to
  returning `string`) makes typecheck fail (the test relies on the
  object shape). This is fine — the compile-time failure IS the test
  guard for the shape.
- Reverting only the error-surfacing branch (returning `{ text: "" }`
  from the catch instead of `{ text: "", error: ... }`) makes
  assertion 2 fail. Do the ephemeral revert + rerun as in Step 2.

**STOP if**:
- `textFromFile` cannot be exported without a knock-on typecheck
  failure (unlikely — it's a pure helper).
- Assertions 2 or 3 pass with random-byte input that mammoth/pdf-parse
  should reject. Either the library changed behaviour or the test isn't
  actually reaching the catch branch — investigate.

**If plan 011 has NOT landed:**
- `textFromFile` still returns `string`.
- Rewrite assertions 2 and 3 to assert `textFromFile(...) === ""`
  (the pre-011 silent behaviour). Assertion 1 (`"hello world"`) is
  unchanged.
- Header doc-comment notes: "characterization test for pre-011
  behaviour. When plan 011 lands, update assertions 2 and 3 to expect
  `{ text: '', error: <string> }`."

### Step 4: Add the commit-linkfail test — `document_link` insert failure counter

**Prep**: Requires plan 011's `linkFailed` field. If plan 011 has not
landed, either land it first or write this test as a placeholder that
asserts current behaviour (link errors silently swallowed → `filed`
counted anyway). Note the mode in the test header.

**File**: `lib/intake/__tests__/commit-linkfail.ts`

**What to assert (post-011 behaviour):**
1. When both `document_link.insert` calls succeed, `commitBatchWithClient`
   returns `{ ok: true, filed: N, linkFailed: 0 }`.
2. When the second `document_link.insert` (new-document, link-to-both)
   returns `{ error: <object> }`, `commitBatchWithClient` returns
   `{ ok: true, filed: N-1, deduped: 0, linkFailed: 1 }`. `filed` is
   NOT incremented for the failed file.
3. When the first `document_link.insert` (dedup, existing-document,
   add-link) returns `{ error: <object> }`, `linkFailed` increments and
   `deduped` does NOT.

**Do:**

1. Create `lib/intake/__tests__/commit-linkfail.ts`:
   - Doc-comment header covering the three assertions and
     "reverting the plan-011 error check makes assertions 2 and 3 fail".
   - Fixture: minimal `extraction` rows sufficient for `reshapeFields`
     to produce a fields object; one `ingest_file` row per assertion
     with distinct `id`s.
   - Mock supabase: extends the pattern from `dedup.collision.ts` with
     more table branches. Specifically needs:
     - `.from("extraction").select().eq().eq()` → returns fixture rows
     - `.from("match_candidate").select().eq().eq()` → returns `[]`
     - `.from("ingest_batch").select().eq().single()` → returns
       `{ property_id: null, transfer_id: null }` (avoid triggering the
       fallback branches)
     - `.from("suburb").select()` → returns `[]`
     - `.rpc("commit_batch", ...)` → returns `{ data: { property_id: 'p1', transfer_id: 't1' } }`
     - `.rpc("propose_matches", ...)` → returns `{ data: null, error: null }`
     - `.from("ingest_file").select().eq()` → returns the fixture files
     - `.from("document_link").select().eq().eq()` → returns `[]` (no
       existing links)
     - `.from("document_link").insert(...)` → per-test toggle:
       returns `{ error: null }` for the success case, `{ error: { message: "simulated failure" } }` for the failure case.
     - `.from("document").insert().select().single()` → returns
       `{ data: { id: 'doc-1' } }`
     - `.from("ingest_file").update().eq()` → returns `{ error: null }`

   The mock is the majority of the file — this is normal. Copy the
   chain structure from `dedup.collision.ts` and extend.

2. Import: `import { commitBatchWithClient } from "../commit-batch";`
3. Three tests via three fresh mock instances (or one mock with a
   toggle). Each returns a `CommitBatchResult`; assert on the shape.

**Verify**:
- `npm run test:commit:linkfail` prints PASS.
- Reverting the plan-011 fix in `commit-batch.ts` (removing the
  `{ error: linkErr }` destructuring on the second insert) makes
  assertion 2 fail. Ephemeral revert + rerun as in Step 2.

**STOP if**:
- The mock supabase gets into a chain state the real Supabase client
  library doesn't reach — either the mock is wrong or the code under
  test has a code path the plan didn't map. If the latter, that's a
  real finding; STOP and report it.

### Step 5: Run everything, then commit

**Do:**

1. `npm test` — runs all four in sequence. All four PASS.
2. `npm run typecheck` — exits 0. This is the guard on the
   `TextExtractResult` shape being consistent across code and tests.
3. `npm run build` — exits 0. Guards against a route accidentally
   depending on `textFromFile` being private (unlikely, since only
   `extract-batch.ts` uses it).
4. Update `plans/README.md` — set plan 012 status to DONE.
5. Commit with the message in the "Git workflow" section.

**Verify**:
- `npm test` output ends with 4 PASS lines and exit 0.
- `git status` shows only the six in-scope files modified.

## Test plan

This plan IS the test plan.

**Meta-verification (do this at least once):** each of the three new
tests must FAIL when its target guard is reverted. This is documented
per-step above; do it not because the executor is expected to be
suspicious of the assertions, but because the whole point of adding a
test is proving it catches the regression it names.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm test` runs and exits 0, printing 4 PASS lines
- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] Three new test files exist:
  - `lib/external-listings/__tests__/dedup.match.ts`
  - `lib/intake/__tests__/extract-parse.ts`
  - `lib/intake/__tests__/commit-linkfail.ts`
- [ ] `package.json` has four `test:*` scripts + a `test` aggregator
- [ ] `git status` shows only in-scope files
- [ ] `plans/README.md` shows plan 012 as DONE
- [ ] `package-lock.json` is unchanged (no new devDependencies)

## STOP conditions

Stop and report back (do not improvise) if:

- `package-lock.json` changes when it shouldn't. That means `npm test`
  or `npx tsx` triggered a dependency install into the lockfile —
  investigate before committing.
- A test passes when its guard is reverted (vacuous assertion).
- The mock supabase in Step 4 doesn't cover a code path that the real
  commit function actually walks — see "STOP if" under Step 4.
- Any test fails on the first run and the fix would require editing
  code under test. That's a real finding; STOP and describe it —
  do NOT loosen the assertion to make it pass.
- `textFromFile` cannot be exported without a knock-on typecheck failure.

## Maintenance notes

For the human/agent who owns this next:

- **These tests are load-bearing for the god-file refactors** (plan
  013+ candidates for MapView.tsx and PropertyRecord). Any refactor
  that touches dedup, extract, or commit paths runs `npm test` first
  and after; if either state is FAIL, the refactor either broke
  something or the test is out of date.
- **When a fifth or sixth test lands**, revisit whether the `&&` chain
  in `npm test` is still ergonomic. A tiny runner script that walks
  `lib/**/__tests__/*.ts` and executes each with `npx tsx` is fine
  and adds no devDependencies. Do NOT reach for Jest/Vitest for
  ergonomic gains alone — the constraint from state file 2026-08-05 is
  binding.
- **The `npx --yes tsx` invocation downloads tsx into the npm cache on
  first run.** Subsequent runs use the cache. On Vercel this is fine
  because `npm test` doesn't run in the deploy pipeline (no CI is
  configured today). If CI is later added, `npx tsx` on a cold cache
  costs about 30s the first time.
- **A future integration test** for the full email-webhook path is a
  worthwhile follow-up but is a bigger plan (needs a captured Resend
  payload + a way to stub out OpenRouter without hitting the network).
  Not this plan.

## Follow-ups explicitly deferred out of this plan

- Integration tests for the email-webhook end-to-end path.
- LLM output validation tests (needs OpenRouter cassettes).
- Mapbox render tests (needs a browser harness — Playwright?).
- CI wiring (`.github/workflows/test.yml`) — this plan lands the tests;
  a follow-up wires them into CI. No devDependency cost, only a YAML
  file.
- Test coverage of `lib/valuation-rolls/parser.ts` — the pdfjs quirks
  are documented in `parser.ts` and `next.config.mjs`, but characterizing
  them needs real PDF fixtures (large, binary — arguably belong in
  git-lfs, not the repo). Its own plan.
