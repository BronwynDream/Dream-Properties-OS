# Plan 006: Contact CRM — party search + role-timeline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> If anything in the "STOP conditions" section occurs, stop and report —
> do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat ef4017e..HEAD -- supabase/migrations app/contacts app/components/TopBarClient.tsx app/globals.css`
> If any of those paths changed since this plan was written, compare the
> "Current state" excerpts against live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (party schema exists from 0002; RLS from 0005)
- **Category**: direction
- **Planned at**: commit `ef4017e`, 2026-07-27

## Why this matters

Party schema is rich (name, ID, email, phone, entity_name, registration_no,
member relationships, matrimonial regime) but the app has no way to surface
parties directly — only via transfer records. Bronwyn holds "Shelley bought
2 properties from us since 2018" in her head; an agent looking Shelley up
by name today has no route. Repeat-buyer and cross-sell workflows are
blocked.

This plan ships **/contacts** — search parties by any field, click through
to a role-timeline showing every deal that party was on (Seller 2024 → Buyer
2026 etc.). Mirrors the property-record vernacular: paper surface, hairline
rows, monospace IDs. POPIA: ID numbers masked by default.

## Current state

### Party schema (from `supabase/migrations/0002_core.sql:79-108`)

```sql
create table party (
  id                 uuid primary key,
  party_type         party_type not null default 'individual',
  display_name       text not null,          -- always populated
  first_names        text,
  surname            text,
  id_number          text,                   -- SA ID (13 digits)
  passport_no        text,
  entity_name        text,                   -- juristic
  registration_no    text,
  email              citext,
  phone              text,
  whatsapp           text,
  postal_address     text,
  ...
);
```

Relationships:
- `transfer_party (transfer_id, party_id, side, is_primary)` — links parties to transfers
- `party_member (entity_party_id, member_party_id, role, share_pct)` — directors/members/trustees of a juristic party
- `transfer (id, name, status, transfer_date, registered_date, lead_agent_user_id, property_id)`
- `property (id, primary_address)`
- `agreement (transfer_id, price, deposit, transfer_date)` — for price on the timeline

### Existing RLS

`supabase/migrations/0005_rls.sql` sets up the party RLS. Read it (specifically
policies on `party` and `transfer_party`). Typical pattern:
- Admin (`is_admin()`) reads all
- Agent reads parties linked to transfers where they are `lead_agent_user_id`
- No client access here (parties are internal)

**If the existing party RLS doesn't already allow this search flow for the
admin session, the plan works. If it blocks staff reads on party rows,
STOP and report — we may need a migration to widen read policy.**

### Design language

From memory `dream-design-language` (Dream OS pages read as cadastral / deeds
artifacts, not SaaS cards). Reuse tokens from `app/globals.css`:
- `--paper #FBF9F4` — surface
- `--paper-line #DED5C2` — hairline borders
- `--paper-mute #6B7A8C` — eyebrow labels
- `--estuary #0d3a52` — primary text
- JetBrains Mono for numeric IDs (SA ID, registration_no)
- Inter for content/UI

Match the Lead Inbox pattern (`app/inbox/page.tsx`, `app/inbox/InboxRow.tsx`) —
hairline-row list on paper surface with monospace metadata columns.

### Existing TopBar nav

`app/components/TopBarClient.tsx` — nav is a `TABS` array of `{ href, label }`
objects. Current entries: Overview, Inbox, Map, Properties, Triage, Dupes,
Team. Add `{ href: "/contacts", label: "Contacts" }` between Properties and
Triage.

## Repo conventions to honor

- Migrations: `NNNN_short.sql` idempotent; header comment. Next is `0046`.
- Server components use `createClient()` from `@/lib/supabase/server`.
- Any file-level `/* eslint-disable @typescript-eslint/no-explicit-any */`
  should be preserved and used sparingly — match surrounding conventions.
