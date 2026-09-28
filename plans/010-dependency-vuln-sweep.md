# Plan 010: Dependency vulnerability sweep (npm audit fix, non-breaking)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 042b246..HEAD -- package.json package-lock.json next.config.mjs lib/valuation-rolls`
> If any listed file changed since this plan was written, re-run
> `npm audit --json` and compare the vulnerability list against the
> "Current state" table below. If the vuln set has drifted materially
> (advisories cleared, new criticals appeared), STOP and report.

## Status

- **Priority**: P1
- **Effort**: S (a single session; ~2–3 hours including manual smoke)
- **Risk**: MED — bumps `pdfjs-dist` 6.1.200 → 6.3.289 and `mailparser`
  3.9.12 → 3.9.30. Both minor bumps within the same major. `pdfjs-dist`
  has *specifically* bitten this repo before (state file 2026-07-27 evening:
  DOMMatrix polyfill + worker-file tracing on Vercel Node). Any pdfjs bump
  needs the valuation-roll upload path smoked before merge.
- **Depends on**: none
- **Category**: security + dependencies
- **Planned at**: commit `042b246`, 2026-09-28

## Why this matters

`npm audit --production` reports 10 advisories on the current lockfile:
1 critical, 9 high. Nine of the ten fix without a breaking upgrade;
`npm audit fix` handles them in one shot. The remaining critical
(`postcss` sourceMappingURL disclosure and a related `next` bypass) can
only be cleared by upgrading `next` to 16.x, which is a breaking-change
plan of its own scope — deferred out of here.

Concrete reachable impact of the nine non-breaking advisories:
- **`mailparser` (direct)** + its transitives (`nodemailer`,
  `html-to-text`, `linkify-it`, `@xmldom/xmldom`, `nanoid`) — all
  reachable through `app/api/intake/email/route.ts` on every inbound
  Resend webhook. Advisories include ReDoS in `nodemailer`'s address
  parser, IDN allow-list bypass leading to attacker-controlled delivery,
  and XML parser injection. Live intake pipeline.
- **`pdfjs-dist` (direct)** — arbitrary JS execution on a malicious PDF.
  Reachable through `app/api/valuation-rolls/[id]/parse/route.ts` on
  every admin PDF upload. Admin-only, so blast radius is smaller, but
  still a real hazard.
- **Various transitives** (`deepmerge-ts`, `nanoid`) — cleared
  incidentally.

## Current state

**Vulnerability snapshot (`npm audit --json` at planning time):**

| Package             | Severity | Direct | Fix requires next@16? |
|---------------------|----------|--------|-----------------------|
| `mailparser`        | high     | yes    | no                    |
| `pdfjs-dist`        | high     | yes    | no                    |
| `nodemailer`        | high     | no (via mailparser) | no       |
| `html-to-text`      | high     | no                  | no       |
| `linkify-it`        | high     | no                  | no       |
| `@xmldom/xmldom`    | high     | no                  | no       |
| `deepmerge-ts`      | high     | no                  | no       |
| `nanoid`            | high     | no                  | no       |
| `postcss`           | high     | no                  | **yes**  |
| `next`              | critical | yes                 | **yes**  |

**Package version deltas that `npm audit fix` will apply:**
- `mailparser`: 3.9.12 → 3.9.30 (minor)
- `pdfjs-dist`: 6.1.200 → 6.3.289 (minor)
- transitives cascade from those two + npm's dedupe

**What `npm audit fix` will NOT touch (deferred):**
- `next`: 14.2.15 → 16.3.6 (**major**, out of scope here)
- `postcss`: only reachable via the next major

**Relevant files that must survive the pdfjs bump unchanged in behaviour:**
- `lib/valuation-rolls/parser.ts` — carries the DOMMatrix / Path2D /
  ImageData polyfills required for pdfjs-dist v6 on Vercel Node. State
  file 2026-07-27 evening explains why (~30 MB cheaper than the
  `@napi-rs/canvas` alternative).
