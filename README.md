# Dream Properties OS — database

The Supabase/Postgres backbone for the Dream Knysna operating system: a bespoke
CRM + property database + transaction record store for **Dream Knysna (Pty) Ltd**,
replacing PropCtrl and the scattered laptop/Outlook/WhatsApp tooling.

Ownership sits with Dream Knysna (`BronwynDream/Dream-Properties-OS`). Supabase
project: **"Bon Bon's Database"**, EU (Ireland) region — POPIA-acceptable.

## What's here

```
supabase/
  migrations/
    0001_init.sql      extensions, enums, reference/lookup tables
    0002_core.sql      agencies, users, parties (person OR juristic), estates, property spine
    0003_deal.sql      transfer, listing, mandate, offer, agreement, conditions, milestones, commission, compliance
    0004_docs.sql      documents (+versioning), media/drawings, FICA, communications, audit, consent
    0005_rls.sql       row-level security baseline (admin / lead-agent scoping)
    0006_storage.sql   private storage buckets (documents / media / fica)
  seed.sql             reference data + known agencies, conveyancers, estates
```

## Design spine

`property` is the canonical root (UUID PK). Everything hangs off it:

```
property ─┬─ erf (1..n; a site can be multi-erf, e.g. 169 Links = Erf 1602+1603)
          ├─ ownership history (Lightstone-fed owner timeline)
          └─ transfer (one ownership-change cycle)
               ├─ transfer_party (joint sellers/buyers, many-to-many)
               ├─ listing → mandate(s), CMA, price history, media
               ├─ offer(s)
               ├─ agreement(s) → suspensive_condition(s)   [versioned: template→executed]
               ├─ milestone(s)  (deposit due, guarantee, transfer date …)
               ├─ commission
               ├─ compliance_cert(s)
               ├─ fica (per party per role)
               └─ communication(s)  (email / WhatsApp log)
```

### The four structural decisions baked in (from the folder audit)

1. **Juristic parties.** `party` models an individual *or* a company / CC / trust /
   partnership; `party_member` links directors / trustees / partners / beneficial
   owners and flags who may sign. (Plot A4 = company, 7 The Grove = partnership.)
2. **Document versioning.** `agreement` and `document` carry `status`
   (template → draft → clean_final → executed) + `version` + `supersedes_id`, so the
   signed final is never confused with a working draft.
3. **Plans + estates.** `media.kind` covers elevations / sections / floor & concept
   plans, and `estate` holds estate-level rules, design manuals and levies (Pezula, Thesen).
4. **Communications log.** `communication` gives the email threads and the WhatsApp
   waiver a first-class home linked to the deal.

## How to apply

**Option A — Supabase SQL editor (quickest):** open the project → SQL Editor → run
each file in `supabase/migrations/` in numeric order, then `supabase/seed.sql`.

**Option B — Supabase CLI:**
```bash
supabase link --project-ref <your-project-ref>
supabase db push        # applies migrations/
psql "$DATABASE_URL" -f supabase/seed.sql
```

> Credentials never live in this repo. Provide the DB URL/keys via your local
> environment or the Supabase dashboard — do not commit them.

## App users (after auth accounts exist)

RLS keys off `app_user.id = auth.uid()`, so seed users only once their Supabase Auth
accounts exist:
```sql
insert into app_user (id, full_name, email, role, ppra_ffc) values
  ('<auth-uuid-bronwyn>', 'Bronwyn Eyre', 'bron@dreamknysna.co.za', 'admin', '20232300257'),
  ('<auth-uuid-camilla>', 'Camilla Eyre', 'camilla@dreamknysna.co.za', 'admin', null),
  ('<auth-uuid-vanessa>', 'Vanessa Eyre', 'vanessa@dreamknysna.co.za', 'agent', null);
```

## Web app (Next.js)

Phase A scaffold — a login-gated shell that proves auth + RLS against the live DB.

```
app/            Next.js App Router
  login/        Supabase email+password sign-in
  dashboard/    protected shell (shows the user's name + role)
  auth/signout/ sign-out route
lib/supabase/   browser + server + middleware clients (@supabase/ssr)
middleware.ts   session refresh + gates /dashboard
```

**Run locally**
```bash
cp .env.example .env.local     # fill in the two NEXT_PUBLIC_SUPABASE_* values
npm install
npm run dev                    # http://localhost:3000
```
Get the values from Supabase → Project Settings → API: `Project URL` and the
`anon` `public` key. (Both are browser-safe; RLS does the gating.)

**Deploy (Vercel)**
1. Vercel is linked to this repo — every push to `main` auto-deploys.
2. In the Vercel project → Settings → Environment Variables, add
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (and later
   `NEXT_PUBLIC_MAPBOX_TOKEN`). Redeploy so they take effect.
3. Add the domain `app.dreamknysna.co.za` in Vercel → follow the one DNS record it shows.

Build is verified: `npm run typecheck` and `npm run build` both pass.

## Status

Schema v0.1 — first migration. RLS is a safe baseline (admin full; agents scoped to
transfers they lead; FICA bucket admin-only). Conveyancer magic-link rooms and the
client portal get scoped policies in a later migration. See `../project.state.md`.
