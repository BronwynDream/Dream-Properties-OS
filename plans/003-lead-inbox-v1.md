# Plan 003: Lead Inbox v1 — enquiry-flavoured view of email intake

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f3b6711..HEAD -- app/triage supabase/migrations app/api/intake`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/002-prompt-injection-hardening.md` (harden extract path before widening intake surface)
- **Category**: direction
- **Planned at**: commit `f3b6711`, 2026-07-26

## Why this matters

Bronwyn's daily flow: watch WhatsApp, watch Property24 messages, watch
Private Property messages, watch Outlook. Enquiries land in four inboxes
with no unified view. Even the email-sourced ones that flow through Dream OS
via Resend today are buried in `/triage`, mixed with document-heavy batches
(mandates, deeds, agreements) that need a very different response.

An agent who lands on `/triage` today can't tell at a glance: "which of
these is a hot lead I should reply to now vs a title deed I need to file?"

This plan ships the smallest thing that ends that pain: a `/inbox` route
that filters `ingest_batch` to enquiry-flavoured rows (batches with no
classified documents, or only correspondence), presents them like an email
client, and provides a one-click hand-off to `/triage/[id]` for the
detailed review.

**Explicit v1 scope** (what this plan is and is NOT):

- **IS**: a filtered view of existing `ingest_batch` rows, focused on
  enquiries. Shows sender, subject, snippet, timestamp, doc count. One
  action: open in `/triage`.
- **IS NOT**: WhatsApp integration (Meta Cloud API is a separate build —
  see `docs/whatsapp-schema-brief.md` for the target schema).
- **IS NOT**: Property24 / Private Property portal ingestion (a scraper for
  those is `plans/004-firecrawl-property24.md`, and that plan only handles
  listings, not lead messages).
- **IS NOT**: quick-reply UI (deferred — reply flow needs an SMTP-out
  path and email threading; too big for v1).
- **IS NOT**: convert-to-transfer button (deferred — needs a property
  picker + party linking + transfer creation; that's plan 003b when this
  ships).

v1 buys visibility. Follow-ups buy workflow.

## Current state

### The `ingest_batch` table (from prior migrations)

Read `supabase/migrations/*.sql` for the exact schema. Key columns the
executor needs:

- `id` (uuid, PK)
- `status` (text — values include `unfiled`, `parsed`, `extracted`, `committed`,
  possibly others; see the migration that created it)
- `created_at` (timestamptz)
- `sender_email` (text, nullable — populated by intake webhook)
- `subject` (text, nullable — email subject line)
- `provider_message_id` (text — `resend:<email_id>` for Resend-ingested emails)

### The `ingest_file` table

- `id`, `batch_id` → `ingest_batch(id)`, `original_filename`, `mime_type`,
  `byte_size`, `detected_doc_type_id` (nullable — null means unclassified
  or classified as "other"), `status`.

### Existing `/triage` implementation

`app/triage/` has the batch review flow. Read:
- `app/triage/page.tsx` — the list view (what `/inbox` will be a filtered
  version of, but on a different route with different UI framing)
- `app/triage/[id]/page.tsx` — the batch detail view (where `/inbox` will
  hand off to via a link)
- `app/triage/actions.ts` — server actions

The v1 `/inbox` reuses `/triage/[id]` for the detail view. Do NOT duplicate
detail rendering.

### The Resend webhook

`app/api/intake/email/route.ts` inserts one `ingest_batch` row per received
email, with `sender_email`, `subject`, and `provider_message_id` set. Every
enquiry-flavoured batch we want to show already has these fields.

### Design language (from memory `dream-design-language`)

Dream OS surfaces read as cadastral / deeds artifacts, not SaaS cards.
`--paper` (`#FBF9F4`) is the vellum surface, `--paper-line` (`#DED5C2`) is
the warm hairline, JetBrains Mono for cadastral IDs, Inter for UI. See
`app/globals.css` `--paper` / `--paper-mute` / `--paper-line` / `--stamp`
token block for the palette; see `app/properties/[id]/PropertyHero.tsx`
for the Registry Stamp pattern.