- No test suite; verification is `npm run typecheck` + `npm run build`.
  Skip `npm run lint` (no ESLint config; interactive prompt).

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run typecheck` | exit 0              |
| Build     | `npm run build`     | exit 0 (accept `/login` prerender warning) |
| Migration | Apply via Supabase Studio (Simon does)             | SQL runs cleanly |

## Scope

**In scope**:

- `supabase/migrations/0046_party_search_indexes.sql` (create) — trigram indexes
- `app/contacts/page.tsx` (create) — list + search
- `app/contacts/ContactRow.tsx` (create) — client row component
- `app/contacts/SearchInput.tsx` (create) — client search bar with URL sync
- `app/contacts/[id]/page.tsx` (create) — party detail with role timeline
- `app/contacts/MaskedId.tsx` (create) — client component for ID reveal
- `app/globals.css` — add `.contacts-list`, `.contact-row`, `.contact-detail`, `.role-timeline` classes
- `app/components/TopBarClient.tsx` — add "Contacts" nav entry

**Out of scope**:

- POPIA audit log for ID reveals (v2 concern — v1 just masks)
- Contact editing (v2 — form flow)
- Notes / activity log on the contact
- Merging duplicate parties (`/dupes` handles property dupes; party dupes are a
  separate task)
- WhatsApp / email inbox integration (plan 003b territory)
- `party_member` deep display (v1 shows count only if entity)

## Git workflow

- Branch: `advisor/006-contact-crm`
- Commit style: imperative Title Case, matching repo. Suggested 2 commits:
  (1) migration + list route, (2) detail route + nav link.

## Steps

### Step 1: Migration 0046 — trigram indexes for search

Create `supabase/migrations/0046_party_search_indexes.sql`:

```sql
-- ============================================================================
-- Dream Knysna OS — 0046 party search indexes
-- ----------------------------------------------------------------------------
-- The Contact CRM (/contacts) needs fast fuzzy search across party name,
-- email, phone, id_number. pg_trgm is already installed (used by muni_property
-- + property matcher). Add gin_trgm indexes to the party fields we search.
--
-- Idempotent: `create index if not exists`. Safe to re-apply.
-- ============================================================================

create extension if not exists pg_trgm;

create index if not exists idx_party_display_name_trgm
  on party using gin (display_name gin_trgm_ops);

create index if not exists idx_party_entity_name_trgm
  on party using gin (entity_name gin_trgm_ops)
  where entity_name is not null;

create index if not exists idx_party_id_number
  on party (id_number)
  where id_number is not null;

create index if not exists idx_party_email
  on party (email)
  where email is not null;

create index if not exists idx_party_phone
  on party (phone)
  where phone is not null;
```

**Verify**:
- `test -f supabase/migrations/0046_party_search_indexes.sql`
- `head -3 supabase/migrations/0046_party_search_indexes.sql` shows header

**Apply**: Simon runs this in Studio. Do NOT attempt any CLI apply.

### Step 2: `app/contacts/MaskedId.tsx` — POPIA-safe ID display

Client component. Renders `760615*******` by default; on click, reveals full
value. No audit log in v1 (add later if the compliance conversation calls
for it).

```tsx
"use client";

import { useState } from "react";