- `next.config.mjs:11-16` — `outputFileTracingIncludes` explicitly
  bundles `pdfjs-dist/legacy/build/pdf.mjs` and `pdf.worker.mjs` so
  the fake-worker bootstrap can find them at runtime on Vercel. State
  file 2026-07-27 records the debugging arc that discovered this.

A pdfjs minor bump could (a) shuffle the worker path, (b) require
additional polyfills, or (c) change the module layout the tracing
config points at. Manual smoke on `/admin/valuation-rolls` upload is
mandatory before merge.

## Commands you will need

| Purpose               | Command                                   | Expected                                    |
|-----------------------|-------------------------------------------|---------------------------------------------|
| Snapshot current lock | `git stash push -u package-lock.json`     | (or copy the file aside — see Step 1)       |
| Audit (before)        | `npm audit --production`                  | reports "10 vulnerabilities (9 high, 1 critical)" |
| Apply fix             | `npm audit fix`                           | reports patched packages; NO "install X, breaking change" line |
| Audit (after)         | `npm audit --production`                  | reports 2 vulnerabilities: `next`, `postcss` (both marked "breaking change") |
| Typecheck             | `npm run typecheck`                       | exit 0                                      |
| Build                 | `npm run build`                           | exit 0, 49+ routes                          |
| Dedup regression      | `npm run test:dedup`                      | 2 assertions pass                           |

## Scope

**In scope:**
- `package.json` (may change if audit fix bumps a direct dep's
  declared range)
- `package-lock.json` (will change materially)
- Nothing else. This plan is a lockfile bump plus smoke.

**Out of scope (do NOT touch):**
- `next` upgrade — critical advisory is cleared only by 14 → 16 major.
  That is its own plan (candidate 014). Do NOT run `npm audit fix --force`.
- `postcss` — chained to the next upgrade, same reason.
- Any code change. If a test fails after the bump, STOP and report;
  do NOT paper over it by editing app code.
- `next.config.mjs` — leave the `outputFileTracingIncludes` alone. If
  the pdfjs 6.3 worker path has changed, that is a real regression that
  needs its own investigation, not a config edit inside this plan.
- `lib/valuation-rolls/parser.ts` — same reason. Polyfills stay as-is.
  If the new pdfjs needs different ones, that is a STOP condition.

## Git workflow

- Do NOT push. Simon owns push.
- One commit at the end. Subject line, matching repo style:
  `Plan 010: npm audit fix — clear 8 high advisories (mailparser, pdfjs-dist, transitives)`
- Body should list the direct package bumps for the commit log:
  `- mailparser 3.9.12 → 3.9.30`
  `- pdfjs-dist 6.1.200 → 6.3.289`
  `- next / postcss deferred; blocked on 14→16 major upgrade (see plans/README.md).`

## Steps

### Step 1: Snapshot the lockfile so revert is one command

Before touching anything, make the rollback trivial.

**Do:**
1. `cp package-lock.json package-lock.json.pre010` — plain file copy in
   the working directory. **Do NOT commit this file.** Add it to your
   local ignore only if `git status` starts showing it (it's not in
   `.gitignore` yet; the copy is temporary and gets deleted in Step 6).
2. Record baseline audit output:
   `npm audit --production > /tmp/audit-before.txt 2>&1`
3. `npm audit --production | tail -5` — confirm the baseline reads
   "10 vulnerabilities (9 high, 1 critical)". If the count is smaller,
   fine — some advisories may have been withdrawn. If the count is
   larger, STOP.

**Verify**:
- `ls package-lock.json.pre010` shows the snapshot
- `/tmp/audit-before.txt` exists

**STOP if**:
- `npm audit` reports MORE than 10 vulnerabilities, or introduces a
  critical outside `next` or `postcss` — the drift check should have
  caught this but confirm now.

### Step 2: Run `npm audit fix` (non-breaking)

**Do:**
1. `npm audit fix` (NO `--force` flag).
2. Read the output carefully. Expect:
   - Lines reporting packages patched (both direct and transitive).
   - A closing summary showing how many vulnerabilities were fixed.
   - NO line beginning with `Will install X, which is a breaking change` —
     if that line appears, STOP; the environment has changed since the
     plan was written and `--force` behaviour has bled into the non-force
     path (unusual).
