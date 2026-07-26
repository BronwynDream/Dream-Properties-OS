# Plan 001: Parallelise signed-URL generation on the Property Record page

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f3b6711..HEAD -- app/properties/\[id\]/page.tsx`
> If that file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f3b6711`, 2026-07-26

## Why this matters

Every load of `/properties/[id]` serially awaits one `createSignedUrl` call per
attached document (title deeds, mandates, FICA docs, agreements, photos, etc.).
A well-documented deal has 15-20 documents; at ~150-300ms per storage call,
that's 3-6 seconds of avoidable blocking before the page becomes usable.

The property record is the CRM's most-visited screen; agents open it dozens of
times a day. Parallelising these independent calls with `Promise.all` is a
mechanical fix that turns 3-6s into ~300ms — the biggest single user-visible
perf win identified in the 2026-07-26 audit.

## Current state

**File:** `app/properties/[id]/page.tsx` (798 lines total).

The offending loop, lines 171-206:

```tsx
const docs: DocRow[] = [];
const seenIds = new Set<string>();
for (const dl of docLinks) {
  const d = dl.document;
  if (!d) continue;
  // Deduplicate at read time as well — a document linked to multiple transfers
  // (post-dedupe) shows up once per transfer link. Show it under the first.
  const dedupeKey = `${d.id}::${dl.entity_id}`;
  if (seenIds.has(dedupeKey)) continue;
  seenIds.add(dedupeKey);

  const { data: signed, error: signErr } = d.storage_bucket && d.storage_path
    ? await supabase.storage.from(d.storage_bucket).createSignedUrl(d.storage_path, 3600)
    : { data: null, error: null };
  if (signErr) {
    console.error(`[property] signed URL failed for doc ${d.id} (${d.title}):`, signErr.message);
  }
  // isImage drives the Photos strip below the deal card. Strict on purpose:
  // only files whose doc_type is 'photo'. Scanned IDs / passports would be
  // image files too but they belong to fica category — surfacing them in a
  // public strip is a POPIA problem, so the doc-chip renderer handles them
  // as text chips instead.
  const isImage = d.doc_type?.code === "photo";
  docs.push({
    transfer_id: dl.entity_id,
    id: d.id,
    title: d.title,
    label: d.doc_type?.label ?? null,
    code: d.doc_type?.code ?? null,
    category: d.doc_type?.category ?? "other",
    mime_type: d.mime_type ?? null,
    is_pii: d.is_pii,
    url: signed?.signedUrl ?? null,
    isImage,
  });
}
```

The `await` inside the `for` loop is the bug. Each iteration blocks on network
I/O for the previous document.

**Key facts to preserve:**

1. **Order matters** — the `docs` array is consumed downstream by `docsFor(tid)`
   and `groupedDocsFor(tid)` (defined further down the same file) which don't
   sort but expect a stable ordering per transfer. Preserve the current insertion
   order (which is `docLinks` order).
2. **Dedup logic must stay** — `dedupeKey = ${d.id}::${dl.entity_id}` skips
   duplicates. A document linked to multiple transfers appears once per transfer
   link, and we deduplicate to show it under the first.
3. **`signErr` logging** — keep the `console.error` line; it's the only signal
   we have when storage auth fails vs. a document with no file.
4. **Null-safe** — some documents have no `storage_bucket` or `storage_path`
   (e.g. rows created before the storage refactor). The current ternary returns
   `{ data: null, error: null }` for those; preserve that.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0, no errors   |
| Lint      | `npm run lint`      | exit 0              |
| Build     | `npm run build`     | exit 0 (prerender error on `/login` is expected without local Supabase env — ignore) |

There is no test suite in this repo. Verification is purely typecheck + build +
manual smoke — see the Test plan section.

## Scope

**In scope** (the only file you should modify):

- `app/properties/[id]/page.tsx`

**Out of scope** (do NOT touch, even though they look related):

- `app/properties/[id]/PropertyHero.tsx` — consumer of the `docs` array;
  contract stays the same.
- Any Supabase migration — no schema change.
- Any other page's storage-signing pattern — one fix at a time; a later plan
  can extract a shared helper if the pattern repeats.

## Git workflow

- Branch: `advisor/001-parallel-signed-urls`
- Commit style: match `git log` — imperative subject in Title Case, no prefix
  (see `git log --oneline -10` — recent examples: `Property Record: photo primary, map as pivot pill`).
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Replace the serial `for` loop with dedup-then-parallelise

Rewrite lines 171-206 so that:

1. First pass over `docLinks` collects the deduplicated document rows (each with
   the source `docLink` and target metadata) into a plain array — this is O(n),
   synchronous, no I/O.
2. Second pass uses `Promise.all` to fetch signed URLs for all rows that have a
   `storage_bucket` + `storage_path`. Each promise resolves to `{ url, error }`.
3. Third pass builds the final `docs: DocRow[]` in the same order, logging any
   errors with the existing `console.error` message shape.

Target shape:

```tsx
const docs: DocRow[] = [];
const seenIds = new Set<string>();

// Pass 1: dedupe. Keep the original document + docLink pair for pass 3.
const staged: { d: NonNullable<typeof docLinks[number]["document"]>; dl: typeof docLinks[number] }[] = [];
for (const dl of docLinks) {
  const d = dl.document;
  if (!d) continue;
  const dedupeKey = `${d.id}::${dl.entity_id}`;
  if (seenIds.has(dedupeKey)) continue;
  seenIds.add(dedupeKey);
  staged.push({ d, dl });
}

// Pass 2: parallel sign. Preserve input order via array index.
const signed = await Promise.all(
  staged.map(({ d }) =>
    d.storage_bucket && d.storage_path
      ? supabase.storage.from(d.storage_bucket).createSignedUrl(d.storage_path, 3600)
      : Promise.resolve({ data: null, error: null }),
  ),
);

// Pass 3: build the DocRow array in the original order.
for (let i = 0; i < staged.length; i++) {
  const { d, dl } = staged[i];
  const { data, error: signErr } = signed[i];
  if (signErr) {
    console.error(`[property] signed URL failed for doc ${d.id} (${d.title}):`, signErr.message);
  }
  const isImage = d.doc_type?.code === "photo";
  docs.push({
    transfer_id: dl.entity_id,
    id: d.id,
    title: d.title,
    label: d.doc_type?.label ?? null,
    code: d.doc_type?.code ?? null,
    category: d.doc_type?.category ?? "other",
    mime_type: d.mime_type ?? null,
    is_pii: d.is_pii,
    url: data?.signedUrl ?? null,
    isImage,
  });
}
```

Notes on the type annotation on `staged`: `docLinks` is typed as `any[]` on
this page (line 158) because the whole file has `/* eslint-disable
@typescript-eslint/no-explicit-any */` at the top. Follow the existing
convention — do not introduce stricter typing here. If TypeScript complains
about the `NonNullable<...>["document"]` type, simplify to
`staged: { d: any; dl: any }[] = [];` to stay consistent with surrounding code.

**Verify**:
- `npm run typecheck` → exit 0
- `npm run lint` → exit 0
- `grep -n "await supabase.storage.from" app/properties/\[id\]/page.tsx` → **no matches inside the for-loop body** (the `await` is now on `Promise.all`, not per-iteration).

### Step 2: Build and manually smoke-check

**Verify**:
- `npm run build` → "Compiled successfully". A prerender error on `/login`
  saying "@supabase/ssr: Your project's URL and API key are required" is
  expected in local dev without `.env.local` and does NOT indicate a real
  problem — Vercel builds with env vars set. Any OTHER build error is a
  STOP condition.
- If Simon has a running dev server with data, spot-check a property record
  with multiple documents (15 Eagles Way is a good candidate — has 3 listings
  + 2 correspondence). Confirm all document chips render with working links.
  This is best-effort; if local env isn't reachable, note that in the commit
  and rely on Simon's post-deploy check.

### Step 3: Commit and update the plan index

Commit message:

```
Property Record: parallelise signed-URL generation

Every load of /properties/[id] serially awaited one createSignedUrl
call per attached document. For a 20-doc deal that's ~3-6s of blocking.
Rewrite as dedupe → Promise.all → build-in-order so all signing runs
concurrently.

Behaviour unchanged: same dedup key, same order, same error logging,
same null-safe handling of documents without storage paths.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Update `plans/README.md`: change the status of row 001 from `TODO` to `DONE`.

## Test plan

There is no automated test suite in this repo. Verification is:

1. `npm run typecheck` passes — proves the type contract to downstream
   consumers (`docsFor`, `groupedDocsFor`) is preserved.
2. `npm run build` compiles — proves no runtime import errors.
3. Manual smoke on one property with ≥5 documents post-deploy — confirms
   ordering and error paths hold.

A follow-up plan (see `plans/README.md` "Findings considered and rejected")
will establish a `vitest` baseline; if that lands first, add a unit test
for this file's dedup + parallel-sign logic mirroring its `docs/README.md`
test patterns once those exist. Not blocking here.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0 (accept `/login` prerender warning about Supabase env — see Step 2)
- [ ] `grep -c "await supabase.storage.from" app/properties/\[id\]/page.tsx` returns `0` (the only remaining `.storage.from(...)` call is inside `.map()`, unawaited)
- [ ] `git diff --stat` shows exactly one file changed: `app/properties/[id]/page.tsx`
- [ ] `plans/README.md` status row for 001 is `DONE`

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `app/properties/[id]/page.tsx:171-206` doesn't match the
  "Current state" excerpt (the file has been refactored since this plan
  was written).
- Typecheck complains about a type mismatch you can't resolve within the
  existing `any`-tolerant convention of the file. Do NOT introduce stricter
  typing unilaterally.
- `npm run build` fails with an error other than the expected `/login`
  prerender warning about missing Supabase env.
- You discover the dedup key semantics changed elsewhere (e.g. `docsFor`
  now sorts) — the fix might need to preserve a different ordering.

## Maintenance notes

For the reviewer of this PR and future maintainers:

- Reviewer should confirm the `staged` array's iteration order matches
  `docLinks` order (which is what `docsFor(tid)` implicitly relies on).
- If a future change adds a per-document permission check (e.g. FICA-scoped
  RLS), that check would need to happen alongside signing — the same
  parallelisation pattern still applies, but the mapper in pass 3 will need
  to skip rows where the permission fails.
- If the number of documents per property grows past ~50, revisit whether
  `Promise.all` on that many concurrent Supabase Storage calls hits any rate
  limits. Today's cap of "well-documented deal has 15-20 docs" makes this
  safe.
- Follow-up rejected during this plan: introducing a shared signed-URL
  helper. Deferred until a second page shows the same pattern.