// SA ID = 13 digits. Passport = variable. Mask keeps first 6 chars
// (YYMMDD birth prefix on SA IDs is useful context) + hides the rest.
export default function MaskedId({ value }: { value: string | null | undefined }) {
  const [revealed, setRevealed] = useState(false);
  if (!value) return <span style={{ color: "var(--paper-mute)" }}>—</span>;
  const shown = revealed ? value : `${value.slice(0, 6)}${"•".repeat(Math.max(0, value.length - 6))}`;
  return (
    <button
      type="button"
      onClick={() => setRevealed((v) => !v)}
      title={revealed ? "Hide ID" : "Click to reveal ID"}
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 12.5,
        letterSpacing: "0.02em",
        background: "transparent",
        border: 0,
        padding: 0,
        color: "var(--estuary)",
        cursor: "pointer",
      }}
    >
      {shown}
    </button>
  );
}
```

**Verify**:
- `test -f app/contacts/MaskedId.tsx`
- `npm run typecheck` → exit 0

### Step 3: `app/contacts/SearchInput.tsx` — search-as-you-type with URL sync

Client component. Reads `q` from URL, updates URL on input (debounced ~250ms).
Server component re-renders with new results because `q` is a `searchParams`
prop.

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SearchInput() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      router.replace(`/contacts?${next.toString()}`);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Search name, email, phone, ID…"
      autoFocus
      style={{
        width: "100%",
        padding: "12px 16px",
        fontSize: 14,
        fontFamily: "Inter, sans-serif",
        border: "1px solid var(--paper-line)",
        borderRadius: 6,
        background: "var(--paper)",
        color: "var(--estuary)",
        outline: "none",
      }}
    />
  );
}
```

**Verify**:
- `test -f app/contacts/SearchInput.tsx`

### Step 4: `app/contacts/page.tsx` — list view + search