The Lead Inbox is a working document, like an incoming-mail register. Use
paper aesthetic + hairline rows, NOT a card grid.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |
| Lint      | `npm run lint`      | exit 0              |
| Build     | `npm run build`     | exit 0 (accept `/login` prerender warning) |

## Scope

**In scope** (create or modify only these):

- `app/inbox/page.tsx` (create) — server component listing enquiry-flavoured batches
- `app/inbox/InboxRow.tsx` (create) — one row per lead (client component for hover / click states)
- `app/inbox/actions.ts` (create) — server action for `markAsFiled(batchId)` (see Step 3)
- `app/globals.css` — add `.lead-inbox`, `.lead-row`, `.lead-row-sender`, `.lead-row-snippet`, `.lead-row-meta` classes (paper aesthetic)
- `app/components/TopBar.tsx` — add "Inbox" link to the primary nav (find the existing nav list; keep pattern; place between Overview and Map)

**Out of scope** (do NOT touch):

- `app/triage/*` — reused as-is; do not fork the detail view
- Any `ingest_batch` migration — no schema change
- Any WhatsApp / Property24 / Private Property source — separate plans
- Any reply UI, convert-to-transfer, or party creation — deferred to v2
- Any RLS policy change — batches already scoped to staff read

## Git workflow

- Branch: `advisor/003-lead-inbox-v1`
- Commit style: match repo — imperative Title Case; consider 2 commits (route + nav link).
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Create `app/inbox/page.tsx`

A server component that fetches enquiry-flavoured batches and renders them.