3. `npm audit --production > /tmp/audit-after.txt 2>&1`
4. `diff /tmp/audit-before.txt /tmp/audit-after.txt` — read the diff.
   Expect the eight non-breaking advisories to disappear; expect the
   two breaking ones (`next` + `postcss`) to remain, with npm's output
   noting they need `--force`.

**Verify**:
- `npm audit --production | tail -5` reads
  "2 vulnerabilities (1 high, 1 critical)" (or similar shape — the
  key is `next` + `postcss` are the ONLY two left)
- `git diff --stat package.json package-lock.json` shows changes to at
  least `package-lock.json` (and possibly `package.json` if any
  declared range was tightened)

**STOP if**:
- Output includes a "breaking change" line.
- More than the two known advisories remain post-fix.
- `package.json` shows a change to a package NOT in
  `{mailparser, pdfjs-dist}` — an unexpected direct-dep bump means npm
  chose a different resolution than planned.

### Step 3: Typecheck + build baseline

**Do:**
1. `npm run typecheck`
2. `npm run build`
3. `npm run test:dedup`

**Verify**:
- All three exit 0
- `npm run build` reports the same route count as before the fix
  (49+ per README). A route-count regression usually means a route
  errored during build silently — read the full build log.

**STOP if**:
- Typecheck introduces new errors, especially referencing `mailparser`
  or `pdfjs-dist` type definitions. Minor bumps can change types.
- Build fails, especially with `Cannot find module 'pdf.worker.mjs'`
  or a DOMMatrix / Path2D error — that would confirm pdfjs 6.3 has
  moved the worker path or needs different polyfills. Report the
  specific error verbatim.

### Step 4: Smoke the valuation-roll upload path manually (pdfjs regression check)

This is the load-bearing manual verification for this plan. The dedup
test does not cover pdfjs; only running the parser against a real PDF
does.

**Do:**
1. Post to Simon: **"Please run `npm run dev` locally, log in as admin,
   go to `/admin/valuation-rolls`, upload one of the two authoritative
   Knysna Muni PDFs (Full GV or Supplement 4 — whichever is smallest to
   hand), and click through Parse → Apply. Confirm both stages complete
   without error. If Parse errors with anything referencing DOMMatrix,
   Path2D, ImageData, or the worker, that's the pdfjs 6.3 regression —
   paste the error."**
2. If Simon cannot smoke it locally, alternative path: post the SQL to
   verify current Bon Bon state, deploy to a Vercel preview
   (`git push` onto a branch — but per house rules Simon owns push, so
   this becomes: "please push and check the preview deploy"), and smoke
   on the preview. Local is preferred because it exercises the exact
   Node runtime bundling logic that first tripped 2026-07-27.
3. Wait for Simon's "smoke passed" or "smoke failed with X".

**Verify**:
- Simon confirms both Parse and Apply completed without error on at
  least one real muni PDF.

**STOP if**:
- Parse or Apply fails with any pdfjs-related error. Do NOT edit
  `parser.ts` or `next.config.mjs` in an attempt to fix — that's outside
  scope. Instead:
  - Report the error verbatim
  - Restore the lockfile: `cp package-lock.json.pre010 package-lock.json && npm install`
  - Rerun `npm audit --production | tail -5` to confirm baseline restored
  - Update this plan's status to BLOCKED with the specific pdfjs error
    quoted, so a follow-up plan can address it before retrying the
    audit fix.

### Step 5: Manual smoke on the email intake path (mailparser regression check)

**Do:**
1. Post to Simon: **"Please forward one of the sample listing emails to
   `intake@dreamproperties.app` (or the local dev-equivalent if you
   have one wired). Then check `/inbox` and `/triage` to confirm the
   batch appears and files parsed. If anything looks off — attachment
   count wrong, sender email mangled, subject missing — flag it."**
2. Alternative path if Simon doesn't have a sample email to hand: this
   step is skippable-with-note. mailparser 3.9.12 → 3.9.30 is a small
   bump within the same major; the changelog is unlikely to break
   ingestion. Note the skip in the commit body.