Server component. Reads `q` searchParam, queries `party` with OR across name,
email, phone, id_number. Includes a role-count summary via a join to
`transfer_party` (aggregated in JS to keep the query simple).

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import SearchInput from "./SearchInput";
import ContactRow from "./ContactRow";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Search = { q?: string };

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const q = (searchParams.q ?? "").trim();

  // Only query when there's a search term. Avoids listing the whole party
  // table (could be hundreds of rows) on first landing.
  let parties: any[] = [];
  if (q.length >= 2) {
    // Multi-field OR. ilike is fine at Dream's scale (~hundreds of parties);
    // the gin_trgm indexes from migration 0046 support fuzzy matching.
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const { data } = await supabase
      .from("party")
      .select(
        "id, party_type, display_name, entity_name, id_number, email, phone, whatsapp",
      )
      .or(
        `display_name.ilike.${like},entity_name.ilike.${like},email.ilike.${like},phone.ilike.${like},id_number.ilike.${like}`,
      )
      .order("display_name", { ascending: true })
      .limit(100);
    parties = data ?? [];
  }

  // Fetch role summaries for the returned party ids in a single round-trip.
  const partyIds = parties.map((p) => p.id);
  const summaries = new Map<string, { side: string; year: string | null }[]>();
  if (partyIds.length > 0) {
    const { data: tps } = await supabase
      .from("transfer_party")
      .select("party_id, side, transfer:transfer_id(transfer_date, registered_date)")
      .in("party_id", partyIds);
    for (const tp of (tps ?? []) as any[]) {
      const dateStr =
        tp.transfer?.registered_date ??
        tp.transfer?.transfer_date ??
        null;
      const year = dateStr ? String(dateStr).slice(0, 4) : null;
      const arr = summaries.get(tp.party_id) ?? [];
      arr.push({ side: tp.side, year });
      summaries.set(tp.party_id, arr);
    }
  }

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Contacts</p>
          <h1>
            {q ? `${parties.length} match${parties.length === 1 ? "" : "es"} for "${q}"` : "Contact search"}
          </h1>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <div style={{ marginBottom: 24 }}>
            <SearchInput />
          </div>

          {q.length < 2 ? (
            <p style={{ color: "var(--paper-mute)", fontStyle: "italic", padding: "24px 0" }}>
              Type at least 2 characters to search. Try a surname, an ID number,
              an email, a company name, or a phone number.
            </p>
          ) : parties.length === 0 ? (
            <p style={{ color: "var(--paper-mute)", fontStyle: "italic", padding: "24px 0" }}>
              No parties matched. Check spelling, or try a different field
              (e.g. just the surname without initials).
            </p>
          ) : (
            <div className="contacts-list">
              {parties.map((p) => (
                <ContactRow
                  key={p.id}
                  id={p.id}
                  partyType={p.party_type}
                  displayName={p.display_name}
                  entityName={p.entity_name}
                  idNumber={p.id_number}
                  email={p.email}
                  phone={p.phone}
                  roles={summaries.get(p.id) ?? []}
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
- `test -f app/contacts/page.tsx`
- `npm run typecheck` → exit 0

### Step 5: `app/contacts/ContactRow.tsx` — a single row

Server component (no state — Link handles navigation). Renders one row in
the search results list. Format:

```
Name / entity            id ••••   email · phone           Seller 2024, Buyer 2026
```

Client version optional — server is fine here. Actually keep it server-side
to avoid a client bundle for a row that's just presentational + a Link.

```tsx
import Link from "next/link";
import MaskedId from "./MaskedId";

export default function ContactRow({
  id,
  partyType,
  displayName,
  entityName,
  idNumber,
  email,
  phone,
  roles,
}: {
  id: string;
  partyType: string;
  displayName: string;
  entityName: string | null;
  idNumber: string | null;
  email: string | null;
  phone: string | null;
  roles: { side: string; year: string | null }[];
}) {
  // Timeline summary: "Seller 2024, Buyer 2026, Seller 2018". Deduplicate
  // consecutive same-side same-year entries.
  const timelineLabel = (() => {
    if (roles.length === 0) return "No transfers yet";
    const sorted = [...roles].sort((a, b) => (a.year ?? "").localeCompare(b.year ?? ""));
    return sorted
      .map((r) => `${r.side === "purchaser" ? "Buyer" : r.side === "seller" ? "Seller" : "Other"}${r.year ? ` ${r.year}` : ""}`)
      .join(", ");
  })();

  return (
    <Link href={`/contacts/${id}`} className="contact-row" prefetch={false}>
      <div className="contact-row-name">
        <span style={{ fontWeight: 600 }}>{displayName}</span>
        {entityName && entityName !== displayName && (
          <span style={{ color: "var(--paper-mute)", marginLeft: 8, fontSize: 12 }}>
            · {entityName}
          </span>
        )}
        <span style={{ color: "var(--paper-mute)", marginLeft: 8, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {partyType.replace("_", " ")}
        </span>
      </div>
      <div className="contact-row-meta">
        {idNumber && <MaskedId value={idNumber} />}
        {email && <span title={email}>{email}</span>}
        {phone && <span>{phone}</span>}
      </div>
      <div className="contact-row-roles">{timelineLabel}</div>
    </Link>
  );
}
```

**Verify**:
- `test -f app/contacts/ContactRow.tsx`
- `npm run typecheck` → exit 0

### Step 6: `app/contacts/[id]/page.tsx` — detail with role timeline

Server component. Fetches the party + every transfer_party for that party +
associated transfer + property + agreement (for price). Renders detail on
the left (contact info) and role timeline on the right (transfer table).

Query strategy: one query for the party; second query for their transfer
history joining transfer + property + agreement.

```tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import MaskedId from "../MaskedId";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

function money(v: any): string {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `R ${n.toLocaleString("en-ZA")}` : "—";
}

export default async function ContactDetail({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: party } = await supabase
    .from("party")
    .select(
      "id, party_type, display_name, first_names, surname, entity_name, registration_no, id_number, passport_no, email, phone, whatsapp, postal_address, physical_address, matrimonial_regime, notes",
    )
    .eq("id", params.id)
    .single();
  if (!party) notFound();

  // Role timeline: every transfer_party for this party, with the transfer
  // + its property + the agreement price. Ordered newest first.
  const { data: rolesData } = await supabase
    .from("transfer_party")
    .select(
      "side, is_primary, transfer:transfer_id(id, name, status, transfer_date, registered_date, property:property_id(id, primary_address), agreement(price))",
    )
    .eq("party_id", params.id);
  const roles = ((rolesData ?? []) as any[]).sort((a, b) => {
    const ay = a.transfer?.registered_date ?? a.transfer?.transfer_date ?? "";
    const by = b.transfer?.registered_date ?? b.transfer?.transfer_date ?? "";
    return by.localeCompare(ay); // newest first
  });

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head record-head">
          <div className="record-head-title">
            <p className="eyebrow">Dream Knysna · Contact</p>
            <h1>{party.display_name}</h1>
          </div>
          <div className="record-head-status">
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.72)",
              }}
            >
              {party.party_type.replace("_", " ")}
            </span>
          </div>
        </header>
        <hr className="tideline" />

        <section className="app-body property-record-body">
          <div className="contact-detail">
            {/* Left: identity + contact info */}
            <div className="contact-info">
              <p className="col-title">Identity</p>
              <dl className="contact-dl">
                {party.entity_name && (
                  <>
                    <dt>Entity name</dt>
                    <dd>{party.entity_name}</dd>
                  </>
                )}
                {party.registration_no && (
                  <>
                    <dt>Registration</dt>
                    <dd className="mono">{party.registration_no}</dd>
                  </>
                )}
                {party.id_number && (
                  <>
                    <dt>SA ID</dt>
                    <dd><MaskedId value={party.id_number} /></dd>
                  </>
                )}
                {party.passport_no && (
                  <>
                    <dt>Passport</dt>
                    <dd className="mono">{party.passport_no}</dd>
                  </>
                )}
                {party.matrimonial_regime && party.matrimonial_regime !== "unknown" && (
                  <>
                    <dt>Marital</dt>
                    <dd>{party.matrimonial_regime.replace(/_/g, " ")}</dd>
                  </>
                )}
              </dl>

              <p className="col-title" style={{ marginTop: 24 }}>Channels</p>
              <dl className="contact-dl">
                {party.email && (
                  <>
                    <dt>Email</dt>
                    <dd><a href={`mailto:${party.email}`}>{party.email}</a></dd>
                  </>
                )}
                {party.phone && (
                  <>
                    <dt>Phone</dt>
                    <dd className="mono">{party.phone}</dd>
                  </>
                )}
                {party.whatsapp && (
                  <>
                    <dt>WhatsApp</dt>
                    <dd className="mono">{party.whatsapp}</dd>
                  </>
                )}
              </dl>

              {(party.postal_address || party.physical_address) && (
                <>
                  <p className="col-title" style={{ marginTop: 24 }}>Address</p>
                  <dl className="contact-dl">
                    {party.postal_address && (
                      <>
                        <dt>Postal</dt>
                        <dd>{party.postal_address}</dd>
                      </>
                    )}
                    {party.physical_address && (
                      <>
                        <dt>Physical</dt>
                        <dd>{party.physical_address}</dd>
                      </>
                    )}
                  </dl>
                </>
              )}
            </div>

            {/* Right: role timeline */}
            <div className="role-timeline">
              <p className="col-title">Role timeline · {roles.length} {roles.length === 1 ? "transfer" : "transfers"}</p>
              {roles.length === 0 ? (
                <p style={{ color: "var(--paper-mute)", fontStyle: "italic", marginTop: 12 }}>
                  No transfer records for this party yet.
                </p>
              ) : (
                <table className="role-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Side</th>
                      <th>Property</th>
                      <th>Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roles.map((r: any) => {
                      const t = r.transfer;
                      const year = (t?.registered_date ?? t?.transfer_date ?? "").slice(0, 4) || "—";
                      const price = Array.isArray(t?.agreement) ? t.agreement[0]?.price : t?.agreement?.price;
                      const sideLabel = r.side === "purchaser" ? "Buyer" : r.side === "seller" ? "Seller" : "Other";
                      return (
                        <tr key={t?.id ?? Math.random()}>
                          <td className="mono">{year}</td>
                          <td>{sideLabel}{r.is_primary && " ★"}</td>
                          <td>
                            {t?.property?.id ? (
                              <Link href={`/properties/${t.property.id}`}>{t.property.primary_address}</Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="mono" style={{ textAlign: "right" }}>{money(price)}</td>
                          <td style={{ color: "var(--paper-mute)", fontSize: 12 }}>{t?.status ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {party.notes && (
                <>
                  <p className="col-title" style={{ marginTop: 24 }}>Notes</p>
                  <p style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5 }}>{party.notes}</p>
                </>
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
```

**Verify**:
- `test -f app/contacts/[id]/page.tsx`
- `npm run typecheck` → exit 0

### Step 7: Add CSS for contacts list + detail

Append to `app/globals.css`. Style mirrors the Lead Inbox's paper-hairline
aesthetic. Place below the existing `.lead-row` block for grouping:

```css
/* Contacts — cadastral index card feel. Same paper + hairline treatment
   as the Lead Inbox, tighter typography since ID + phone are the anchors. */
.contacts-list {
  background: var(--paper);
  border: 1px solid var(--paper-line);
  border-radius: 6px;
  overflow: hidden;
}
.contact-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 320px) minmax(0, 220px);
  gap: 20px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--paper-line);
  color: var(--estuary);
  text-decoration: none;
  transition: background 0.12s;
  align-items: baseline;
}
.contact-row:last-child { border-bottom: 0; }
.contact-row:hover { background: rgba(200, 160, 50, 0.06); }
.contact-row-name {
  font-family: "Inter", -apple-system, sans-serif;
  font-size: 14px;
  color: var(--estuary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.contact-row-meta {
  font-family: "Inter", -apple-system, sans-serif;
  font-size: 12px;
  color: var(--paper-mute);
  display: flex; gap: 12px; flex-wrap: wrap;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.contact-row-roles {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--paper-mute);
  text-transform: uppercase;
  text-align: right;
}
@media (max-width: 900px) {
  .contact-row { grid-template-columns: 1fr; gap: 6px; }
  .contact-row-roles { text-align: left; }
}

/* Contact detail — two column: identity left, role timeline right */
.contact-detail {
  display: grid;
  grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
  gap: 32px;
  background: var(--paper);
  border: 1px solid var(--paper-line);
  border-radius: 6px;
  padding: 28px 32px;
  margin-top: 16px;
}
@media (max-width: 900px) {
  .contact-detail { grid-template-columns: 1fr; gap: 24px; }
}
.contact-dl {
  margin: 8px 0 0;
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 6px 14px;
  font-size: 13px;
}
.contact-dl dt {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--paper-mute);
  font-weight: 600;
  padding-top: 2px;
}
.contact-dl dd { margin: 0; color: var(--estuary); }
.contact-dl dd.mono, .contact-dl .mono {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12.5px;
}

.role-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
}
.role-table th {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--paper-mute);
  font-weight: 600;
  text-align: left;
  padding: 8px 10px 8px 0;
  border-bottom: 1px solid var(--paper-line);
}
.role-table td {
  padding: 10px 10px 10px 0;
  border-bottom: 1px solid var(--paper-line);
  font-size: 13px;
  color: var(--estuary);
  vertical-align: baseline;
}
.role-table tr:last-child td { border-bottom: 0; }
.role-table td a { color: var(--estuary); text-decoration: underline; text-decoration-color: var(--paper-line); }
.role-table td a:hover { text-decoration-color: var(--gold); }
```

**Verify**:
- `grep -c "\\.contact-row\\|\\.contact-detail\\|\\.role-table" app/globals.css` → ≥ 5

### Step 8: TopBar nav entry

Open `app/components/TopBarClient.tsx`. Find the `TABS` array. Insert
`{ href: "/contacts", label: "Contacts" }` between the Properties and Triage
entries (or wherever preserves the existing left-to-right business flow).

**Verify**:
- `grep -c "/contacts" app/components/TopBarClient.tsx` → ≥ 1
- `npm run typecheck` → exit 0

### Step 9: Build + commit

**Verify**:
- `npm run build` → exit 0 (accept the `/login` prerender warning about
  missing Supabase env vars)

Two commits:

Commit A:
```
Contacts: migration 0046 party search indexes

pg_trgm indexes on party.display_name and party.entity_name for fast
fuzzy search. Btree indexes on id_number, email, phone for exact
lookups. Idempotent; safe to re-apply.

Migration 0046 must be applied manually via Supabase Studio before
/contacts search returns results at expected speed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Commit B:
```
Add /contacts — party search + role timeline

New route surfaces the party table directly for the first time.
Search across name, entity_name, email, phone, id_number in one input
(URL-synced, 250ms debounce). Results show name + party_type + masked
ID + email/phone + role summary ("Seller 2024, Buyer 2026").

Click through to /contacts/[id]:
  Left column  — Identity + Channels + Address (masked ID reveals on
                 click; no audit log in v1)
  Right column — Role timeline table (year, side, property link,
                 price, status)

Paper aesthetic, hairline rows, JetBrains Mono for IDs — matches the
Lead Inbox + Property Record vernacular. TopBar gets a "Contacts"
entry between Properties and Triage.

v1 out of scope: contact editing, notes CRUD, PII audit log,
party-merge / dedupe.

Depends on migration 0046 (party search indexes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0 (accept `/login` prerender warning)
- [ ] `test -f supabase/migrations/0046_party_search_indexes.sql`
- [ ] `test -f app/contacts/page.tsx`
- [ ] `test -f app/contacts/ContactRow.tsx`
- [ ] `test -f app/contacts/SearchInput.tsx`
- [ ] `test -f app/contacts/MaskedId.tsx`
- [ ] `test -f app/contacts/[id]/page.tsx`
- [ ] `grep -c "\\.contact-row\\|\\.contact-detail\\|\\.role-table" app/globals.css` → ≥ 5
- [ ] `grep -c "/contacts" app/components/TopBarClient.tsx` → ≥ 1
- [ ] `git diff --stat` shows only in-scope files touched
- [ ] `plans/README.md` status row for 006 is `DONE` (reviewer maintains)

## STOP conditions

Stop and report back if:

- Existing party RLS blocks staff-role reads of the party table entirely
  (i.e. current admin can't select from `party` in the app). Check
  `supabase/migrations/0005_rls.sql` for the party policy. If blocked,
  a widening migration is required — out of this plan's scope.
- `app/components/TopBarClient.tsx` doesn't have a `TABS` array pattern
  as described — inspect the actual file and report the shape.
- The `transfer_party.side` enum uses values other than `seller` / `purchaser`
  / `other` — check `supabase/migrations/*.sql` for the actual enum values
  and update the mapping in ContactRow + detail page accordingly.
- The Supabase relational select syntax
  `transfer:transfer_id(...property:property_id(...))` throws at runtime —
  the FK relationships must exist. If not, fallback would be N+1; report first.

## Maintenance notes

- POPIA audit log for ID reveals is deferred. When the compliance
  conversation calls for it, add a `pii_access_log` table and log every
  MaskedId reveal click (via a server action) with user_id + party_id +
  field + timestamp + IP.
- Search is single-input across all fields. If searches for common surnames
  return too many hits, split into a "type field" chip UI (Name / ID /
  Email / Phone) that scopes the OR down to one column.
- Party dedupe (merging duplicate party rows) is a whole separate flow —
  `/dupes` handles property dupes; parties need their own equivalent.
- Notes editing is deferred. When you add it, use a server action + inline
  textarea rather than a modal.
- The role timeline query joins agreement 1:1 — if a transfer has multiple
  agreements (renegotiation, amendments), only the first shows. Consider a
  `.order().limit(1)` on the nested agreement select if this becomes a
  data-quality issue.
