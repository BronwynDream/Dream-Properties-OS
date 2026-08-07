# Plan 008: Contact CRM v2 — agent contact books, interest matching, compliant outreach

> **Executor instructions**: Read this plan fully before starting. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> Update the status row in `plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat cdfadab..HEAD -- app/contacts lib/resend lib/notify.ts supabase/migrations`

## Status

- **Priority**: P1
- **Effort**: L (multi-session; slice 1 is M)
- **Risk**: HIGH — not technically, legally. Getting this wrong exposes Dream to
  a POPIA penalty of up to R10m or 10 years, and a CPA penalty of up to R1m or
  10% of annual turnover. The engineering is ordinary; the compliance is not.
- **Depends on**: 006 (Contact CRM v1 — party search + role timeline)
- **Category**: direction
- **Planned at**: commit `cdfadab`, 2026-08-06

## The ask

Simon, 2026-08-06: Angie Bevan has a contact base of ~100 people she wants
under one roof — phone numbers, emails. She must be able to group them by area
so that when she lists a property in, say, Simola, she can notify the people
who care about Simola.

## Why this is not just a table and a mail-merge

Two things make the naive version wrong.

**1. South African direct marketing law changed this year, and it is live now.**

- **POPIA s69** — electronic direct marketing requires opt-in consent, in the
  manner and form prescribed by Regulation 6 / Form 4. Two carve-outs matter:
  - **s69(3) soft opt-in** for *existing customers*: you may market your own
    similar products/services if the person had a reasonable opportunity to
    object **at the point of collection and in every subsequent message**.
  - **s69(2) one approach only**: you may approach a person **once** to
    request consent, and not again if they don't give it.
- **CPA Amendment Regulations, 2026** — published and in force **15 April
  2026**. Establishes a national **opt-out registry** run by the National
  Consumer Commission. Direct marketers must **register** (R2 574 initial,
  R1 930.50 annual renewal) and **cleanse their database against the registry
  monthly**. Messages must be identifiable as to sender.
- Where POPIA and the CPA overlap, **the more protective provision prevails**.

Dream is **not currently registered** with the NCC (confirmed with Simon,
2026-08-06). That registration is a hard gate before the first bulk send.

**2. Angie's list is two populations, not one** (confirmed with Simon):

| Population | Lawful basis | What the OS must do |
|---|---|---|
| Past Dream clients | s69(3) soft opt-in — existing customer | May market similar services. Every message carries an objection route. |
| Her personal network | None yet | **One** consent request each, ever. Then silence unless they consent. |

That second row is the design-shaping constraint. "One approach only" cannot
be a UI convention an agent might forget — it has to be a database guard.

## Design principles

**Consent is the schema, not a checkbox.** The `consent` table has existed
since `0004_docs.sql` and nothing has ever written to it. It becomes the spine:
every send resolves against it, and an Information Regulator complaint is
answered by querying it rather than by reconstructing what happened.

**Interests, not static groups.** Simon asked for groups by area. Static groups
go stale the moment someone's circumstances change, and they can't express "she
wants Simola *or* Pezula, R4–6m, freehold". Model what the agent actually
knows — a **`party_interest`**: area, price band, property type, buy/sell/watch
— and derive the group at send time. This gives Simon groups for free (a group
is just "everyone interested in Simola") and gets better answers than a list
would: when a Simola property lists at R5.2m, the OS can exclude the people
whose band tops out at R3m rather than mailing them anyway.

Free-form tags (`contact_tag`) cover everything that isn't geography or
money — "golf", "investor", "expat", "downsizing".

**Suppression is keyed to the contact point, not the person.** A `party` row
and an email address are not the same thing: the same address can sit on two
party rows after a bad merge. Opt-outs and NCC registry hits must suppress the
*address or number*, or someone who unsubscribed will get mailed again through
their duplicate.

**Reuse the triage pattern for import.** Drop → parse → dedupe → review →
commit is already the shape Bronwyn and the agents know from document intake,
and `propose_matches` (migration `0011`) already does fuzzy party matching. The
contact importer should feel like the same machine, not a new one.

## Schema — migration 0066

New:

