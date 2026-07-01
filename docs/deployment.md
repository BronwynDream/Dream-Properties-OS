# Deployment & hosting — from repo to Bronwyn logging in

How the system gets from "code on GitHub + database on Supabase" to Bronwyn opening
a browser and logging in. _Status: v0.1 plan — recommendation, pending your nod on the
framework._

---

## Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | **Next.js (React + TypeScript)** | Best-fit with Supabase and Vercel; server + client in one; huge ecosystem; the design system (Fraunces / Hanken / Estuary tokens) ports straight from the wireframes. |
| Frontend host | **Vercel** | Made by the Next.js team; connects directly to the GitHub repo; every push auto-deploys; free hobby tier to start; automatic HTTPS + global CDN. |
| Backend | **Supabase** (already live) | Postgres + Auth + Storage + auto REST/Realtime APIs + edge functions. EU/Ireland region → POPIA-clean. |
| Maps | **Mapbox** (already chosen) | Per the locked stack; Dream has credentials. |
| Domain | **`app.dreamknysna.co.za`** (subdomain of the domain Dream already owns) | Keeps the app separate from the public marketing site; no new domain to buy. |

Alternatives considered: Netlify/Cloudflare Pages (fine, but Vercel + Next.js is the
smoothest path); a lighter Vite/React SPA (works, but we'd give up server-side niceties
we'll want for the edge-function calls and auth). Recommendation stands at **Next.js on Vercel**.

## Topology

```
  You (build)                          Bronwyn / agents (use)
      │                                        │
   git push                              browser: app.dreamknysna.co.za
      │                                        │
   ┌──▼─────────┐   auto-deploy on push   ┌────▼─────────┐
   │  GitHub    │────────────────────────▶│   Vercel     │  (app shell + code; NO personal data)
   │  repo      │                         │  (Next.js)   │
   └────────────┘                         └────┬─────────┘
                                               │  authenticated API calls (anon key + user JWT)
                                          ┌────▼─────────────────────────┐
                                          │  Supabase (EU / Ireland)      │
                                          │  Postgres · Auth · Storage ·  │
                                          │  Edge functions (parse/OCR)   │  ← all personal data lives here
                                          └───────────────────────────────┘
```

The important POPIA point: **Vercel only ever serves the app's screens and JavaScript.**
Every piece of personal data stays in Supabase (EU), fetched live per request and gated
by RLS on the logged-in user. Nothing sensitive is "hosted on Vercel".

## Secrets — the one rule
- The frontend uses only the Supabase **anon (public) key** + the user's login JWT. That's
  safe to ship to the browser because RLS enforces access server-side.
- The **service-role key** (bypasses RLS) is used **only** in server-side edge functions,
  never in the frontend, never in the repo.
- Keys live in Vercel's environment variables + a local `.env` (already git-ignored).

## The path from here to Bronwyn logging in

**Phase A — scaffold + auth (get a login working)**
1. Scaffold a Next.js app in the repo (`apps/web/`), wire the Supabase client with the anon key.
2. Build the **login page** (Supabase Auth email+password) and a protected shell that
   redirects unauthenticated users to login.
3. Create the three Auth accounts (Bronwyn, Camilla, Vanessa) in Supabase → seed their
   `app_user` rows (the README snippet) so role/RLS come alive.
   *Milestone: Bronwyn can log in and see an empty, gated app.*

**Phase B — first real screen (make it useful)**
4. Build the **triage queue** (`v_triage_queue`) + the **drop zone** — build steps 1–2 of
   the triage spec. Now login leads somewhere she can actually start migrating.
5. Add the **map + property record** next (the wireframes already show these).

**Phase C — deploy (make it live)**
6. Connect the GitHub repo to Vercel; set the env vars (Supabase URL + anon key, Mapbox token).
7. First deploy → Vercel gives a `dream-properties-os.vercel.app` URL. Test there.
8. Add the custom domain `app.dreamknysna.co.za` in Vercel → it shows one DNS record to add.

**Phase D — go live for the team**
9. Point DNS (below), confirm HTTPS (automatic), invite the team, two-tier beta (Vanessa first).

## What we need from Bronwyn / Dream
- **DNS access for `dreamknysna.co.za`** — either the login to wherever the domain is
  managed (registrar / their web person), or a request to that person to add **one CNAME
  record**: `app` → the target Vercel gives us. That's the only infrastructure ask.
- Confirmation the **Mapbox** account/token is available (per the locked stack).
- The email addresses for the three initial user accounts (we have them: bron@, camilla@, vanessa@).

## Who logs in, and as what
- **Bronwyn, Camilla** → admin (full access, FICA audited).
- **Vanessa + other agents** → agent (only their own transfers, via RLS).
- **You (Simon)** → admin as a user; plus builder access to GitHub, Supabase Studio, Vercel.
- Conveyancer magic-link rooms + a client portal come later (separate, scoped access).

## Rough running cost (confirm current pricing)
- **Supabase** Pro ≈ US$25/mo (already budgeted in PROJECT.md).
- **Vercel** — free hobby tier likely covers Dream's usage initially; Pro only if outgrown.
- **Mapbox** — free tier covers Dream's volume (per PROJECT.md).
- **Domain** — already owned; the subdomain is free.
So the marginal hosting cost to get Bronwyn logging in is essentially the Supabase line
you're already planning for.

## Immediate next action
Scaffold the Next.js app (Phase A) so there's a real login to deploy. Everything else
(triage screen, map, deploy) hangs off that shell.