**Verify**:
- Simon confirms a batch created and its files listed with the correct
  sender + subject.

**STOP if**:
- Any field on the batch reads garbled or empty where the source email
  had content.
- The webhook returns 500 with a stack that mentions `mailparser`,
  `nodemailer`, `linkify-it`, `html-to-text`, or `@xmldom/xmldom`.

### Step 6: Clean up + commit

**Do:**
1. Delete the snapshot: `rm package-lock.json.pre010`
2. `git status` — confirm only `package.json` and `package-lock.json`
   are modified. If anything else is dirty, investigate before
   committing.
3. Update `plans/README.md` — set plan 010 status to DONE.
4. Commit with the message from the "Git workflow" section.

**Verify**:
- `git log --oneline -1` shows the new commit.
- `git status` clean.

## Test plan

No new test files. Verification is:

- `npm run typecheck` and `npm run build` (proves types + build resolve
  post-bump).
- `npm run test:dedup` (regression baseline on dedup pipeline).
- Manual smoke on `/admin/valuation-rolls` upload (proves pdfjs 6.3
  still boots on Node with the existing polyfills).
- Manual smoke on `intake@dreamproperties.app` (proves mailparser 3.9.30
  still ingests correctly).

Automated coverage of these paths is desirable and is plan 012's job,
not this plan's.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm audit --production | tail -5` reports 2 vulnerabilities left
  (both breaking, both attributed to `next` / `postcss`)
- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm run test:dedup` exits 0
- [ ] Simon confirmed the valuation-roll upload path still works after
  the pdfjs bump
- [ ] Simon confirmed (or explicitly skipped with rationale) the email
  intake smoke after the mailparser bump
- [ ] `git status` clean; only `package.json` + `package-lock.json`
  changed
- [ ] `plans/README.md` shows plan 010 as DONE
- [ ] No `.pre010` snapshot file left in the tree

## STOP conditions

Stop and report back (do not improvise) if:

- The baseline audit reads differently from the "Current state" table
  (more advisories, new criticals outside `next`/`postcss`).
- `npm audit fix` (without `--force`) suggests a breaking change.
- Typecheck or build introduces new errors after the bump.
- Valuation-roll parse/apply throws a pdfjs error.
- Email intake smoke shows garbled fields or a mailparser stack trace.
- `git status` shows changes to files outside `package.json` +
  `package-lock.json`.

## Maintenance notes

For the human/agent who owns this next:

- **The next-major upgrade is its own plan.** `next@14 → 16` is a
  double-major (14 → 15 → 16). Each hop has App Router semantic
  changes worth reading carefully. When authoring that plan, at minimum:
  - Read the Next.js 15 and 16 upgrade guides.
  - Enumerate every server-action file (`grep -rn "\"use server\"" app/`) —
    server action semantics have shifted across majors.
  - Enumerate every route handler (`find app/api -name route.ts`) —
    behaviour around body parsing and middleware ordering has shifted.
  - Enumerate every middleware caller in this repo (`middleware.ts` +
    anything under `lib/supabase/middleware.ts`).
  - Test the map route heavily — Mapbox interaction with the App Router
    strict mode was already fragile per state file lessons.
- **If pdfjs-dist ships a 7.x major before the next major upgrade lands**,
  that is another bump with real risk on Vercel Node. State file
  2026-07-27 evening is required reading before that plan.
- **If a new critical appears on `mailparser` before the next major
  lands**, one option is to swap mailparser for a leaner extractor if
  the intake path only needs `multipart/mixed` splitting. Not urgent
  today; would be worth its own plan.

## Follow-ups explicitly deferred out of this plan

- `next` 14 → 15 → 16 major upgrade (with the `postcss` chain fix).
  Should be a P2 plan with a full smoke matrix and staging preview
  before push.
- Adding an `npm audit --production --audit-level=high` check to CI so
  the lockfile can't regress silently. Currently no CI exists in the
  repo config (no `.github/workflows`, no `vercel.json` build hook
  beyond the Vercel defaults). Worth adding as a DX plan.