- **`party.owner_user_id`** → `app_user`. The agent whose contact this is.
  Contacts are owned by the agent and visible to admin (Simon's call): matches
  the existing RLS baseline, and reflects that **Dream is the responsible party
  under POPIA** even where the agent built the relationship. An agent who
  cannot be overseen is an agent whose data Dream cannot lawfully control.
- **`contact_source`** enum — `past_client`, `show_house`, `referral`,
  `personal_network`, `website_enquiry`, `portal_lead`, `imported`, `unknown`.
  Recorded per party. Drives the default consent basis.
- **`party_interest`** — `party_id`, `interest_type` (buy/sell/rent/watch),
  `suburb_id`, `estate_id`, `price_min`, `price_max`, `property_type`, `notes`,
  `active`. Many per party.
- **`contact_tag`** + **`party_tag`** — free-form labels, agency-wide vocabulary.
- **`contact_point_suppression`** — `channel`, `value_normalised` (lowercased
  email / E.164 phone), `reason` (unsubscribed / bounced / complained /
  ncc_registry / manual), `source`, `created_at`. The send path checks this
  before it checks anything else.
- **`campaign`** + **`campaign_recipient`** — a send, the audience filter that
  produced it, template, and per-recipient state
  (queued/sent/delivered/bounced/opened/unsubscribed/suppressed) with the
  unsubscribe token.
- **`contact_import_batch`** + **`contact_import_row`** — staging for CSV/vCard
  import with a review step before anything lands in `party`.

Extended — `consent` gains the columns it needs to do real work:

- `channel` (email/sms/whatsapp/phone/post) — consent is per channel; the
  Regulator's guidance is explicit that consent for one channel does not
  transfer to another.
- `evidence` — how it was captured (form submission, signed mandate, show-house
  register, verbal noted by agent).
- `evidence_ref` — document id / form submission id / URL.
- `requested_at`, `request_count` — enforces s69(2). A partial unique index
  makes a second unsolicited consent request a database error, not a judgement
  call.
- `captured_by` → `app_user`.

## Slice 1 — get 100 contacts in, safely

1. Migration 0066.
2. **Contact import** — CSV/vCard upload → staging → fuzzy dedupe against
   existing parties via `propose_matches` → review screen where the agent sets
   source and consent basis **per batch or per row** → commit to `party` with
   `owner_user_id` set.
3. **`/contacts` rebuild** — list scoped to the signed-in agent (admins see
   all), filter by interest/area/tag, contact detail gains interests, tags,
   consent state and communication history.
4. **Interest capture** — add/edit interests on a contact; bulk-assign an
   interest to a selected set (this is Simon's "group them by area", done once
   at import).
5. **Consent request flow** — for `personal_network` contacts: a one-per-person
   request email carrying a Form 4-shaped consent capture page. The guard is in
   the database.

**Deliberately not in slice 1: the bulk send.** It must not ship before Dream
is registered with the NCC and the monthly cleanse runs. Building the audience
and consent layer first is also the honest order — you cannot send lawfully
until you know who you may send to.

## Slice 2 — outreach

6. NCC registry registration (Simon/Bronwyn — commercial, not code) and the
   **monthly cleanse job**, on the existing cron pattern, writing hits into
   `contact_point_suppression`.
7. **Templated bulk send** on Resend: per-recipient unsubscribe token, sender
   identification, objection route in every message per s69(3).
8. **"Notify matching contacts"** from a listing — resolve interests → consent
   → suppression → preview the audience with exclusions shown and *why* →
   send. Writes a `communication` row per recipient, so the contact timeline
   finally has content.
9. Channel modelled for WhatsApp (Simon: "email now, WhatsApp designed for") —
   `channel` is an enum on consent, suppression and campaign from day one, so
   adding the Business API later is an integration, not a reshape.

## Verification

- `npm run typecheck` + `npm run build` green.
- Import 100 synthetic contacts including deliberate duplicates of existing
  parties; confirm the dedupe step catches them.
- **Consent guard test**: attempt a second consent request to the same party;
  it must fail at the database, not the UI.
- **Suppression test**: unsubscribe an address that appears on two party rows;
  confirm both are excluded from the next audience.
- Audience preview must show excluded recipients and the reason, so an agent
  can see the system is protecting them rather than silently dropping people.
- Load in a browser before merge — house rule.

## STOP conditions

- Any request to send bulk marketing before NCC registration and a working
  monthly cleanse. This is the one place in the codebase where "ship it and fix
  it later" carries a criminal penalty.
- Discovering that an existing flow already writes to `consent` (it does not
  today, but check before assuming ownership of the table).
- Import source that can't be attributed to a lawful basis — do not default it
  to `past_client` to make the flow work.

## Open questions

- **Angie's list is mixed.** At import she must be able to say which contacts
  are past Dream clients and which are personal network. Can she tell them
  apart from her phone export, or does the OS need to cross-match against
  existing `transfer_party` history to identify the past clients automatically?
  (The cross-match is cheap and worth doing regardless — it turns a guess into
  a fact.)
- Does Bronwyn want an agency-wide view of who is marketing to whom, to avoid
  two agents mailing the same person about the same listing?
- When an agent leaves, what happens to their contacts? Dream is the
  responsible party, so the data stays — but the answer should be explicit
  before agents start loading personal networks into it.

## Sources for the legal position (checked 2026-08-06)

- [The 2026 Opt-Out Registry: Three Legal Axes — Mayet & Associates](https://mayet.law/the-2026-opt-out-registry-three-legal-axes-that-now-govern-direct-marketing-in-south-africa/)
- [New National Consumer Commission opt-out to direct marketing registry — Bowmans](https://bowmanslaw.com/insights/south-africa-new-national-consumer-commission-opt-out-to-direct-marketing-registry/)
- [Guidance note on direct marketing — Michalsons](https://www.michalsons.com/blog/guidance-note-on-direct-marketing-in-south-africa/51168)
- [CPA Amendment Regulations 2026 — Werksmans](https://werksmans.com/do-not-call-me-ill-call-you-south-africas-2026-cpa-amendment-regulations-operationalising-the-national-opt%E2%80%91out-regime-for-direct-marketing-and-shifting-day/)

**This is not legal advice.** Before the first bulk send, Dream should have its
attorney confirm the consent wording and the s69(3) position on past clients.