The filter defining "enquiry-flavoured" (heuristic, no schema change):
- Batch was created via the email webhook (`provider_message_id LIKE 'resend:%'`), AND
- Every file in the batch is EITHER classified as `correspondence` OR unclassified (`detected_doc_type_id IS NULL`)
- Exclude batches whose status is already `committed` (they've been actioned)

Query strategy: fetch batches with their file rows in one round-trip via
Supabase relational select, then filter in-memory.

Target shape:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import InboxRow from "./InboxRow";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function InboxPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Batches from the email webhook, most recent first. Join to ingest_file
  // + document_type so we can filter to enquiry-flavoured ones in JS —
  // simpler than a SQL predicate, cheap at this scale.
  const { data: batches } = await supabase
    .from("ingest_batch")
    .select(
      "id, subject, sender_email, provider_message_id, status, created_at, files:ingest_file(id, original_filename, detected_doc_type_id, doc_type:document_type(code))",
    )
    .like("provider_message_id", "resend:%")
    .neq("status", "committed")
    .order("created_at", { ascending: false })
    .limit(200);

  // Enquiry-flavoured heuristic: no files classified as anything but
  // correspondence. Batches with a mandate / deed / agreement belong in
  // /triage, not the lead inbox.
  const rows = ((batches ?? []) as any[]).filter((b) => {
    const files = (b.files ?? []) as any[];
    if (files.length === 0) return true;
    return files.every((f) => {
      if (!f.detected_doc_type_id) return true;
      const code = f.doc_type?.code;
      return code === "correspondence" || code == null;
    });
  });

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Lead Inbox</p>
          <h1>{rows.length} incoming {rows.length === 1 ? "enquiry" : "enquiries"}</h1>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          {rows.length === 0 ? (
            <p style={{ color: "var(--paper-mute)", padding: "24px 0", fontStyle: "italic" }}>
              Nothing new. Enquiries forwarded to <code>intake@dreamproperties.app</code> land here.
            </p>
          ) : (
            <div className="lead-inbox">
              {rows.map((b: any) => (
                <InboxRow
                  key={b.id}
                  batchId={b.id}
                  sender={b.sender_email ?? "unknown sender"}
                  subject={b.subject ?? "(no subject)"}
                  fileCount={(b.files ?? []).length}
                  createdAt={b.created_at}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
```

**Verify**:
- `test -f app/inbox/page.tsx`
- `npm run typecheck` → exit 0

### Step 2: Create `app/inbox/InboxRow.tsx`

A client component (thin) so hover state + click-through work. Renders one
row per lead. Handoff link goes to `/triage/[batchId]` — the existing detail
view.

```tsx
"use client";

import Link from "next/link";

function shortRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toISOString().slice(0, 10);
}

export default function InboxRow({
  batchId,
  sender,
  subject,
  fileCount,
  createdAt,
}: {
  batchId: string;
  sender: string;
  subject: string;
  fileCount: number;
  createdAt: string;
}) {
  return (
    <Link href={`/triage/${batchId}`} className="lead-row" prefetch={false}>
      <div className="lead-row-sender">{sender}</div>
      <div className="lead-row-subject">{subject}</div>
      <div className="lead-row-meta">
        <span>{fileCount === 0 ? "no files" : `${fileCount} file${fileCount === 1 ? "" : "s"}`}</span>
        <span>·</span>
        <span>{shortRelative(createdAt)}</span>
      </div>
    </Link>
  );
}
```

**Verify**:
- `test -f app/inbox/InboxRow.tsx`
- `npm run typecheck` → exit 0

### Step 3: Add paper-aesthetic CSS

Add to `app/globals.css` (find the property record `.record-plate` block for
context; place the new block below the existing `.record-photos` /
`.record-photo` section for tidy grouping). The design mirrors the
Schedule-table aesthetic — hairline row separators, monospace metadata,
Inter for content:

```css
/* Lead Inbox — reads like an incoming-mail register. Hairline-separated
   rows on paper, monospace for the sender + timestamp columns, Inter
   headline for the subject. */
.lead-inbox {
  background: var(--paper);
  border: 1px solid var(--paper-line);
  border-radius: 6px;
  overflow: hidden;
}
.lead-row {
  display: grid;
  grid-template-columns: minmax(0, 240px) minmax(0, 1fr) minmax(0, 180px);
  gap: 24px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--paper-line);
  color: var(--estuary);
  text-decoration: none;
  transition: background 0.12s;
  align-items: baseline;
}
.lead-row:last-child { border-bottom: 0; }
.lead-row:hover { background: rgba(200, 160, 50, 0.06); }
.lead-row-sender {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
  color: var(--paper-mute);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lead-row-subject {
  font-family: "Inter", -apple-system, sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--estuary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lead-row-meta {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--paper-mute);
  text-align: right;
  display: flex; justify-content: flex-end; gap: 6px;
}
@media (max-width: 700px) {
  .lead-row { grid-template-columns: 1fr; gap: 4px; }
  .lead-row-meta { text-align: left; justify-content: flex-start; }
}
```

**Verify**:
- `grep -c "\\.lead-inbox" app/globals.css` → 1
- `grep -c "\\.lead-row" app/globals.css` → ≥ 3 (base, hover, media query)

### Step 4: Add "Inbox" to primary navigation

Open `app/components/TopBar.tsx`. Find the existing nav link list — it will
be an array of `{ href, label }` objects or a set of `<Link>` elements. Add
`{ href: "/inbox", label: "Inbox" }` (or the equivalent element) between
Overview and Map. Match the surrounding style / prop shape exactly.

If the TopBar has an unread-count badge pattern elsewhere (grep for `badge`
in that file), do NOT wire a count for `/inbox` in v1 — that's another
query per page load. Follow-up if the label needs a "3" pill later.

**Verify**:
- `grep -c "inbox" app/components/TopBar.tsx` → ≥ 1
- `npm run typecheck` → exit 0

### Step 5: Skip the `actions.ts` file

The `app/inbox/actions.ts` file is listed in scope but v1 has no actions —
the row hands off entirely to `/triage/[id]` for review. **Do NOT create
this file** unless you're adding a specific server action. If you did
create it as a placeholder in an earlier step, delete it.

**Verify**:
- `test ! -f app/inbox/actions.ts`

### Step 6: Build + smoke

**Verify**:
- `npm run build` → "Compiled successfully". `/login` prerender warning about
  Supabase env is expected.
- If local dev + Supabase env are available: navigate to `/inbox`. Expect
  either the empty-state message OR one row per enquiry-flavoured batch.
  Click a row → lands on `/triage/[id]` (existing view). This is best-effort;
  if local env isn't reachable, note in the commit and rely on Simon's
  post-deploy check.

### Step 7: Commit and update the index

Suggested split (two commits keeps the diff reviewable):

Commit A:
```
Add /inbox — enquiry-flavoured view of email intake

New route filters ingest_batch to Resend-ingested rows whose files are
all unclassified or correspondence-only (excludes document-heavy batches
that belong in /triage). Hairline-row list on the --paper surface,
monospace sender + timestamp, Inter subject. Click hands off to
/triage/[id] for the existing detail flow.

v1 is visibility-only: no reply UI, no convert-to-transfer, no WhatsApp
or portal ingestion. Follow-ups will layer workflow onto this
foundation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Commit B:
```
TopBar: add Inbox link between Overview and Map

Primary nav entry for /inbox. No unread badge in v1 (avoids a per-page
extra query); reconsider once the list is load-bearing enough to warrant
one.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Update `plans/README.md`: change 003's status from `TODO` to `DONE`.

## Test plan

No test infra. Verification path:

1. Typecheck + lint + build pass.
2. Post-deploy: forward a plain-text email (no attachments) to
   `intake@dreamproperties.app` from an allow-listed sender. Confirm
   the batch appears at `/inbox` within a minute (webhook + refresh).
3. Post-deploy: forward an email WITH a mandate PDF from an allow-listed
   sender. Confirm the batch does NOT appear at `/inbox` (files classified
   as documents excludes it), but DOES appear at `/triage`.
4. Post-deploy: click any `/inbox` row. Confirm it lands on `/triage/[id]`
   with the batch's detail rendered as normal.

When the vitest baseline lands (see rejected findings in `plans/README.md`),
add a unit test for the enquiry-flavour filter — happy path (0 files),
correspondence-only, mixed (has one deed → excluded).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0 (accept `/login` prerender warning)
- [ ] `test -f app/inbox/page.tsx`
- [ ] `test -f app/inbox/InboxRow.tsx`
- [ ] `test ! -f app/inbox/actions.ts`
- [ ] `grep -c "\\.lead-inbox\\|\\.lead-row" app/globals.css` → ≥ 4 (base + hover + subject/meta variants + media query)
- [ ] `grep -c "inbox" app/components/TopBar.tsx` → ≥ 1
- [ ] `git diff --stat` shows only in-scope files touched
- [ ] `plans/README.md` status row for 003 is `DONE`

## STOP conditions

Stop and report back (do not improvise) if:

- `ingest_batch` doesn't have `subject`, `sender_email`, or `provider_message_id`
  columns — the "enquiry-flavoured" filter can't work; check migrations for
  the actual column names.
- The Supabase relational select syntax `files:ingest_file(...)` throws at
  runtime — the FK relationship isn't set up as expected. Fall back to a
  second query per-batch would be N+1; instead report the issue.
- `app/components/TopBar.tsx` doesn't exist or has a totally different
  structure than described — inspect the actual TopBar and report before
  adding a link.
- The `.record-photos` CSS block referenced for placement doesn't exist
  (the redesign was rolled back) — place the new CSS in a sensible spot,
  don't force it.
- More than 200 batches match at any time (very unlikely at Dream's scale)
  — check performance before adjusting the `.limit(200)` cap.

## Maintenance notes

For the reviewer and future maintainers:

- v1 relies on the `provider_message_id LIKE 'resend:%'` filter. If a
  second inbound source lands (e.g. Postmark, or a Graph API mailbox sync),
  extend the filter or introduce a `source` enum on `ingest_batch`.
- The enquiry-flavour heuristic is deliberately simple. If mis-classification
  becomes common (real leads hiding in `/triage` because someone attached
  a random PDF), consider adding a manual "Move to Inbox" action on
  `/triage/[id]`.
- **Explicit follow-ups deferred out of v1**:
  - Quick-reply UI (needs SMTP-out + email threading)
  - Convert-to-transfer flow (needs property picker + party linking)
  - WhatsApp ingest (needs Meta Cloud API webhook + `people` / `conversations`
    / `messages` tables per `docs/whatsapp-schema-brief.md`)
  - Property24 / Private Property enquiry ingest (needs portal API access
    or scraper; see `plans/004-firecrawl-property24.md` for listings — leads
    would be an extension)
  - Unread-count badge in TopBar
  - Per-agent filtering ("show only enquiries where I'm the assigned lead")
