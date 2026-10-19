# Dream Knysna OS — project state

Running log of what's decided, built, and next. Updated at the end of each working
session. `PROJECT.md` remains the canonical business/design doc; this file is the
"where are we right now" companion.

_Last updated: 2026-10-19_

---

## PASSWORD-RESET LINK FIX (2026-10-19, evening)

**Feedback moment (verbatim, Simon on his iPhone):** "When I push the link to
reset the password, it takes me straight back to the original login page ... It
doesn't actually give me a reset password landing page."

**Diagnosis**
- Reset emails used the PKCE `?code=` flow via `/auth/callback`. The code can
  only be swapped in the browser that asked for the email (verifier cookie). On
  iOS the home-screen app, Outlook's in-app browser and Safari are separate
  cookie jars, so the swap failed → redirect to `/login?error=…` — and the login
  page never displayed `?error`, so it looked like nothing happened.
- Same trap for invitations: admin `inviteUserByEmail` links come back with the
  session in the `#hash`, which the server route can't read → `missing_code`.

**Shipped**
- `app/auth/confirm/route.ts`: `verifyOtp({ type, token_hash })` — works in any
  browser. Needs the Supabase email templates changed (Simon, Studio →
  Authentication → Emails): Reset Password and Invite user links →
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account/password`
  (type=invite for the invite template).
- Login page now shows plain-English messages for `?error=` and finishes
  `#access_token` sign-ins (older invite links) → `/account/password`.
- `/auth/callback` maps errors to codes; `/` forwards stray `?code=` /
  `?token_hash=` (Supabase falls back to the Site URL when a redirect isn't
  allow-listed).

**Verification**: tsc + build. NOT verified end to end — needs Simon to update
the template and request a reset on his phone.

---

## ARC E3 — SCAN & FILE (2026-10-19)

**Shipped**
- **Scan pages** on the property record's Add documents panel (and straight
  from the closed panel on phones). Photograph a document page by page; each
  photo is straightened to the page edges and cleaned, and the pages become
  one PDF that drops into the usual file list → pick the document type → File.
  Everything happens on the phone; nothing uploads until "File".
- `lib/scan.ts`: `loadPhoto` (downscale to 2400 px), `detectCorners` (Otsu +
  largest bright blob + extreme points; falls back to a 6% inset), `flatten`
  (homography warp with bilinear sampling, quarter-turn rotate, "Clean" mode =
  divide out a dilated background estimate → white paper, grey ink, legible
  signatures), `pagesToPdf` (pdf-lib, A4 width, one page per scan).
- `app/properties/[id]/ScanPages.tsx`: full-screen sheet, corner editor with
  44 px draggable handles (arrow keys nudge), Rotate / Clean–Colour / Reset /
  Delete, page thumbnails, Add page. Loaded with next/dynamic only when tapped.
- `AddDocuments.tsx` wires it in; styles `.scan*` in globals.css.

**Verification**
- Headless Chromium on a synthetic skewed photo with a shadow: detected
  corners within ~0.5% of the truth; output straight and clean; 2-page PDF made.
- Phone-size (390×844) harness of the sheet: empty → corner editor → thumbnails
  → PDF handed back (144 KB). tsc + next build clean.
- NOT verified on a real phone camera (Simon), nor live after push.

**Loose ends**
- Corner detection needs contrast between page and surface; on a white table it
  falls back to the inset and the agent drags the dots.

---

## ARC E2 — "NEAR ME" ON THE MAP + CO-AGENT SCOPING (2026-10-19)

**Shipped**
- **Co-listing agents see shared listings.** New `lib/myListings.ts`
  (`myListingIds`) = listings where `agent_user_id` is the user UNION listings
  reached via `listing_agent` through the user's active `agent` row. Dashboard,
  Mandates and Pipeline now scope "mine" through it (they used only
  `agent_user_id`, so Vanessa would not have seen the deals she shares with
  Bronwyn). Mandates select fixed from `name` to `full_name`.
- **"Near me" on /map** (mobile plan E2). `MapView.tsx` adds a Mapbox
  `GeolocateControl` (high accuracy, tracks, heading) driven by our own
  "◎ Near me" pill in the map tools; the stock crosshair is hidden in
  `map.css`. First fix: fly in (max zoom 17), switch **Erven on** so the agent
  can tap the erf they're standing on for its municipal record, and sort the
  list **Nearest me**. `ResultsList.tsx` gains `SortKey "near"` (only offered
  once a location is known) and a distance label on each card
  (`kmBetween` from `lib/external-listings/geocode.ts`). Location refused /
  unavailable shows a plain dismissible message. Tools row wraps on phones.

**Verification**
- `tsc --noEmit` clean; `next build` compiles (env placeholders in the
  container — the only prerender errors there are the missing Supabase env).
- NOT yet verified live: house rule — load /map after Simon pushes and check the
  pill renders, no console errors, dots still install. Real geolocation can only
  be tested on a phone (Simon).

**Loose ends**
- E3 scan-and-file, E4 voice notes, E5 sign on glass (legal check), E6 Today.
- Show-house check-in parked by Simon.

---

## ARC E1 — INSTALLABLE ON PHONES + MAP DOTS FIX + AGENT NAME FIX (2026-10-19)

Plan: Arc E (mobile in the field) saved to the Claude project as
`claude/dream-os-mobile-plan.md`. Simon: show-house check-in parked; "the rest
is awesome" (E1 install + phone pass, E2 around-me map, E3 scan & file, E4
voice notes, E5 sign on glass — legal check first, E6 Today).

**Shipped**
- `app/manifest.ts` (name/short_name "Dream OS", start_url /map, standalone,
  portrait, theme #122E87) + `app/layout.tsx` metadata (applicationName,
  appleWebApp capable/title, icons). Icons in `public/`: icon-192, icon-512,
  icon-maskable-512, apple-touch-icon — Dream's crescent redrawn at size from
  `brand/apple-touch-icon.png` (bg #302A4C). No service worker yet (offline
  is a later candidate).
- **Map dots never appeared on Satellite** (seen at phone size, live): this
  morning's crash guard returned when `isStyleLoaded()` was false at
  style.load and nothing retried. `MapView.tsx` install effect now retries on
  `map.once("idle")`. House rule: verify live after push.
- **Property record "No listing on this property yet" on listed properties**
  + empty agent picker: selects asked app_user for `name`; the column is
  `full_name`. Fixed both selects in `app/properties/[id]/page.tsx`.
- Phone pass at 375 px (built-in browser): Properties, property record,
  Documents, top-bar drawer fit with no horizontal scroll. Nothing else needed
  for E1.

**Verification**: tsc + build pass. Live check of the map dots + install
prompt after push.

## AGENTS FILE THEIR OWN DOCUMENTS — FROM THE OFFICE OR A PHONE (2026-10-19)

**Feedback moment (Simon, verbatim):** "the agents should certainly be able to
load/file their own documents" and, mid-build, "i also want the agents to be
able to use their cell phones whilst out in the field".

**Shipped**
- `app/properties/[id]/AddDocuments.tsx`: "+ Add documents" on the property
  record for anyone who works on it (directors + its agents). Drop / choose
  files, or **Take a photo** (camera, shown on touch devices only), pick
  "What are they?" (document_type, grouped by category), File. Browser
  uploads straight to `documents/uploads/<propertyId>/<uuid>-<name>`.
- `fileDocuments()` in `app/properties/[id]/actions.ts`: checks
  `works_on_property` / `works_on_transfer` (0086 rpcs, caller's session),
  validates paths are under that property's upload prefix, then (service
  client) inserts `document` rows (uploaded_by = caller, is_pii from the type
  / fica category) linked to the deal AND the property. No deal yet → opens a
  preparing transfer on the caller's open listing (or plain, for directors).
- Agents' empty deal band now says "No deal opened yet. Prepare the mandate,
  or add documents below…" (triage link stays for directors).
- Migration `0088_agents_file_documents.sql`: staging-bucket files are also
  readable when their `document` row is visible — intake filed deal papers
  in `staging`, and 0086 had limited staging to the batch sender + directors,
  so agents couldn't open their own deal's intake papers.

**Verification**: tsc + build pass; 0088 applied on the stand-in DB and an
agent sees exactly the staging file of their own deal's document. Upload
flow not yet clicked through live.

**Loose ends**: orphaned uploads (upload ok, filing failed) stay in storage
unreadable (no document row) — harmless; a sweep could tidy them later.

## ROSTER: LOAD EVERYONE, INVITE ONLY ON THE SWITCH (2026-10-19)

**Feedback moment (Simon, verbatim):** "so i'd like to load everyone and not
have to send an invite, the invoite should only go out when we flick the
toggle to active"

**Shipped**
- Migration `0087_roster_invite_role.sql`: `agent.invite_role app_role
  default 'agent'` — the role a roster person's login is created with when
  switched on (Director for Camilla).
- `addRosterPerson` (director-only): adds name/email/phone/role to the
  roster, NO email; links an existing login by email if one exists.
- `setAgentAccess` invites with `invite_role` (admin → director login).
- Roster heading "The team"; "+ Add someone to the list" form; status shows
  "Director-to-be · not invited"; confirm says "…as a director".
- Removed the old "+ Invite team member" button (it emailed immediately).
- All paths fall back if 0087 hasn't run (adding a director then asks for it).

**Verification**: 0087 applied on the stand-in DB; tsc + build pass.
- 0087 also seeds Camilla Anley-Eyre (camilla@dreamknysna.co.za) as director-to-be, access off (Simon: "you've left out Camilla?").
**Live state seen 2026-10-19 ~18:55**: logins = Angie Bevan (agent, active),
Bronwyn (director), Simon (director). Camilla: none.

## TEAM PAGE: AGENT ROSTER WITH ACCESS SWITCHES (2026-10-19)

**Feedback moment (Simon, verbatim):** "I'D LIKE TO CREATE A PAGE WHERE EACH
AGENT IS ALREADY LISTED AS AN AGENT BUT TOGGLED OFF FOR ACCESS AT THIS POINT.
THEN I WANT TO INVITE THEM BY TURNING ON THEIR ACCESS. I ALSO THOUGHT angie
Bevan had been invited ?"

**Shipped**
- `/team` now opens with **Agents**: every `agent` roster row (0085, the 7
  from the website) with live-listing count, status and an Access switch.
  Status comes from app_user + Supabase Auth (service `listUsers`, page is
  director-only): Director / Access on (last signed in) / Invited (date,
  hasn't signed in) / Access switched off / No access · not invited.
- `setAgentAccess({agentId, on})` in `app/team/actions.ts` (director-only):
  ON → existing app_user re-activated; or an Auth login that already exists
  (dashboard invite) gets its app_user (no second email); else
  `inviteUserByEmail` + app_user(role agent) + agent.app_user_id. OFF →
  app_user.active=false (0086: is_staff() needs active, so access closes).
  Refuses directors (managed in the list below) and self.
- Inline confirm before either action ("Send Angie an invitation…?").
- Below it, "Logins & roles": the existing list + "+ Invite team member"
  (for Camilla as Director).
- CSS `.roster*`.

**Verification**: tsc + build pass. Not yet seen live (needs push). Angie's
real status will show on the roster once live.

## TEAM PAGE: LIST FALLBACK + AGENT ROLE TEXT (2026-10-19)

Simon: "HOW DO I SET CAMILLA AS A DIRECTOR? WHERE IN THE SYSTEM DOES THIS
HAPPEN?" Answer: Admin → Team & access → "+ Invite team member", Access role
"Director" (or the role dropdown on her row if she already has a login).
The list showed "No team members yet" while two directors exist: its select
asks for profile columns (job_title, phone, ppra_ffc, ffc_expiry_date) and
the error was swallowed. `app/team/page.tsx` now falls back to the core
columns and logs the error. `app/team/roles.ts` agent description updated
to the 0086 rule. Verify live after push; if the warning shows, apply the
missing profile migration (0024 / 0051).

## AGENT ACCESS RULES — MIGRATION 0086 (2026-10-19, evening)

Built BEFORE any agent invite, as required. Simon's rule (verbatim, 2026-10-17)
is in the WEBSITE LISTINGS section below. **Decisions (Simon, 2026-10-19, question card):**
- Another agent's property opens with **public facts only** (address, erf,
  size, photos, asking price, listing agent) — no parties/owners/buyers,
  offers, documents, deal terms.
- **Directors = Bronwyn, Camilla, Simon** (role `admin`) see everything.
- **Contacts an agent loads are theirs + directors'** (`party.owner_user_id`).
- **Past sales: date and price only**, completed sales only.

**Shipped**
- `supabase/migrations/0086_agent_access_rules.sql`:
  - `is_staff()` now = active AND role in (admin, agent).
  - Helpers (SECURITY DEFINER, all start with `is_staff()` so a deactivated
    login loses everything): `works_on_listing` (listing_agent ↔ agent ↔
    login, or listing.agent_user_id), `works_on_transfer` (lead, or works on a
    listing on it), `works_on_property`, `can_see_party` (director, owner, or
    on a visible deal / offer / entity / viewing), `can_see_link`,
    `can_see_document` (visible link AND no hidden deal-level link — intake
    links deal paperwork to the property too), `can_use_draft_anchors`,
    `property_sales(pid)` (completed sales: dates + agreement price).
  - Views `transfer_public` / `mandate_public` (staff only, no names/terms) for
    the map and the record stamp.
  - RLS replaced on party, party_member, transfer, transfer_party, offer,
    agreement, suspensive_condition, milestone, commission (agents read, only
    directors write), transfer_inventory, listing (read all; update own),
    listing_price_history, mandate, cma, property_ownership_history,
    market_property, ppra_disclosure(+rows), fica, communication, viewing(+
    attendee), party_interest, party_tag, contact_point_suppression,
    document, document_link, document_draft (+version write), storage
    (`documents` follows the document row; `media` office-wide; `staging` by
    batch creator).
  - Linking needs visibility: transfer_party / offer purchaser / party_member /
    viewing_attendee inserts require `can_see_party` on the person.
  - Triggers (non-director user sessions only; service role passes):
    `guard_deal_links` freezes listing.property_id/transfer_id/agent_user_id,
    transfer.property_id/lead_agent_user_id, and transfer_id on child rows;
    `guard_party_owner` stops contact take-over; `guard_draft_server_fields`
    keeps rendered/signed ids, finalised status and anchors server-only.
  - muni_property: column grants to authenticated for every column EXCEPT
    `owner` (built from information_schema at apply time). NOTE: a future
    column added to muni_property is not readable by users until the grant
    block is re-run.
  - `mark_transfer_sold` gets a `works_on_transfer` check (text-patched;
    raises if 0033's body has changed).
- App: `lib/takeon.ts` (staff check + service client + `claimListing` +
  `listingMembers`); `takeOnForMandate` refuses someone else's listing, an
  unassigned listing, or a sale in progress (non-directors) and makes the
  seller the agent's contact; `createProperty` and `contacts/new` write via
  takeon with ownership; `createDraft` checks the deal is visible;
  property record public-facts mode (`works_on_property` rpc → `canSeeDeal`,
  "Listed by … details private" band + Past sales, no Prepare document /
  take-on drop zone, mandate stamp from `mandate_public`); map reads the
  public views (falls back to the tables if 0086 hasn't run).
- `scripts/check-access-0086.sql`: rollback-only test. Invents a stand-in
  agent, puts them on one deal, impersonates them, and raises the report as an
  error (so everything rolls back). 39 checks incl. the reviewer's attacks.

**Verification**: built a stand-in Postgres 16 (tables/policies as in the
migrations, no PostGIS) in the container; applied 0086 (and re-applied:
idempotent); test **39/39 PASS**, each refusal for the right reason
(policy / trigger message). Independent review agent found 4 critical + 6 high
in the first draft (re-pointing listings/deals, linking other people's
contacts, claiming unassigned listings, property-linked deal papers, drafts
pointed at other deals, deactivated users, in-progress prices) — all fixed and
covered by tests 37–50. tsc + next build pass. NOT yet run on Bon Bon.

**Loose ends**
- APPLIED on Bon Bon by Simon (2026-10-19 ~17:50). Check script on Bon Bon:
  38/39 PASS; the one FAIL (#6) was the test's own expectation — the picked
  "other" deal isn't completed, and past sales now show completed sales only.
  Check #6 now compares against that property's completed-sale count.
  Directors on Bon Bon: Bronwyn Eyre and Simon Houghton only — **Camilla has
  no director login yet** (create / promote her before relying on it).
- Pre-existing, not touched: `/team` shows "No team members yet" (its select
  probably errors on a column — investigate before inviting); property page
  and AgentPicker select `app_user.name` / `agent:agent_user_id(name)` but the
  column is `full_name`.
- Agents still can't upload documents onto a record (take-on drop zone commit
  is admin-only) — next step if Simon wants agents to file their own papers.
- `/dashboard`, `/mandates` still scope by `listing.agent_user_id` (lead);
  RLS now hides other deals anyway, but co-agents may miss shared ones there.
- Performance: `can_see_party` per row on the contacts list — fine at today's
  size; index / rewrite if the contact book grows large.
- `muni_property_public` (0050) still shows purchase price and bond details to
  all agents (deeds-office facts; owner excluded).

---

## TAKE-ON MAP: BIGGER, WITH A SUBURB JUMP (2026-10-19)

**Feedback moment (Simon, verbatim):** "the map is really small. should we
have a suburb search bar or something easier to track the property ?"

**Shipped**
- Map now sits full width under the search, `min(520px, 62vh)` tall, with a
  "Bigger map" toggle (82vh; calls `map.resize()`).
- "Go to suburb" dropdown above the map (ErfPickerMap `SUBURBS`: the
  GARDEN_ROUTE_CENTROIDS list, one name per point, other towns dropped) flies
  to zoom 15.5, where erf boundaries show.
- Typing a suburb in the search box offers "Leisure Isle →" chips that fly
  the map there (`jump` prop), so the agent can then click the erf.
- CSS: `.takeon-where` single column, `.erfmap-bar/-suburb/-size`,
  `.docstart-suburbs/-suburb`.

**Live check after push (built-in browser, 2026-10-19 17:10)**: Go to suburb →
The Heads flies to zoom 15.5 with erf lines; clicking a house picked
"16 Ou Pad Road · Erf 10926 · new record" and outlined it in gold; typing
"15 Eagles Way" now shows only the Dream OS record (roll duplicate hidden).
Found: a page scroll over the map zoomed the map (to street-texture level).
Fixed: `cooperativeGestures: true` (Ctrl/⌘+scroll or two fingers moves the
map), `maxZoom: 19`, picks fly to a fixed zoom 17.5. Stopped before Continue
each time — no records created.

**Found in the live check (previous push) and fixed in the same commit**
- Picking a roll erf didn't move the map: `erf_centroid_lookup` (0060)
  matches only `tag_value = 'erf N'` and `maj_region = 'KNYSNA'` and returned
  nothing for erf 4497 (15 Eagles Way). `locateErf` now falls back to
  cadastral_parcel with digits / "erf N" variants and `maj_region ilike
  '%KNYSNA%'` (as the 0039 snap does), parsing the centroid from GeoJSON or
  EWKB hex. Existing records also outline their `prcl_key`.
- The roll offered "15 Eagles Way" as a NEW record although "15 Eagles Way,
  The Heads, Knysna" exists: roll hits whose address is a prefix of a Dream
  OS result are hidden, and `resolveProperty` also matches `address,%`.
- Roll suburbs carry a code ("1300-Heads"): stripped for display and for
  the suburb lookup.

**Verification**: tsc clean, build passes. Live check pending push.

## MANDATE TAKE-ON: FIND THE PROPERTY ON THE MAP TOO (2026-10-19)

**Feedback moment (Simon, verbatim):** "i think the search bar should allow
you to find the property on the map as well?"

**Shipped**
- `app/documents/ErfPickerMap.tsx` (new, client-only via next/dynamic):
  a 340 px satellite map beside the take-on search. Parcel tiles
  (`/api/tiles/parcels`, from zoom 14) with hover highlight; clicking an erf
  reads `/api/muni/at-erf` exactly like the main map's erf popup and picks
  it. Picking a search result flies the map there and outlines the erf in
  gold (or drops a marker when only the record's lat/lng is known).
- `app/documents/actions.ts`: `locateErf(erfNumber)` (rpc
  erf_centroid_lookup → prcl_key + centroid) and `propertyForErf(sg, erf)`
  (an erf clicked on the map that's already on a Dream OS record picks that
  record, not a new one; erf-number match only when unique).
- `page.tsx` now selects property lat/lng and passes NEXT_PUBLIC_MAPBOX_TOKEN.
- CSS `.takeon-where` (two columns, stacks under 760 px), `.erfmap*`;
  `.docstart-panel` widened to 1040 px.

**Verification**: tsc clean, build passes. **Map render NOT yet loaded in a
browser** — house rule: check it live after Simon pushes, before relying on it.

## MANDATE FROM DOCUMENTS: TAKE ON THE PROPERTY + SELLER, THEN THE EDITOR (2026-10-19)

**Feedback moment (Simon, verbatim):** "I would imagine you wouldn't have a
property listed at this point without a mandate. I would think, when you
click a mandate, it should ask you for the details, and then it should open a
property record automatically whilst it generates the mandate." Agreed with
one guard (look before creating — the property is often already in Dream OS
or on the municipal roll). Simon: "yes please".

**Shipped**
- `app/documents/MandateTakeOn.tsx` replaces the property picker for the
  Mandate block. Type the address → "Already in Dream OS" (client filter over
  every readable property) + "Municipal roll" (`/api/erf-lookup`, filtered to
  the typed street number) + "Not listed? Create … as a new property". Then
  the seller (AddSellerFields; skipped if the record's open listing already
  has one, with "Add another seller"). "Continue to the mandate".
- `app/documents/actions.ts` → `takeOnForMandate()`: find/create property
  (existing id → erf already attached by SG number → same address ilike →
  new property with suburb/extent/deed + erf row); find the open listing
  (draft/live/under_offer) or create preparing transfer + draft listing;
  attach seller party via transfer_party; add the caller's `agent` row to
  listing_agent (lead if first) and set listing.agent_user_id if empty.
  Uses the SERVICE client after checking the caller is active staff,
  because property/listing/transfer/party writes are admin-only under RLS
  (0005). `mandateContext()` reads the seller already on record.
- `buildPartyRow` + `SellerInput` moved to `lib/parties.ts` (a "use server"
  file can only export async functions); `app/properties/actions.ts`
  imports and re-exports the type.
- CSS: `.docstart-results/-group/-new/-onrecord`.

**Verification**: tsc clean, next build passes. NOT yet clicked through live.

**Loose ends**
- `saveMandate` (mandate editor) still writes with the user client, and
  `mandate` / `listing` writes are admin-only under RLS — an AGENT can now
  take on the property but the mandate save would fail for them. Must be
  fixed with the agent access rules, before invites.
- New properties from this flow have no map pin until geocoded / the erf
  snap runs; their listing is draft, so nothing shows on the map anyway.
- Seller privacy ("only the agents on the listing see the seller") is still
  the pending access-rules work; the form makes no promise about it.

## DOCUMENTS OPENS ON "WHAT ARE YOU MAKING", NOT HISTORY (2026-10-19)

**Feedback moment (Simon, verbatim):** "If you're coming in fresh, just
straight from the menu, from Documents, it should give you four or five blocks
as to which document you would like to work on, or which one you would like
to generate. It shouldn't have a history of what documents you've done
before, which is what it's currently doing."

**Shipped**
- `app/documents/page.tsx` is now a start page: five blocks — Mandate
  (exclusive / joint / open), Agreement of sale (house / sectional / land),
  Movables, Addendum (to sale / to movables), Disclosure (PPRA / condition
  report appendix). Picking one opens a panel: which exact document, then
  which property (search; your own listings shown first with no query).
- `app/documents/DocumentStart.tsx` (client) does the routing: mandates →
  `/properties/[id]/documents/mandate/new?type=…&listing=…`; everything else →
  `createDraft()` (same action as the record's "Prepare document…"), which
  redirects to the editor. Deal documents only list properties with a
  transfer (newest transfer, same rule as the property record).
- The old history list moved to `app/documents/prepared/page.tsx`
  ("Prepared documents"), linked quietly at the foot of the start page and
  from the record's "All prepared documents →" (GeneratedDocuments.tsx).
  Its templates section was dropped — the blocks replace it.
- Styles: `.docstart-*` in `app/globals.css`.

**Verification**: `tsc --noEmit` clean; `next build` passes (with dummy
Supabase env). Live check in the built-in browser after Simon pushes.

**Loose ends**
- The family → template mapping is hard-coded in DocumentStart.tsx (as it
  already was in PrepareDocumentButton.tsx). If a template is added to
  `doc_template`, both lists need it.
- Property picker shows every property the user can read; when the agent
  access rules land, RLS narrows it automatically.

## TOP-BAR MENUS UNDER THE MAP BAR + MAP CRASH ON LOAD (2026-10-19)

**Feedback moment (Simon, with screenshot):** "when you click on the admin menu, it drops behind the map menus."

**Cause:** `.topbar` was z-index 30 while the map's `.mx-bar` is 60, so the Admin/More dropdowns (and the phone drawer, which lives inside the top bar) opened underneath it. **Fix:** `.topbar` is now z-index 100: above every page's own bars, below the command palette (300) and lightbox (1000).

**Found while checking it live:** /map crashed ("Application error") in a browser whose remembered basemap was Satellite, with the console showing "Style is not done loading" from `addSource`.
- Cause: the basemap effect's first run happens on mount while `basemap` state is still the SSR default "map", but the map was built on the remembered "satellite". It called `setStyle(street)` (and overwrote the remembered choice), then flipped back to satellite once the saved choice loaded. Two style loads raced, and the install effect ran while a style was loading.
- Fix: skip the basemap effect's mount run (`basemapMounted` ref), and the install effect returns early if `!map.isStyleLoaded()` (the next style.load re-runs it).
- Verification: tsc and build clean. Live check after push: the tab with remembered Satellite must load /map without the error, and the Admin menu must open over the map bar.

---

## LIGHTSTONE PARKED (2026-10-18)

**Feedback moment (verbatim, Simon):** "So what actually happens when you push 'Fetch a Lightstone report' on the Dream OS? It's not actually linked to Lightstone, is it? … it's R5,000 a month or something, which is not what we require … Maybe that sends a request somewhere or an email to Camilla to look it up, but we just have to park that for now because it's offering something that doesn't actually exist."

**What it did:** with no `LIGHTSTONE_API_BASE`/`KEY` set, `lib/lightstone` falls back to the stub adapter, which files "[SAMPLE]" placeholder documents onto the record. On a sync-created record (10 Old Drift, Simola) it errored with "property not found" (not investigated; parked).

**Shipped:**
- The "Order Lightstone report" buttons (record plate + Take on documents) and the Lightstone lookup on New property are hidden unless both env vars are set.
- `/api/lightstone` and `/api/lightstone/search` return 503 "Lightstone isn't connected" without them, so no more placeholders.
- Code kept for a future reseller / API (see LIGHTSTONE STRATEGY 2026-07-22).

**Open question (Simon, 2026-10-18):** "I'm not sure if all of the agents have their own manual login to Lightstone, or whether the company has one login that they all use." It's on the running list **claude/questions-for-bronwyn-and-camilla.md** in the Claude project ("Dream Knysna"), together with every other open question for Bronwyn and Camilla gathered from these notes. Add new ones there, not here.

**Idea for later (Simon):** turn the button into "Request a Lightstone report", which emails Camilla (who uses the Lightstone portal) with the property, and files her PDF back via intake. That fits the "pay once, view forever" plan.

---

## WEBSITE LISTINGS → DREAM OS, WITH AGENTS (2026-10-17, afternoon)

**Feedback moments (verbatim, Simon):**
- "The website is a complete listing of what's on the books. What we now need to do is take all of those listings, bring them into Dream OS, and assign them to an agent. Then when an agent logs in, they can see the listings that are associated with them as property records on the system."
- "I think the agent can fill in the blanks if there are any on the property record. So if there is no address the record should still be created and then the agent can add the details right"
- "Yes then the agent can add the sellers details as well as all the other available documents for the record"

**Decisions (Simon, via question card):** co-listed agents both see the listing, and the first-named is lead. Do NOT send invites yet. Where a listing already exists, the website's price wins and Dream OS's status wins.

**What the comparison found (2026-10-17):**
- The website has 49 listings; Dream OS has 25 property records.
- Only 8 website listings exist in Dream OS, and only 2 of those agree on price and status.
- 41 website listings had no record. 6 Dream OS records are folder names, not properties. 6 Bowden Park appears twice.

**Shipped**
- Migration `0085_agents_and_website_listings.sql`:
  - New `agent` roster table, keyed by email (7 agents, from the website's agent cards), and `listing_agent` (position 1 = lead).
  - New columns: `listing.website_slug / website_url / website_seen_at` and `property.address_to_confirm`.
  - Trigger `trg_app_user_links_agent` links an agent to their login by email (any capitalisation) when the login is created, and fills `listing.agent_user_id` for listings where they lead.
  - RLS: staff read, admin write. New `agent_on_property()`: agents can update `property` and insert/update `erf` on properties they're listed on.
  - Missing suburbs seeded.
  - 8 website listings hand-linked to existing properties via `external_listing.matched_property_id`:
    - Eagle's Way → 12 Eagles Way; E105; St James → 4 Waterfront Drive; Jaw Dropping → 25 Ridge Drive (268 m²); Inviting the Outdoors in → 159 Sharples (1 043 m²); Hudson Heights; Freehold with Views Forever → 19 Eagles Way; Dual Living B&B → 6 Bowden Park (1 373 m²).
- `lib/dream/website.ts`:
  - `parseIndexCards`: title, price, area, erf/dwelling m² (`&sup2;`!), beds, baths, `offer-banner` = under offer, and the cover-photo caption = street address when it has a number.
  - `parseAgentCards`: reads the `.dream_agent_form_data` sidebar.
  - `stripAgentSidebar`: agent photos were being read as listing photos, which is where the "Angie" / "Avril" / "Gael" / "Bronwyne" addresses came from.
  - `captionAsAddress`, `suburbForArea`.
- Dream refresh route:
  - Discovery collects cards; the parser strips the sidebar and collects agents.
  - The upsert takes the address from the card caption, plus area→suburb, price, beds/baths, erf/floor m², and `raw.card` / `raw.agents`.
  - Rows whose address becomes null are re-located by area.
  - At the end it runs the OS sync, but only once a listing with a `website_slug` exists, i.e. after the first reviewed run.
- `lib/dream/sync.ts` `syncWebsiteToOs`:
  - Matching order: `website_slug` → `matched_property_id` → create.
  - New property: caption address or "<title>, <suburb>" + `address_to_confirm`; suburb, estate, type, erf extent; lat/lng only when the geocode was exact.
  - Adopts the property's latest listing that has no slug, or creates one: live / under_offer from the banner; sold if the transfer is registered; under_offer if it's in progress.
  - Website price wins (with price history). Dream OS status wins, except draft.
  - Replaces `listing_agent` to match the website.
  - Reports listings gone from the website, without closing them.
- `POST /api/sources/dream/sync-os?dry=1` (admin).
- Properties page: tabs for My listings (the agent default), Current listings (the office default) and All properties. Columns for status, price and agents (lead marked), an "Address to confirm" chip, and a hint on My listings. Falls back to the plain list before 0085.
- Property page: "Listed by …" in the header, an "Address to confirm" chip, and **Edit details** (street address, suburb, erf number, erf size) for admins and the listing's agents. `updatePropertyDetails` clears `address_to_confirm` when the address changes.

**Verification**
- tsc and the build are clean.
- 0085 was run twice on a stand-in Postgres: agents seed, Vanessa auto-links by email, a later Angie login links and fills `listing.agent_user_id`, `agent_on_property` is true for Angie and false for Vanessa, and 13 suburbs.
- The website reader was run against the live site in the browser: page-1 and page-2 cards, the Jo + Avril agents parsed, and the agent photo is gone after the strip.
- NOT yet verified: the real sync against production (next: run Dream refresh, dry-run sync-os, review, apply).

**Applied (19:09–19:15):**
- 0085 run by Simon; Dream refresh run (49 upserted, osSync gated off as designed).
- First apply hit the 60 s limit after 35 of 49 listings. It resumed cleanly on a second run: 10 created, 2 attached, 2 listings added, no errors. A third dry run showed 49 unchanged.
- Totals: 41 properties created, 4 listings attached (E105, 4 Waterfront, 6 Bowden Park, 12 Eagles Way at R 11.9m → R 11.5m), and 4 listings added (19 Eagles Way, Hudson Heights, 159 Sharples as under offer, 25 Ridge Drive as sold).
- Properties page live: 53 current listings, 66 records.
- **Fix after the timeout:** the OS sync no longer runs inside the Dream refresh (the feed alone is about 50–60 s). It's its own cron, GET /api/sources/dream/sync-os at 03:15 UTC (CRON_SECRET bearer), 15 minutes after the feed.

**Follow-ups seen on a created record (Beyond Rare):**
- The header says "No live deal" and the assigned-agent picker says "No listing on this property yet". Both read the older listing/transfer shape and don't see sync-created listings, which have no transfer.
- `/dashboard` and `/mandates` scope on `listing.agent_user_id` (null until agents log in), so they need to read `listing_agent`.

**Email intake vs the new records (Simon asked 19:10):**
- POST /api/intake/email (Resend) only accepts senders that are app_user rows. Agents aren't invited, so their emails are refused.
- Routing is by subject "Property: <address>", trigram-matched against primary_address at ≥ 0.55. Below that it CREATES a new property, so a placeholder-named record ("Beyond Rare, Pezula") must be addressed by that name or it duplicates.
- Batches land in /triage for an admin.
- With agents, intake must respect the access rule: an agent can only file onto records they're on.

**ACCESS RULE (Simon, verbatim, 2026-10-17 — build BEFORE inviting any agent):**
- "Agents should only see their own sellers details nobody else's"
- "so Bronwyn should be able to see any of the property records, Vanessa should only see the deals that Bronwyn and her are working on."
- "yes the map should show all listings to all agents. the OS should not show the sensitive details of the transaction or the owners or any buyers that are loaded for that particular property etc"

What that means for the build:
- Directors (admin) see everything.
- An agent sees only the properties, listings and transfers they're on (`listing_agent`, or as transfer lead / co-agent). That covers Properties, Pipeline, Contacts, Documents and search. The parties (sellers, owners, buyers), FICA, documents, offers and communications on those records follow the same rule, and direct links to anything else are blocked.
- The map shows every listing to every agent: dots and public listing facts only, with no link into another agent's record.
- Agents add and edit sellers and documents only on their own records.
- Today's RLS: `party`, `property`, `transfer`, `offer` and the rest are `is_staff()` read. Every logged-in agent would see everything, so this MUST change first.
- Test with a stand-in agent login: it should open its own records, and a direct link to someone else's record must fail.

**Loose ends**
- Agents still can't add sellers, transfers, FICA or documents: those writes are admin-only in both the app and RLS. Simon wants agents to; I told him it would be its own careful step, scoped to their own records.
- `/dashboard` and `/mandates` scope by `listing.agent_user_id` (lead only), so co-agents won't see their shared listings there until those screens read `listing_agent`.
- Clean-up: the 6 folder-name property records (26 Lower Duthie ×3, Master Templates, the Pezula design manual, "Plot: 21 Emu Crescent … continued"), the duplicate 6 Bowden Park, and PLOT19 Eagles Way vs 19 Eagles Way.
- 6 Bowden Park and Plot A4 are registered, but their listings are still "live" in Dream OS. The website also still advertises 6 Bowden Park ("Dual Living") and 25 Ridge Drive.

---

## MAP PINS: HOUSE-LEVEL OR AREA-ONLY, NEVER THE MIDDLE OF A STREET (2026-10-17, afternoon)

**Feedback moment (verbatim, Simon):** "whats this property doing on Leisure Island ?" It was 52 Woodbourne Dr, Fernwood Estate (P24 116997184, RE/MAX). The stored coordinate (-34.0691, 23.0649) is exactly Google's point for Woodbourne Drive, the middle of the road by the Leisure Isle causeway. Fernwood Estate is ~1.6 km east, on the northern slopes of the Eastern Head (-34.0696, 23.0824). Simon then said "you choose" on the fix; I chose a hollow "area only" dot over leaving those listings off the map.

**Diagnosis:**
- Mapbox returns street / locality / place answers when it can't find the house number, and every path accepted them as exact.
- I swept the live pins for identical coordinates and found:
  - 29 "Contact agent for street address" P24 listings stacked on P24's one placeholder point (-34.026746, 23.084946), from every suburb.
  - 7 Dream-website rows with house-name "addresses" ("Sandpoint", "Avril", "Gael") piled by the causeway.
- The hand-typed centroid table was off: Leisure Isle by about 2.5 km, Fernwood by about 2 km, Simola and The Heads also off.
- Area pins were then erf-snapped to whatever erf contains the area centre.

**Shipped**
- `lib/external-listings/geocode.ts`:
  - `geocodeAddress` accepts only Mapbox `feature_type` address / secondary_address, and rejects an unmatched number or street or low confidence.
  - The centroid table was re-verified against Google points (2026-10-17) for all ~50 suburbs and estates in the data.
  - `centroidForArea(address, suburb, headline)` matches the longest name first, ignores "<name> Street/Rd/…", gives "Knysna Rural" no centroid and uses the bare town last.
  - New: `isHiddenAddress`, `isPlaceholderCoord`.
- New `lib/external-listings/locate.ts`: one chain for every path. Portal JSON-LD (unless the address is hidden or the coordinate is a placeholder) → erf lookup → house-level Mapbox → area centroid (`geocode_source='centroid'`) → off the map.
- Wired in:
  - P24 refresh;
  - P24 regeocode (Mapbox-only, as before);
  - Dream refresh;
  - the map's per-listing re-geocode action, which now also writes `geocode_source`;
  - the manual-coordinate action, which now sets `geo_manual=true`;
  - regeocode-jsonld: on a hidden / placeholder address it refreshes the price only, and sets `geocode_source='exact'` on real hits.
- New `POST /api/sources/recheck-locations?dry=1&after=<id>` (admin):
  - Re-runs every active row through the chain from what is already stored (P24 rawHtml JSON-LD, no re-scrape), in 50 s pages.
  - Skips `geo_manual` rows, and rows whose stored coordinate differs from the stored page (moved since).
  - Rebuilds dedup on the final page.
- Migration `0084_area_only_pins_never_snap.sql`: the erf-snap trigger and `snap_all_to_parcels` skip `geocode_source='centroid'`; existing snaps on area-only rows are cleared.
- Map:
  - `ExternalRef.geocodeSource` (page selects `geocode_source`).
  - `MapListing.areaOnly` when every external on a market pin is centroid. It is drawn as a hollow slate dot, with an "Area only" legend item, an italic note on the hover card and an "Area only" tag in the list. Its erf is never highlighted.
  - A hidden address is shown as the suburb name.

**Correction after the first dry run (same afternoon):**
- The first version of recheck-locations recomputed every pin, and its dry run wanted to move 163 of 262. Many of those were good street pins going to suburb centres. Two causes:
  - Mapbox rarely knows Knysna house numbers, so a house-only rule was too strict.
  - Stored P24 raw pages don't yield the JSON-LD coordinate, so the backfill can't see which pins came from the portal.
- Fixed in two places:
  - `geocodeAddress` now returns `{lng, lat, level: house|street|area}`. `locate.trustMapbox` takes house answers, rejects area answers, and takes street answers unless the listing names an estate or suburb more than 1.5 km away (2.5 km for wide areas such as Pezula, Simola, Brenton and Belvidere; 8 km for Rheenendal and other towns).
  - recheck-locations is now conservative. It touches only (a) hidden or placeholder pins, (b) area-only pins or pins on OLD centroid values, (c) pins sitting on Mapbox's own (now untrusted) answer, (d) rows with no coordinate, (e) pins further from the area their own address names than the tolerance, and (f) Dream-website house names with no number and no area, which go off the map. Hand-placed pins are never moved.
- I simulated (e) and (f) in the browser against the live pins before shipping. Every hit I checked was a real error: Westford Bridge and Pezula listings on the town centre, a Pezula house 56 km away, a Paradise listing in the sea, and the Woodbourne house.
- Added a Knysna River Club / River Club Road centroid (Sun Valley Drive); agents label those listings "Simola".

**Verification**
- tsc and the production build are clean. 0084 was run against a stub-PostGIS Postgres: centroid rows are not snapped, exact rows are, and the bulk snap skips centroid rows.
- Harness render: hollow dots draw (zoom kept as the top-level interpolate), and the hover card shows the note.
- `centroidForArea` was spot-checked (Woodbourne → Fernwood; "Belvidere St, Hornlee" → Hornlee; Knysna Rural → null).
- NOT verified: Mapbox v6 `feature_type`/`match_code` on real responses (no token in the container); the recheck endpoint against production (to run after deploy, dry first).

**Loose ends**
- After deploy: run 0084, then dry-run recheck-locations, review the moves, then apply.
- `app/map/actions.ts` still has its own Mapbox geocoder for OUR properties (`property` table); it is not touched here.
- `dedup.ts:430` unused `updateErrors` (pre-existing).

---

## MAP REDESIGN — DOTS, SEARCH BAR, LIST (2026-10-17, evening)

**Feedback moment (verbatim, Simon):** "I just would like the map to be just better than it is. It's just too busy… Maybe what's irritating me the most is the price and the little white flags for each property. Maybe it's better to have little dots, and then you hover over the dot to see some detail of the property. Maybe there's a little search engine… 'Find me properties in this suburb, this price range, with this many bedrooms, whether it's got a garden or not.'"

**Correction:** price pills are gone by default. Every listing is a dot (navy = ours, slate = other agencies). Hovering a dot shows a card: photo, price, beds/baths/size, agency. Pattern taken from Airbnb, Booking and Zillow research: fewer marks, a search bar on top, the list synced to the map.

**Shipped**
- `app/map/MapView.tsx` rewritten. One GeoJSON source `listings` (promoteId `key`). Circle layers `dots-market`, `dots-ours`, `dots-ring`, plus an invisible `dots-hit` layer for pointer events. The `prices` symbol layer is behind a "Prices" toggle and shows ours always, market only from z13.
  - Feature-state hover/selected grows the dot. Zoom must stay the top-level interpolate (Mapbox rule).
  - The erf outline shows only for the hovered or selected listing.
  - The light basemap (light-v11) is the default; Satellite is one click away. Both choices are remembered in localStorage.
  - Every merged pin shows at every zoom. The old map hid erf-matched listings below z14.
- New: `listing.ts` (normalised MapListing + filters), `FilterBar.tsx` (area search with suggestions; Price with histogram; Beds & baths; Type; More = garden/pool/garage/pets; Listings menu = ours by mandate state + portals), `ResultsList.tsx` ("N in view of M", sort, cards), `HoverCard.tsx`, `PreviewPanel.tsx` (extracted verbatim), `sources.ts`, `map.css` (all `mx-*`; mobile list as a sheet with a "List · N" toggle).
- `app/map/page.tsx` selects bedrooms, bathrooms, property_type and the new fact columns. It falls back to the base columns if 0083 hasn't run yet, so the deploy order is safe.
- `supabase/migrations/0083_external_listing_facts.sql`: adds `features text[]`, `erf_size_sqm`, `floor_size_sqm`. A trigger parses the saved raw page; garden/pool/garage are read only inside the "External Features" block, and "Pets Allowed: Yes" means pets. It fills beds/baths if they are null, and the file backfills existing rows.

**Verification**
- tsc clean; eslint on app/map clean; production build compiles (/map 16.4 kB).
- Rendered in a container harness (Playwright + Chromium, 293 real pin fixtures) on a PLAIN background, because the Mapbox basemap can't load there. Checked: default view, hover card, price panel, listings panel, area search, prices toggle, mobile sheet.
- NOT verified: the live basemap and erf tiles, the real Supabase data, or 0083 against real Firecrawl markdown (the regex is tolerant of `|`, `:`, `*` and spaces, but untested on stored rows). House rule: load dreamproperties.app/map before calling it done.

**Loose ends**
- Run 0083 (pbcopy route). Until then the "More" filters are disabled, with a note.
- The old map CSS in `globals.css` (`.map-shell`, `.price-pin`…) is now unused, except `.map-preview`/`.pv-*`/`.source-dot` (PreviewPanel). Remove it once the new map is confirmed live.
- Dev harness (`devmap` page + Open Sans glyphs) lives outside the repo, at `/tmp/harness` in the cloud container. It is gone with the session.
- `lib/external-listings/dedup.ts:430` has an unused `updateErrors` (pre-existing lint warning).

---

## EVERY DOCUMENT LAID OUT AS ITS MASTER (2026-10-17, later)

**Feedback moment (verbatim, Simon):** "That's much better. I've sent it to Bron so hopefully she's happy. Let's make sure the rest of the agreements and documents render as the templates."

**Shipped**
- `lib/documents/pdf.tsx` uses a PROFILE per template (`PROFILES`), read off each master. A profile sets:
  - letterhead, margins, body top on page 1 and later pages, line pitch (1.5 lines for agreements and movables, single for mandates and addenda), paragraph gap, clause indent, heading gap, page numbers on or off, signature spacing and title style.
- New layout kinds:
  - `centred` — the addendum parties block.
  - `title` — mandate and movables titles: bold, underlined, centred.
  - `sigtable` — the mandate signature table: label, line, "Date:", line.
  - `definitions` — the three-column movables definitions.
  - `annexure` — "ANNEXURE 'A'" closes the signing page and the list starts the next page, as in the master.
- A clause heading now travels with its first paragraph (if that paragraph is ≤ 300 characters) as one unbreakable block. react-pdf's `minPresenceAhead` alone left headings orphaned.
- The signature caption is left-aligned at 251 pt, as in the masters (it was centred).
- Red guidance lines ("EXAMPLES:", "COMPULSORY:") are not printed. They are Bronwyn's notes to agents.
- `lib/documents/letterhead.ts` has five variants:
  - properties, knysna;
  - mandate: page 2 has only the rule and directors line;
  - open: the first page has no "Initial here" box;
  - appendix: no header.
- **PPRA disclosure** is now printed onto Bronwyn's own copy of the prescribed PPRA form, which is a Word-made PDF with the PPRA logo, Arial and the YES/NO/N/A table.
  - `lib/documents/forms/ppra-form.ts` uses pdf-lib (new dependency, `pdf-lib@1.17.1`) with `forms/ppra-master.ts`, which holds the PDF byte for byte.
  - It stamps the property description, an X per statement (columns measured off her vacant-land copy) and the additional information (one line per ruled row; overflow goes to an annexure page).
  - `renderDocumentPdf` takes `context`; `finalise.ts` passes it.
- **Emphasis**: wordings carry **bold** / *italic*. `lib/documents/rich.ts` parses them; the PDF and `ClauseDocument.tsx` render them. The "Edit wording" box says how.
- **Migration 0082** (`scripts/mark-library-formatting.py`, generated from the .docx masters):
  - Adds the movables title (new clause `movables.title`, slot ordinal 5).
  - Adds paragraph numbers that Word auto-numbers and the extraction lost: movables 2.1–2.3 and 3.2, appendix 1–4, sectional 1.2.
  - Sets movables 1.4 to "Erf ___;" as in the master.
  - Changes the house signing lines to "202" / "202." as in the master.
  - Writes the masters' inline bold into 58 paragraphs. 42 wordings change.
  - Every update is guarded: stripping the markup gives back the words exactly.

**Order matters: push the code FIRST, then run 0082.** The old renderer would print the ** markers.

**Expected fingerprints after 0082** (`scripts/check-library.sql`):
- addendum_movables 5 da45681008
- addendum_sale 5 8fb72eb734
- agreement_sale_house 53 249102ca5b
- agreement_sale_land 33 2c31234fcd
- agreement_sale_sectional 50 b8e40fb118
- condition_report_appendix 1 731a2eff5d
- mandate_exclusive 27 9a5f70f49a
- mandate_joint 29 55c3ef0bd3
- mandate_open 26 fa573803ce
- movables_agreement 12 a21b05e714
- ppra_disclosure 10 d1819e86cf

**Verification**
- Each master was rendered with LibreOffice and diffed word for word against our blank render (scratch `tdiff.py`). The only remaining differences are intentional:
  - tokens in place of the 5% / I.D. text;
  - variant choices;
  - guidance lines;
  - two of Bronwyn's typos ("(___," without ")", "20.2Such").
- Page-by-page visual comparison of all 10 Word documents.
- Page counts match her masters for: house 15, sectional 16, land 12, all three mandates (2/2/1), addendum 2, addendum movables 1 and appendix 1.
- Movables renders 5 pages against her 4: the signing block falls one line short of fitting page 3.
- The PPRA sample was checked on the form.
- tsc, eslint, `test:documents` and `next build` are green. 0082 was applied locally to the engine stub.
- NOT verified: a live finalise of each document on Vercel.

**Loose ends**
- Ask Bronwyn which letterhead to use on everything (DREAM PROPERTIES vs DREAM KNYSNA). Each document currently uses its own master's.
- "COMPULSORY:" / "EXAMPLES:" are not printed. Confirm with Bronwyn.
- Search snippets may show ** in clause text (cosmetic).

---

## PDF REBUILT TO BRONWYN'S WORD LAYOUT (2026-10-17)

**Feedback moment (verbatim, Simon relaying Bronwyn):** "Bronwyn is not happy… she's not happy with the way it's come out. … font, format, logos, and all the rest of it. We need to go back to her templates … that layout needs to be followed. You can't deviate from it. You might be able to change the font, but you certainly can't change the layout." And: "It's not about the font, it's literally about the layout … let's duplicate the layout. We don't have to have anything different than her layout."
**Correction:** the signed PDF is now laid out from her .docx masters, measure for measure. The Blueprint look is for the app only, never for documents she signs.

**What was wrong (old `lib/documents/pdf.tsx`):** our DREAM KNYSNA block logo plus an address block, not her header; no cover page; contract information as a grey/blue key–value list; Helvetica 10.5 in blue/slate; left-aligned text; our footer ("PPRA line · reference · Page x of y") in place of her "Initial here" box and directors line; signature block flattened; 12 pages where her master has 15.

**Shipped**
- `lib/documents/pdf.tsx`, rewritten. A4; her margins (house/land 15/15.6 mm; sectional 15/10.2 mm); 10 pt at Word "1.5 lines" (18.15 pt); one empty line between paragraphs; justified; clause number at the margin with text at 10 mm (17.5 mm for x.y.z). It has four layouts, keyed by clause key:
  - Cover page (`*.parties`, sale agreements only): the seven centred lines at the master's measured tops, then a page break.
  - Contract information (`*.contract_info*`): bold labels with values at 50.8 mm; caps labels underlined; Domicilia italic; her blank-line grouping.
  - Signatures (`signature*`, `*commission_acceptance`): one unbreakable block with the commission acceptance; witness lines; signature line and bold caption at 208 pt.
  - Clauses: headings are never orphaned (`minPresenceAhead`); short list items run on (14.1–14.9); "15.1 ELECTRICAL" sub-headings sit tight on their body.
  - Page number: centred in Times 12, from page 2.
  - Per-template `GEOMETRY` (margins, body top, cover tops).
  - The reference moved into the PDF metadata (subject/keywords), because her footer has no room for it.
- `lib/documents/letterhead.ts` (generated): her header and footer as full-width strips cut from 300 dpi renders of the masters, placed at their exact page positions.
  - Two letterheads exist in her set. "properties" (DREAM PROPERTIES) is on house, land, mandates, movables and addenda. "knysna" (DREAM KNYSNA, as in her "Letterhead & Page Numbers.docx") is on the sectional title master.
  - Each template uses its own master's letterhead.
- `lib/documents/fonts.ts` (generated): URW Gothic Book/Demi plus obliques, subset to Latin-1. This is the free metric twin of Century Gothic, the masters' face; Century Gothic is licensed. AGPL with the PDF-embedding font exception (noted in the file).
- The `logo` argument of `renderDocumentPdf` is now unused and kept for the caller.

**Verification**
- Rendered all 11 templates.
- Page counts match her masters (rendered with LibreOffice from `_contract_templates/2026-final/`): house 15/15, sectional 16/16, land 12/12, exclusive mandate 2/2, movables 4/4, addendum 2/2.
- Compared side by side, page by page, for the cover, contract information, clause pages and signatures.
- tsc, eslint, `npm run test:documents` and `next build` are green.
- NOT verified: a live finalise on Vercel (fonts and images are inlined as data URIs, so there is no filesystem dependency).

**Loose ends**
- Mandates, movables, addenda, PPRA and the appendix get her letterhead and type, but not yet their own body layouts. The mandate master is single-spaced, with a centred underlined title, a tabled signature block and no "Initial here" on page 2. They need the same per-template pass.
- The on-screen editor preview (`app/documents/ClauseDocument.tsx`) still uses the Blueprint styling. It is a preview only; the PDF is the record.
- Ask Bronwyn: DREAM PROPERTIES or DREAM KNYSNA letterhead? Her masters mix both.
- The sectional first-page footer carries her stray "INITIALS:____" line, reproduced as is.

---

## PASTE DAMAGE FOUND AND REPAIRED (2026-10-17)

**Feedback moment.** Simon pasted 0080 into the SQL editor; the text that
arrived had characters dropped mid-word in ~60 places ("fulfillmeof",
"propertcopy", "'manual', tr"). Syntax errors stopped it, so nothing ran.
Cause: copying from the file preview, not the editor. A fingerprint check
then showed the SAME damage had silently landed yesterday in 0076 (PPRA
definitions) and 0078 (15 house-agreement wordings) — those had parsed.

### Shipped
- `scripts/check-library.sql` — per-template count + fingerprint of every
  wording (whitespace-normalised, so editor tab→space conversion doesn't
  count; a dropped character does). Expected values:
  addendum_movables 5 3d4c4eff90 · addendum_sale 5 cbb2d98b5c ·
  agreement_sale_house 53 c73fa2649a · agreement_sale_land 33 19eb661b8b ·
  agreement_sale_sectional 50 3fa567b658 · condition_report_appendix 1
  8dcf036e1b · mandate_exclusive 27 0dc2134aa8 · mandate_joint 29
  9fae761b95 · mandate_open 26 cf7e08fe91 · movables_agreement 11
  f901b73374 · ppra_disclosure 10 d1819e86cf.
- `scripts/check-library-detail.sql` — names the damaged wordings for the
  house agreement and PPRA (expected md5 per wording).
- **`0081_repair_library_paste.sql`** — rewrites the 16 damaged wordings
  from the repo text. Drafts resolve from the library on open, so they're
  repaired too; nothing was finalised from damaged wordings.

### New rule
- **Migrations are copied with `pbcopy < file` in Terminal**, never from a
  file preview, and `check-library.sql` is run after every library
  migration. Write the paste command into the hand-off every time.

---

## AGREEMENTS OF SALE — SECTIONAL TITLE AND FREEHOLD LAND (2026-10-17)

### Shipped
- **`scripts/seed-sale-agreements.py` → `0080_seed_sale_sectional_land.sql`**
  (generated). Unlike the hand-laid house seed, this READS the masters: finds
  the numbered clauses, fills every blank in order from a per-clause token
  list, and splits "OR / DELETE / IF APPLICABLE" into variants. A blank it
  can't account for, or a token list that doesn't match, stops generation —
  so the output is verbatim or nothing.
  * Sectional (`sale_st.*`, 37 clauses / 50 wordings): section, scheme,
    door, building, sectional plan, parking bay, sectional title cert;
    deposit "payable on or before"; 15.1–15.5 certificates; 19 controlling
    body & levies with 19.5 "(Delete as applicable)" as a choice; 20
    building plans; suspensive conditions; offer until 16h00.
  * Land (`sale_land.*`, 27 clauses / 33 wordings): no occupation detail,
    fixtures or certificates; 19 estate recordal pre-picked from the
    property's estate; suspensive conditions; offer until 16h00.
  Own clause keys per template: the masters differ in small wording (VAT
  on transfer duty, when commission is due, his/her) and in clause numbers,
  which live inside the bodies.
- Context: `scheme_name` from the erf row; labels for section/scheme/door/
  building/SS plan/parking/deposit-by. Prepare document… enables both.
- Converter fixes found while reading the output: headings with a
  lower-case bracketed instruction (clause 15) are headings; "LABEL: prose"
  is not a table row unless a tab or wide gap follows the colon; a blank
  hard against a word ("known as____") gets a space.

### Verification
- Engine chain 0065→0080 replays cleanly into a fresh harness DB.
- Fidelity: every master paragraph is in the library bodies except
  headings (slot headings), agent instructions, the expiry "___ day of ___"
  (now `{{offer_expires}}`) and "21.1If" spacing.
- Sample PDFs rendered: sectional 12 pages (only occupational rent left
  open, by design of the test), land 9 pages, nothing unresolved.
- NOT yet live: apply 0080, push, prepare each on a test deal.

### Questions for Bronwyn (sectional master)
- **19.1 and 19.3 are the same paragraph word for word.** Kept verbatim.
- **19.5 reads "The developer/Body Corporate has / a Real right…"** — looks
  like "has / has no" lost a word. Kept verbatim; offered as "As in the
  master" / "Not applicable".
- (All three) FFC number 20261501621 vs 2026-15016210000; clause 12.3 ends
  mid-sentence.

---

## LIVE CHECKS + TWO FIXES (2026-10-17)

### Found live
- Agreement of sale on 7 The Grove: prepares and fills from the record
  (seller IDs, postal, domicilium, marital status all came through).
- **The Supabase SQL editor turns pasted tabs into spaces.** Every clause
  body pasted that way (0069 onward) has "Full Names:   value" / "2.1   The…"
  instead of tabs, so the tab-driven layout rules didn't fire on screen.
- Search live: works ("grove" → property, deal, drafts, filed docs, market,
  erven; "1764" → property + roll). Same erf listed twice when the roll
  holds several rows for it.
- "Still needed" said "occupational rent words".

### Shipped
- `lib/documents/layout.ts` — `matchNumbered` / `matchLabelRow` /
  `isAllCaps` / `tidy`, shared by `ClauseDocument.tsx` and `pdf.tsx`: a tab
  OR a run of 2+ spaces separates number/label from text; a witness line
  ("1 ____") is not a sub-clause; double spaces in prose aren't rows. Tests
  added to `resolve.test.ts`.
- `DraftEditor` — `*_words` gaps report under their base field's label.
- **Migration `0079_search_dedupe_erven.sql`** — same function, erf branch
  `distinct on (erf_number, street)`. Tested in the container with a
  duplicate roll row.

### Loose ends
- Future seeds: consider emitting bodies with an explicit tab escape so a
  paste keeps them; the renderers no longer need it.
- Market listing hits for "grove" include three Simola plots — check what
  in their address/headline matches before tuning the threshold.

---

## AGREEMENT OF SALE — FREEHOLD HOUSE IN THE LIBRARY (2026-10-16)

Simon: "so if i want to populate a sales agreement, what do i do?" — the
answer was "you can't yet": the three sale templates were registered in 0069
with no clauses. This loads the freehold house one end to end.

### Shipped

- **`scripts/seed-sale-house.py` → `0078_seed_sale_house.sql`** (generated;
  edit the script). 39 clauses / 53 wordings from Bronwyn's 17 Sept master,
  verbatim. Blanks → tokens. Her "DELETE / OR / IF APPLICABLE" alternatives
  → variants:
  * BOND line + clause 8: chosen by the deal — `bond_amount` filled prints
    the bond clause; empty prints "Not applicable" (cash).
  * 15.1–15.5 certificates: "Applies" / "Not applicable" each.
  * 5.5 existing lease (default "Not let"), 19 building plans (available /
    not available — R100 000 retained), 24 suspensive (None / sale of
    purchaser's property / viewing / Master's consent).
  * 22.1 estate and 22.2 Thesen Islands: pre-picked from the property's
    estate and suburb.
  Template activated. **Wording that is ours, not Bronwyn's**: only the
  one-line "… – Not applicable." variants that keep the clause numbers
  (listed in the migration header). Needs her OK.
- Fidelity check: all 160 master paragraphs found in the library; the
  differences are headings (stored as slot headings), the two agent
  instructions that must not print, "20.1If" spacing, and the expiry
  "___ day of ____" → `{{offer_expires}}`.
- `lib/documents/context-deal.ts` — the contract-information page fills
  from the record: per side names, IDs (ID/passport/registration), postal,
  domicilium, marital status (from `matrimonial_regime`), email, phone;
  "N/A" for represented-by when every party is a person and for marriage
  date when every party is unmarried/divorced/widowed. Also title deed,
  suburb, estate, deposit, transfer date, lead agent, conveyancer firm +
  contact, commission % from the latest mandate on the property, principal.
  `derive.ts`: words + ZAR formatting for deposit, bond, occupational rent.
- **PDF + on-screen layout conventions** (`pdf.tsx`, `ClauseDocument.tsx`):
  "2.1<tab>text" → hanging-indent numbered sub-clause; "Label:<tab>value" →
  two-column contract-information row; short all-caps line → bold
  sub-heading; heading-only clauses travel with the next clause; sections
  under 700 chars never split. PDF palette moved to Blueprint (blue title,
  slate ink, cool hairlines).
- Prepare document… lists the three sale agreements; sectional and land
  show "Being loaded next".

### Verification

- Engine chain 0065→0078 replays cleanly in the container harness.
- Sample 12-page PDF rendered through the real resolver with a bond sale +
  sale-of-purchaser's-property condition + two certificates N/A; read
  every page. Cash, estate and Thesen choices switch correctly. tsc,
  eslint, document tests, build clean.
- NOT yet live: apply 0078, push, prepare one on 7 The Grove.

### Loose ends

- **FFC number mismatch for Bronwyn**: her master says "FFC 2026 – 2028 No.
  20261501621"; the agency record has 2026-15016210000. Kept her text
  verbatim; one of them is wrong.
- Master clause 12.3 "Any notice to a party shall –" ends mid-sentence (the
  sub-items are missing in her Word file). Kept verbatim; ask her.
- Sectional title and land agreements next — most wording shared; reuse
  `sale.*` clauses, add variants where they differ.
- Editor field list is long (~40) on the agreement; grouping by section
  would help (Arc D polish).

---

## ARC B1 + B2 — ONE SEARCH OVER EVERYTHING, ⌘K IN THE TOP BAR (2026-10-16)

### Shipped

- **Migration `0077_search_everything.sql`** — `search_everything(q,
  per_kind)` returns `(kind, id, title, subtitle, href, score)` across
  properties (address, erf number, title deed), deals (transfer name),
  people (name, email, phone by last nine digits, exact ID / passport /
  registration number — matched, never returned), prepared drafts, filed
  documents (title + full-text over `ocr_text`), market listings (address,
  headline, exact P24/PP ref; links to the map pin, else the portal), erven
  on the municipal roll (exact erf number or "13 campbell" street match),
  estates. Trigram `word_similarity` + substring for short fields, so typos
  are forgiven ("sofianso" → Sofianos); exact identifiers rank 1.0.
  **Security invoker** — every branch runs under the caller's RLS. Adds the
  trigram / FTS indexes the existing set didn't cover.
- `app/api/search/route.ts` — GET `?q=` → the RPC as the signed-in user.
- `app/components/CommandSearch.tsx` — the box: "Search ⌘K" button in the
  top bar (icon only on phones), ⌘K / Ctrl+K or "/" to open, debounced
  fetch with abort, results grouped Properties → Deals → People → Prepared
  → Filed → Market → Erven → Estates, ↑ ↓ Enter Esc, full-screen on phones.
  External portal links open in a new tab.

### Verification

- Migration run against a stub schema in the container with sample rows:
  "grove" (property, deal, draft, filed agreement, erf), "1764" (property +
  roll), "13 campbell" (market listing + roll), phone in three formats,
  ID number (person, ID not shown), "occupational rent" (OCR text), typo
  tolerance, single-character query returns nothing. tsc / eslint / build
  clean.
- NOT yet live: apply 0077, push, then the box in the browser.

### Loose ends

- B3 (ask-your-data, SQL-generating) and B4 (clause search, draft from
  precedent) and B5 (market research layer) remain in Arc B.
- Filed documents with no property link show "not filed on a property" and
  don't open; a document viewer route would fix that.
- No recent-searches / recently-viewed list in the empty state yet.

---

## LOOK & FEEL "BLUEPRINT" (OPTION B) + TOP BAR (2026-10-16)

Bronwyn chose Option B from the three-option PDF. Applied across the OS
by re-binding the design tokens rather than touching components, plus a
rebuilt top bar and the landing page in the Option B layout.

### Shipped

- **Fonts** — `app/layout.tsx`: Instrument Sans (`--font-body`, and
  `--font-display` now aliases it: one family, no serif) + Geist Mono
  (`geist` package, `--font-geist-mono` → `--font-mono`). Fraunces, Inter,
  JetBrains Mono gone.
- **Tokens** — `app/globals.css` `:root` rewritten with the same NAMES:
  Dream blue `--navy #122E87`, `--estuary #0B1D5A`, cool ground
  `--paper-0 #F4F6FB` / white cards, slate ink, `--line-* #C5CDE3/#DEE3EF`,
  fynbos `--positive #3D7A4E`, rust `--critical #B9431F`, radius 6/10, cool
  shadows, status pills per the option. **`--gold` now aliases `--navy`** —
  40 rules pointed at it; the ones that put gold on a dark surface
  (eyebrows on blue, exclusive-mandate pill, hero map pivot, warn icon →
  caution) were re-pointed by hand. `--grid-blue` is the survey grid.
- **Top bar** — `TopBarClient.tsx` rewritten: blue band with the grid,
  DREAM / KNYSNA OS wordmark, flat row Home · Map · Properties · Deals ·
  Documents · People · Inbox (active = white underline), **More** menu
  (Mandates, Viewings, Estates, Erf lookup), **Admin** menu (admin-only:
  Data health with the feed-light dot, Compliance, Triage, Dupes, Team,
  Settings), avatar (initials) menu with Change password / Sign out. Drawer
  under 768px mirrors it. `lib/feeds/overall.ts` `overallFeedLight()` is
  shared by the bar; Landing's old admin line is gone.
- **Landing** — `Landing.tsx` renders the Option B layout: greeting, date
  and today's three figures (big mono numbers) on a blue band that
  continues the bar; the six tiles below on the ground, each with one big
  mono figure + label; overdue note in rust. Dashboard page now places
  `<Landing/>` before `<main className="page page-after-land">`.
- No search box yet: ⌘K search is Arc B and the box lands with it.

### Verification

- tsc / eslint / `next build` clean; fonts fetched at build. Login page
  screenshotted locally (Instrument Sans, blue card head, cool ground).
- Seen live (2026-10-16 13:35): landing band + tiles, Admin menu with the
  dot, dashboard attention/columns, property record, map (renders; rail on
  the cool ground), phone layout at 375px with the drawer. Nothing broken
  by the token swap on those pages; the full page-by-page sweep is still
  worth doing once Bronwyn has clicked around.

### Loose ends

- Map markers still use gold for exclusive mandates (`MapView.tsx`,
  `PropertyHero.tsx` layer paints). The map needs its own palette pass with
  a browser check (house rule).
- Document surface (`/documents/[id]`, mandate page) keeps its warm paper
  (`#F5F1E8` hard-coded) — decide whether the paper should go cool too.

---

## ARC A6 — PPRA SECTION 67 DISCLOSURE AS A DOCUMENT; ADDENDUM AMENDMENTS (2026-10-16)

### Shipped

- **Finding that changed the model.** Bronwyn's "Vacant Land" PPRA form is
  the SAME prescribed form as the house one, pre-answered N/A on every
  statement except boundary disputes (NO), with "This Property is Vacant
  Land." as additional information. The OS had an invented plot question
  set (zoning, NEMBA, water rights…) that is not the statutory disclosure.
  `lib/ppraDisclosure.ts`: `PLOT_QUESTIONS = HOUSE_QUESTIONS`, plus
  `PLOT_PRESET` applied when a plot disclosure is created; `ppraFormTypeFor()`
  and `answerMark()` shared helpers (property page and /compliance now use
  the same detection).
- **Migration `0076_ppra_disclosure_template.sql`** — one `ppra_disclosure`
  template (10 clauses, regulation wording verbatim). The eleven statement
  answers are `{{ans_<question_key>}}` tokens; additional information and
  property description are tokens too. Retires the 0069 placeholders
  `ppra_disclosure_house/land`.
- **`lib/documents/ppra.ts`** — `ensureDisclosureRows()` (shared by the
  property-page action and draft creation; plot preset on create) and
  `ppraContext()` (answers → "YES [X]  NO [ ]  N/A [ ]", explanations folded
  into additional information; unanswered stays a gap). `buildDealContext`
  merges it for any transfer, so the disclosure tokens are on every deal
  draft's context.
- `createDraft('ppra_disclosure')` ensures the structured record exists
  first (service client — the ppra tables are admin-write under RLS, but
  starting the disclosure is part of preparing the deal).
- Editor: `ans_*` tokens are not fields; a panel says the answers live on
  the property record. "PPRA mandatory disclosure" added to Prepare
  document….
- **Migration `0075_addendum_amendments_variant.sql`** — "Write the
  amendments" variant (`{{amendments}}`) is now the default for both
  addenda; Bronwyn's EXAMPLES block kept as a reference variant. Editor
  renders long tokens (`amendments`, `agent_disclosures`,
  `ppra_additional_info`) as a textarea with a hint.
- The whole engine chain 0065→0076 replays cleanly into a stub Postgres in
  the container (stub tables for property/transfer/document/app_user + the
  is_admin/is_staff/set_updated_at functions) — a cheap migration harness
  worth keeping; see the session transcript for the stub script.

### Verification

- tsc clean, eslint clean on touched files, `next build` clean. Migrations
  replayed in the container harness: `ppra_disclosure` typed, 10 slots;
  amendments variants as intended.
- Live (0075 + 0076 applied): Prepare document → PPRA disclosure on 7 The
  Grove opened the prescribed form with the property description filled and
  eleven gaps. Answering on the property record then showed the draft did
  NOT pick the answers up — field_values are snapshotted at creation. Fixed:
  `refreshPpraTokens()` re-reads the ans_* tokens from the record on every
  open and at finalise (additional information typed on the draft wins).
  "Still needed" now says "N statement answers on the property record"
  instead of listing raw token names. Re-checked live: draft `c9c668d9`
  shows roof NO [X], electrical YES [X], the explanation under Additional
  information, and "9 statement answers on the property record" as the gap.
  A6 closed.
- NOT yet checked: the plot preset on a vacant-land deal (no vacant-land
  transfer in the test data).

### Loose ends

- PPRA answers are still admin-write (requireAdmin + RLS). An agent leading
  the transfer can prepare the form but not answer it — contradicts "for
  Bronwyn and agents equally". Needs a lead-agent write policy (Arc C).
- "Annexed to the agreement of sale" waits for the sale agreements to be
  seeded (A-seed). `document_link` to the transfer already ties them.
- The [X] marks are text; a tick-box table in the PDF would be closer to the
  master's layout. Cosmetic.

---

## TOKENISE THE SHORT TEMPLATES (2026-10-16, after A5)

The first live finalise printed an addendum that said "all fields filled"
and was full of blanks: 0069 kept Bronwyn's underscores verbatim, so the
record could not put seller, purchaser, erf, address or date on the page.

### Shipped

- **Migration `0074_tokenise_small_templates.sql`** — rewrites the Master
  bodies of `movables.definitions` (erf, known-as, purchaser, seller),
  `movables.purchase_price` (`{{movables_price}}` / `_words`),
  `addendum.parties` and `addendum_movables.parties` (names, erf, address,
  `{{agreement_date}}` / `{{movables_agreement_date}}`) and
  `condition_report.seller_unable` (`{{agent_disclosures}}`). Signature
  blocks keep their blanks — place and date are written at signing.
- `lib/documents/context-deal.ts` — `agreement_date` now formatted as a
  contract writes it ("14 March 2026", `longDate()`); labels for the two new
  tokens so the editor asks for them in plain words.

### Verification

- tsc clean. Migration not run locally (no Postgres in the container);
  apply on Bon Bon, then open a new addendum draft on 7 The Grove and check
  the parties block fills from the transfer and "Still needed" lists only
  the agreement date if the transfer has none.

### Loose ends

- `addendum.amendments` still prints the master's "EXAMPLES: 1. Clause ___
  shall now read…" unless the agent edits the wording. By design (the agent
  drafts the real amendments) but a final PDF with "EXAMPLES" in it is a
  trap — consider a blank-by-default variant + a nudge in the editor.
- Existing finalised drafts are untouched; already-open drafts pick up the
  new wording on next render (selections point at the same variant rows).

---

## ARC A5 — FINALISE → PDF, FILED; SIGNED-COPY REGISTER (2026-10-16)

Plan 019, slice A5. A draft can now be frozen into a PDF that is stored and
filed on the property record, and the signed copy filed against it.

### Shipped

- **Migration `0073_document_finalise.sql`** — `document_draft.signed_document_id`,
  `signed_at`, `signed_by`; fills `doc_template.doc_type_id` (0065 created the
  column, nothing set it) so finalised PDFs file under the right
  `document_type` (mandates → `mandate`, sale agreements → `agreement_of_sale`
  / `land_freehold_agreement`, movables, addenda, condition report →
  `ppra_disclosure`).
- **`lib/documents/pdf.tsx`** — `renderDocumentPdf()` with `@react-pdf/renderer`
  (new dependency, 3.4.4). Letterhead (logo + agency identity + FFC), the
  resolved sections, PPRA line + reference + page numbers in the footer.
  Built-in PDF fonts on purpose: no font fetch at render time, identical on
  Vercel and locally. Heading kept with its first paragraph so a page never
  ends on a bare clause number. The letterhead is the one place to restyle
  once Bronwyn picks the new look.
- **`lib/documents/derive.ts`** — `DERIVED` + `deriveContext()` pulled out of
  `DraftEditor` so the editor preview and the PDF resolve identically.
- **`lib/documents/finalise.ts`** — `finaliseDraft()`: resolve → PDF → upload
  to `documents` bucket at `generated/<property>/<draft>-v<n>.pdf` → insert
  `document` (status `final`, `doc_type_id` from the template) → `document_link`
  rows (property / transfer / listing / mandate, role `generated`) → stamp the
  draft `final` with `rendered_document_id`, `finalised_at/by` → set
  `mandate.document_id`. `fileSignedCopy()`: PDF/JPEG/PNG/HEIC ≤ 25 MB →
  `signed/<property>/<draft>-signed-<stamp>.<ext>` → `document` (status
  `executed`, `supersedes_id` = the print) → links role `signed` → print marked
  `superseded` → draft `signed_document_id/at/by`, mandate repointed.
  Reads go through the caller's client (draft RLS decides who may); the
  `document`/`document_link` writes use the service client because 0005 RLS
  reserves those tables for admins — the agent's user id is on every row.
- **`app/documents/[id]/actions.ts`** — `finaliseDraftAction`,
  `fileSignedCopyAction` (FormData). `next.config.mjs`: server-action body
  limit raised to 25 MB for the phone-photo upload.
- **`app/documents/[id]/file/route.ts`** — `GET ?which=print|signed` → 302 to
  a 5-minute signed storage URL. Addressed by draft id so links stay stable.
- **`DraftEditor`** — *Finalise* (disabled while unsaved) opens an inline
  confirm that says what freezing means and how many blanks will print;
  *Download PDF* replaces *Print* once filed; *Signed copy* link; a
  file-signed-copy panel on final drafts. Status line shows "signed" and the
  finalised / signed timestamps.
- **Hub + property register** — status pill reads Signed once the copy is on
  file; property register rows get a PDF button (signed copy when present).
- **`public/brand/dream-knysna-logo@2x.png` was a saved WordPress 404 page**,
  not a PNG (the browser was silently falling back to 1x). Replaced with a
  real 400×200 upscale of the 1x.

### Verification

- `tsc --noEmit` clean, eslint clean for touched files, `test:documents`
  passes, `next build` clean in the container.
- Rendered a 3-page sample through the real renderer and looked at every
  page (letterhead, title, tab rows, headings, footer, page numbers).
- Live (0073 applied, Vercel green): finalised the test movables draft
  `994af811` in the browser → FINAL, timestamp, Download PDF opened the
  3-page PDF from storage. Two things the live PDF showed that the container
  sample did not: the logo fell back to text (Vercel does not ship /public
  into server functions → logo now inlined as base64 in
  `lib/documents/logo.ts`), and numbered sub-clauses with an inline blank
  were set in Courier (fill-line heuristic tightened to "Label: ____" lines
  only). Both fixed and re-verified live on a fresh addendum draft
  (`832496d2`): logo in the letterhead, body face throughout. Third nit from
  that PDF: justified text stretched lines ending in a hard break ("in
  respect of Erf ___ Knysna (___), dated") — paragraphs now left-aligned.
- The property record's document list already shows the generated PDF
  (document_link → property works end to end).
- NOT yet verified live: the signed-copy upload from a phone photo.

### Loose ends

- `next.config.mjs` warns `outputFileTracingIncludes` is unrecognised (Next
  14 wants it under `experimental`) — pre-existing, means the pdfjs worker
  include for valuation rolls is probably not applied. Separate fix.
- Finalise is allowed with unfilled fields (they print as blanks to complete
  by hand) — deliberate, the agent is warned in the confirm.
- No "unfinalise"; a change after finalising means a new draft. Hub has no
  "duplicate as new draft" yet — small A5 follow-up.
- Admin-only `document` RLS is now bridged by the service client in one
  place; if more agent-written registers appear, a staff insert policy with
  `uploaded_by = auth.uid()` would be cleaner.

---

## LANDING PAGE — "WHAT ARE YOU HERE TO DO?" (2026-10-16)

Simon: *"when the agent lands on the page, what is it that they are trying
to use the system for at that point in time … essentially those 6 blocks
as tiles on the landing page."* Arc D1 pulled forward.

### Shipped
- **`app/dashboard/Landing.tsx`** (server component) rendered at the top
  of `/dashboard`: greeting in Fraunces ("Morning, Simon.") + date; a
  one-line **today strip** (viewings today · mandates expiring ≤30 d ·
  enquiries waiting — live items gold-underlined, each a link); **six
  tiles** in the agent's own words, each with one live figure:
  market → `/map` (live listings, exclusive count) · deal in progress →
  `/pipeline` (deals in conveyancing, next/overdue transfer) · new
  listing → `/properties#new` (erven on file) · prepare a document →
  `/documents` (drafts in progress) · enquiries → `/inbox` (items
  waiting) · find a person → `/contacts` (people on record). Admins get a
  line below: data-feed light (planned feeds excluded), triage count,
  valuation rolls. Attention list and work columns stay underneath.
- CSS in `globals.css` under `.land-*`, paper tokens only; gold tideline
  rises under a tile on hover/focus; 3 / 2 / 1 columns at 1040 / 600px;
  reduced-motion respected; visible focus.
- `#new` anchor on `/properties` for the new-listing tile.
- Design process: `frontend-design` + `estate-agency-design` skills;
  reviewed against Vercel's web-interface-guidelines checklist (labels,
  focus, tabular-nums, text-wrap balance, reduced motion, no div-clicks).
  Skill research: Vercel agent-skills (web-design-guidelines,
  react-best-practices) and AccessLint are the worthwhile public
  additions; UI/UX Pro Max is a style database, not needed with a locked
  token system.

### Verification
- typecheck, lint, build green. **Browser check done** at desktop
  (3-col) and 375px (1-col, no overflow); no console errors. Two fixes
  after the check: an overdue transfer now reads "3 Oupad is 199 d past
  transfer date" instead of "next: … 31 Mar"; the admin feed light
  ignores planned feeds (Private Property) so it isn't red for a roadmap
  item.

### Loose ends
- "Find a person" becomes the ⌘K search in Arc B2.
- Agents' figures are scoped where the data has an agent (viewings,
  mandates, deals); listings, drafts, people and enquiries are
  agency-wide. Revisit when agents are on the system.
- The three work columns below the tiles are now the second screen; the
  UX audit's #14/#15 (property record order, properties list) are still
  the next D items.

---

## ARC A4 — DRAFT EDITOR + VERSIONS + PREPARE FROM A DEAL (2026-10-16)

### Shipped
- **Migration 0072** — `document_draft.version` (default 1) and
  `document_draft_version` (snapshot of field_values / clause_selections /
  clause_overrides / omitted_clauses before every save, with saver and
  note). RLS mirrors the draft. **NOT YET APPLIED to Bon Bon.** Verify:
  `select column_name from information_schema.columns where table_name =
  'document_draft' and column_name = 'version';` → 1 row.
- **`/documents/[id]`** — the draft editor, one component for every
  template (`DraftEditor.tsx`): a Fields panel with one input per
  `{{token}}` the template's wording uses (`*_words` derive from their
  numeric sibling — price, commission, term), a Clauses panel with a
  variant selector where the library has more than one wording, "Edit
  wording" (kept in `clause_overrides`, library untouched, flagged "edited
  on this document", "Reset to library"), include/omit for optional slots,
  a Versions list, Save (snapshot → update → version+1) and Print. Final
  documents open read-only. Live preview with highlighted gaps and "Still
  needed".
- **`createDraft`** server action + **`lib/documents/context-deal.ts`**:
  "Prepare document…" on the property record (new
  `PrepareDocumentButton.tsx`, next to Prepare mandate) offers the four
  short templates from 0069; picking one creates a draft pre-filled from
  the property and its active transfer (sellers, purchasers, ID lines,
  erf, address, extent, agreement price + date) and opens the editor.
  Blocked with a hint when the property has no deal. The 0069 bodies keep
  Bronwyn's underscore blanks (no tokens yet), so for those four the agent
  fills blanks via "Edit wording"; the context is stored for when the
  bodies are tokenised.
- Hub rows and the property record's Generated documents now open the
  editor; the mandate editor links to its draft after save.

### Verification
- typecheck, lint (0 errors), test:documents, build green.
- Browser check done (10:58 SAST, after 0072 + deploy): 7 The Grove →
  Prepare document… → Movables agreement → editor opened as "Agreement of
  Sale — Movables — 7 The Grove Sofianos to Davis" (draft
  994af811…, test data); edited clause 4, Save → v2, "edited on this
  document", Versions v1 · Simon Houghton. No console errors. Fixed after:
  a body whose first line repeats the slot heading no longer prints it
  twice. Variant switching not exercised live (no mandate draft existed
  yet — the 14 Oct test mandates were never saved).

### Loose ends
- Tokenise the 0069 bodies (purchase price, parties, erf, date) so the
  Fields panel does the filling for movables/addenda too. Small migration.
- Redirect inside `createDraft` means a thrown NEXT_REDIRECT in the
  client transition — expected Next behaviour; if it ever shows as an
  error toast, return the id and `router.push` instead.
- A5 next: finalise → PDF (server render of ClauseDocument) stored in the
  `documents` bucket + `document` row + `document_link` to transfer;
  upload-signed-copy; status final; register view.

---

## ARC A3 — DOCUMENTS HUB (2026-10-14, late)

### Shipped
- **`/documents`** (Deals → Documents in the nav). "Generated": every
  `document_draft` the user can see (RLS: own + transfers they lead;
  admins all), newest first — template, property link, author, date,
  status pill, "Open record". "Templates": the active `doc_template` rows;
  mandates say "Prepare from a property record", purchaser-requiring ones
  "Prepare from a deal — coming". No migration.
- **Property record → "Generated documents"** section (new
  `GeneratedDocuments.tsx`), between Offers/Compliance and Viewings; hidden
  when empty. `page.tsx` queries `document_draft` by property.
- Rows stack below 760px.

### Verification
- typecheck, lint, build green. Not loaded in a browser — straightforward
  list pages; check `/documents` after deploy shows the Templates list (7
  active) and, after saving a mandate, one Generated row.

### Loose ends
- A4: open a draft back into the editor (edit field values, switch
  variants, override clause text, omit optional clauses, versions).
- A5: PDF + signed-document register; upload-signed-copy.
- "Prepare…" for movables / addenda / condition-report appendix needs a
  transfer-based context builder (purchaser, agreement date, erf) — do
  with A4 so there is one editor for every template.

---

## ARC A2 — RESOLVER + CLAUSE-LIBRARY RENDERER (2026-10-14, late)

The document engine's data layer (0065/0068/0069) finally has code on top
of it. Mandates now render from the clause library, not from a hard-coded
React template, and saving one keeps a `document_draft`.

### Shipped
- **Migration 0071 `mandate_slots`** — the parts of the three mandate
  masters 0068 did not seed: `mandate.title`, `mandate.parties_property`
  (the "We/I … being the registered owner … Erf … hereby irrevocably
  instruct" paragraph), `mandate.signatures`, and the joint mandate's
  `mandate.joint_agency_signature` (it sits after the FFC warrant in
  Bronwyn's master). Sets `applies_when = {"mandate_type": …}` on every
  "Exclusive/Joint/Open master" variant from 0068 (they had none, so no
  resolver could pick between them). Tokenises the marketing-price blanks
  (`ZAR {{asking_price}} ({{asking_price_words}} RAND)`). Seeds
  `doc_template_slot` order for all three mandates (11 / 13 / 10 slots).
  Open mandate has no juristic warrant — matches the master. **NOT YET
  APPLIED to Bon Bon.** Verify after: `select t.code, count(*) from
  doc_template_slot s join doc_template t on t.id=s.template_id group by
  1;` → mandate_exclusive 11, mandate_joint 13, mandate_open 10 (plus the
  0069 four).
- **`lib/documents/resolve.ts`** — `loadTemplate()` (one query for
  template → slots → clause → approved variants) and pure
  `resolveDocument(model, ctx, overrides)`. Variant choice: draft
  selection → first variant whose `applies_when` matches → unconditional
  default → first unconditional. **A variant whose predicate did not match
  is never a fallback** (a Joint body must not print on an Exclusive
  mandate just because it was flagged default) — tested. Predicates:
  equality, `in` via arrays, `_gt/_gte/_lt/_lte`, `_set`. Unfilled tokens
  print as `________________` and are listed in `unresolved`. Includes
  `numberToWords` (SA contract style: "Twenty Nine Million Nine Hundred
  and Fifty Thousand"), `percentToWords` ("Three Point Five"),
  `formatZar` (explicit thin-space-free grouping — ICU's en-ZA uses a
  narrow no-break space that copies badly out of PDFs).
- **`lib/documents/context.ts`** — `buildMandateContext(record,
  interview)`: record first, interview second, nothing defaulted;
  commission and term are only ever interviewed (Simon, 2026-08-05).
  `TOKEN_LABELS` for the "Still needed" list.
- **`app/documents/ClauseDocument.tsx`** — generic renderer inside
  `DocumentPage`. Paragraphs from blank lines; ALL-CAPS first line as
  title; tab/underscore lines pre-wrapped so signature rows keep their
  columns; gaps highlighted on screen (`showGaps`), plain in print.
- **Mandate page + editor rewritten.** `page.tsx` loads the template,
  all sellers (primary first, "John and Jane Smith"), ID line, erf, "known
  as" address (Knysna suffix stripped — the master prints it), extent.
  Editor interviews for price, commission % (plus VAT — no inclusive
  toggle, per the 2026-09-28 decision), term in months (expiry derived),
  signed date, joint agency, and "represented by" for juristic sellers /
  joint / open. Live preview re-resolves on every keystroke. Save is
  blocked until commission and term are given.
- **`saveMandate`** writes the 0065 typed columns (`asking_price`,
  `commission_pct`, `term_months`, `commission_incl_vat=false`) and inserts
  a **`document_draft`** (template, field values, clause selections) —
  the first generated document the OS keeps. Draft failure is logged, not
  fatal.
- `MandateSole.tsx` deleted (it was the Business-mandate placeholder, see
  2026-08-06). Prepare-mandate menu gains "Open mandate".
- `npm run test:documents` — 7 groups of assertions on the resolver,
  predicates, number words and context builder.

### Verification
- typecheck, lint (0 errors), `test:documents`, `next build` all green in
  the cloud container.
- **Browser check done (20:55 SAST, after 0071 applied + deploy).** 7 The
  Grove → Exclusive: title, sellers ("Mark Tracy Sofianos and The Leisure
  Partnership"), Erf 1764, address, 614 m² from the record; typing
  29 950 000 / 5 / 6 produced "ZAR 29 950 000 (Twenty Nine Million Nine
  Hundred and Fifty Thousand RAND)", "5% (Five percent)", "6 (six)
  months", expiry 2027-04-14. Joint: Pam Golding in the title, Joint
  Agency line after the FFC warrant. Open: no juristic clause. No console
  errors. Print preview not checked.
- Not tested: a seller with a passport only; a listing with no transfer
  (renders blanks — by design).

### Loose ends
- Apply 0071 to Bon Bon **before** pushing, or Prepare mandate shows the
  "no clauses in the library" message.
- A3 next: `/documents` hub + nav entry, listing `document_draft` rows
  per property/transfer, Prepare… for the four short templates seeded in
  0069 (they need their own context builders — movables and addenda need
  purchaser + agreement details, so they depend on transfer data).
- A4: open a saved draft back into the editor (clause_overrides,
  omitted_clauses — the resolver already honours them).
- Sale agreements still unseeded (A2b): slot-map the freehold-house
  master's ~40 numbered clauses. Biggest remaining seeding job.
- The pre-0065 `mandate.notes` strings on old rows are not back-filled
  into the typed columns. Test data anyway (purge pending).

---

## SLICE H — DATA HEALTH PAGE (2026-10-14, evening)

Simon, looking at the live map after A1 deployed: *"not sure all these
left-hand buttons will go down well with the agents. looks too complicated
for them. i think we need a dashboard that has green lights for each
section to make sure it's up to date with the web hooks and the properties
from the various websites are being rendered properly."* Agreed, pulled
forward ahead of A2 as plan 019 slice H.

### Shipped
- **Migration 0070 `feed_run`** — one row per run of a feed (feed, trigger
  cron/manual/webhook, status running/ok/partial/error, started/finished,
  items, summary jsonb, error). View `v_feed_latest` (security_invoker)
  gives the latest row per feed. **Staff-readable** so the map can show
  agents a dot; only the service role writes. **NOT YET APPLIED to Bon
  Bon.**
- **`lib/feeds/registry.ts`** — the list of feeds (dream_website,
  property24, private_property [planned], muni_roll, geocode,
  intake_email), each with cadence and the map source it backs, plus
  `feedLight()`: a pure function turning the latest run into
  green/amber/red/grey against the cadence (daily → amber after 36h, red
  after 72h; weekly 8d/15d; on-demand 30d/90d; event 14d/45d). Grey =
  never run; red is reserved for failed / never finished / not built.
- **`lib/feeds/run.ts`** — `recordFeedRun(feed, request, handler)` wraps
  an existing route handler, infers the trigger from headers (bearer →
  cron, svix → webhook, else manual), reads the cloned JSON response to
  derive status and an item count, and never throws into the feed.
  Wrapped: `sources/dream/refresh`, `sources/property24/refresh`,
  `muni/import`, `sources/property24/regeocode{,-jsonld,-erf}`,
  `intake/email`. Each route change is three lines; internals untouched.
- **`/admin/health`** (Admin → Data health in the nav). One row per feed:
  light, last run (when / trigger / status / items / error), live counts
  (active listings per source, last seen, missing coords, P24 queue
  pending/total, erven on file, last roll applied, properties pinned,
  email batches), and that feed's buttons. The five map-rail buttons moved
  here (`git mv` from `app/map/`); the map's "Geocode + snap" bar became
  `GeocodeButton.tsx` here, calling the same server action. Rows stack
  below 760px.
- **Map rail slimmed** — `MapView.tsx` loses the five admin buttons, the
  geocode bar, `useTransition`, `geocodeMsg` and `runGeocode`. Keeps
  basemap, sources, cadastral outlines, mandate filter. Source chips get a
  7px read-only dot (`.source-health-*`) from `sourceHealth`, which
  `map/page.tsx` computes from `v_feed_latest` via the same `feedLight()`.
  Legend "Sole / Open / None" → "Open / None". Empty-state copy points
  admins at Data health.

### Verification
- `npm run typecheck`, `npm run lint` (0 errors), `npm run build` green
  in the cloud container; `/admin/health` in the route table.
- **NOT loaded in a browser yet.** House rule: the MapView change must be
  seen before merge. The rail change is JSX removal plus one dot, not a
  Mapbox layer change, but check anyway: after deploy, open `/map` and
  confirm the rail shows only Basemap / Sources / Cadastral / Mandate,
  and `/admin/health` renders with lights (all grey until a feed runs).
- Browser check done (built-in browser, 20:25 SAST): `/admin/health`
  renders with live counts; `/map` rail shows Basemap / Sources /
  Cadastral / Mandate only, legend "Open / None", satellite + pins fine,
  no console errors. Pressed Refresh Dream listings on the health page:
  row went grey → HEALTHY · manual · ok · 49 items, and the DW chip on
  the map got its green dot. Logging proven end to end.
- Two fixes after the check: queue count used `select("id")` on a table
  keyed by `url` (showed 0/0); times now render in Africa/Johannesburg.
- `feedLight()` thresholds untested against real data; tune once a week
  of runs exists.

### Loose ends
- Apply 0070 to Bon Bon before deploy lands, or `/admin/health` and `/map`
  will error on the missing view.
- Every feed shows grey until its next run. Pressing "Refresh Dream
  listings" on the health page is the fastest way to light one up.
- Health page uses the service client for counts; fine while admin-gated,
  but if the page ever opens to agents, switch to the user client.
- Audit #2 (parcels hover-handler leak) and #3 (unfiltered PPRA scan) still
  queued for the first Arc B PR.

---

## REVAMP KICK-OFF — PLAN 019 + ARC A1 (2026-10-14)

Simon returned after two weeks, ran an `/improve` audit, and said the OS
"doesn't match the ambitions I had when I started it". Session evaluated
the audit, re-read `../PROJECT.md` (the June vision) against what was
built, and agreed a four-arc revamp. **Read `plans/019-revamp-roadmap.md`
first** — it supersedes the ordering in `plans/README.md`.

### Decisions (Simon, 2026-10-14)
- Scope: all deal documents, market research + property knowledge base, all
  CRM detail. **Money is out** (no commission engine, trust, Xero).
- Designed for Bronwyn and the agents equally.
- **Straight at new capability**; foundations (lint, tests, god-file splits)
  land inside the arcs where code is touched, not as a blocking prelude.
- E-signature **parked**; PDF + signed-document register first.
- Arc order A (documents) → B (knowledge base) → C (CRM) → D (shell).
- The "new templates file" Simon mentioned is the 2026-09-17 set already in
  `docs/templates/2026-final/`. Nothing newer.

### Audit evaluation
Nine vetted findings; all confirmed against source. #1 (UI still writes
`type:"sole"`) was HIGH and is fixed here. #2/#3 (Mapbox hover-handler leak,
unfiltered PPRA scan) go into the first Arc B map/compliance PR. #4/#5/#9
are small and queued for the next housekeeping moment. The audit's rejection
of the MapView / property-page splits as "blocked on plan 012" is noted but
overridden by plan 019 Arc D6: they split when D touches them.

### Shipped (Arc A1)
- **Mandate type consolidation finished in code.** `actions.ts`,
  `page.tsx`, `MandateEditor.tsx`, `PrepareMandateButton.tsx`,
  `MandateSole.tsx` now use `"exclusive" | "joint"`; the menu reads
  "Exclusive mandate"; the rendered title is EXCLUSIVE MANDATE. `?type=sole`
  on the URL is still accepted as an alias (never written). `MapView`
  `MANDATE_ORDER` drops `sole`; `map/page.tsx` normalises `sole` →
  `exclusive`. Migration 0067's promise ("code stops writing 'sole'") is
  now true.
- **Lint gate.** `.eslintrc.json` extends `next/core-web-vitals` +
  `next/typescript`; `eslint@8` and `eslint-config-next@14.2.15` added as
  devDependencies (they were missing — `npm run lint` used to open an
  interactive setup). Pre-existing debt rules (`no-explicit-any`,
  `no-unused-vars`, `exhaustive-deps`) are **warn**, `no-img-element` is
  off (signed Supabase URLs). Eight hard errors fixed: five unescaped
  apostrophes, three `prefer-const`. `npm run lint` now exits 0 with ~40
  warnings. Ratchet them down as files are touched.
- **Migration 0069** `supabase/migrations/0069_seed_small_templates.sql`.
  Registers all nine remaining 2026-final templates in `doc_template`
  (sale agreements ×3 and PPRA ×2 as `active=false` until their clauses
  are seeded in A2/A6), and seeds 18 clauses / 18 verbatim variants / 20
  template slots for the four short templates: movables agreement,
  addendum to sale, addendum to movables, condition-report appendix.
  First use of `doc_template_slot`. Generated by script from the template
  files so no paragraph was retyped (script not committed; regenerate from
  `docs/templates/2026-final/` if needed). **NOT YET APPLIED to Bon Bon** —
  Simon to paste into the SQL editor wrapped in begin/commit, then verify:
  `select code, active from doc_template order by sort_order;` (12 rows)
  and `select count(*) from doc_template_slot;` (20).
- README "Status" section rewritten (was describing schema v0.1).
- `plans/019-revamp-roadmap.md` added; copy in the Claude project as
  `claude/dream-os-revamp-roadmap.md`.

### Verification
- `npm run typecheck` clean, `npm run lint` 0 errors, `npm run build`
  (cloud container, `npm ci`) — see below for result.
- Migration parsed with `pglast` (24 statements). Not executed against a
  database.
- NOT verified in a browser: the Prepare-mandate menu and render page.
  Low risk (string literal rename), but open `/properties/<id>` → "Prepare
  mandate…" once deployed and confirm the title reads EXCLUSIVE MANDATE.
- The `MapView` change is a constant-array edit, not a render change; no
  browser check done. House rule noted.

### Loose ends
- Apply 0069 to Bon Bon.
- Arc A2 next: `lib/documents/resolve.ts` (fill-source rule), a generic
  clause-library renderer replacing `MandateSole.tsx`, and clause seeding
  for the three sale agreements (slot-map the hand-numbered paragraphs).
- Open with Bronwyn: Business Mandate retired? Lease template or dead enum?
  PPRA condition report shared annexure vs inside the Open mandate?
- `.gitjunk/` on Simon's Mac holds stray tarballs from bridge sessions —
  `rm -rf .gitjunk` whenever convenient.
- Audit #4 (`deriveLabel` duplicated), #5 (svix body guard), #9
  (`constantTimeEq` in muni/import) still open; ten-minute fixes.

### Feedback moments
- Simon on scope: "the OS doesn't handle money, it handles all deal
  documents, all market research and property knowledge base, all known
  CRM detail." Recorded as the scope line in plan 019.
- Simon chose "straight at new capability" over "fix the base first",
  knowing the trade-off. Don't relitigate it; mitigate with per-PR
  characterization tests around touched code.

---

## DOCUMENT VAULT — STATUS READ + TWO CORRECTIONS (2026-08-06)

Simon asked where the document vault stands and how agents reach documents,
mandates and templates. Answering it properly surfaced two things worth
carrying forward.

### Honest status of the vault
There is a document **viewer** attached to the Property Record and a mandate
**printer** that stores nothing. There is no vault.

- **Ways in, all four via a property**: Property Record → Documents section
  (grouped per transfer, 1-hour signed URLs); Property Record → Prepare
  mandate → editor → browser print; `/triage` (the ingestion path that
  actually creates `document` rows); `/mandates` (mandate data rows, not
  documents).
- **No nav entry.** Records = Properties / Map / Contacts / Erf Lookup /
  Estates. Deals = Mandates / Pipeline / Viewings / Compliance. Admin =
  Triage / Dupes / Team / Settings. No Documents anywhere, and
  `app/documents/` has no `page.tsx` — it is a folder of shared components,
  so `/documents` would 404.
- **Nothing generated is kept.** Saving a mandate writes a `mandate` row only.
  No `document` row, no file, no version. "What did we send the Wilsons in
  March" is unanswerable from the OS.
- Pre-promotion commits (7 The Grove, Plot A4, Oupad) have no `document` rows,
  so their files exist but don't show. Everything still lives in the `staging`
  bucket rather than `documents` / `fica`.

### Template count, settled
Thirteen files from Bronwyn reduce to **eight generative templates plus one
annexure**: three property mandates (Exclusive/Sole, Joint, Open), Business
mandate, two sale agreements (house, plot), movables, addendum (the plain and
&-movables versions are one template with a toggle), and the PPRA disclosure
as a shared annexure with house/plot question sets. The two letterhead files
aren't templates — that's `DocumentPage.tsx`.

### Correction 1 — Sole IS Exclusive at Dream (Simon, 2026-08-06)
Flagged as a possible discrepancy because `MandateSole.tsx` prints the heading
"SOLE MANDATE" over a clause granting "an EXCLUSIVE MANDATE", and because SA
practice often distinguishes them. Simon: they are the same thing at Dream.
Not a defect. **But `mandate.type` carries both `sole` and `exclusive` as
separate enum values for one concept**, so a mandate saved under either is
invisible to a filter on the other — `/mandates` and the expiry watchlist can
both undercount. Consolidate on `exclusive` after checking production:
`select type, count(*) from mandate group by type order by 2 desc;`

### Correction 2 — the one existing template came from the wrong document
`MandateSole.tsx`'s own header: *"Structure follows Bronwyn's Business Mandate
template ... adapted for a residential / land sale. When Bronwyn ships a real
property-mandate .docx template, we adjust the clause language here in-place."*
It was a placeholder built from the **business-sale** contract while waiting
for the real masters. Those arrived 2026-08-04. Its wording is not Bronwyn's,
so replace it wholesale from
`docs/templates/dream-properties-exclusive-mandate-template.md` — editing it
clause by clause would just be guessing which lines happen to match.

### Also flagged
Schema has a `lease` agreement type but Bronwyn sent no lease or rental
template. Either a missing document or a dead enum value — ask.

### 2026-09-28: migrations applied to Bon Bon (production)
0065 document engine, 0066 contact CRM v2, 0067 sole→exclusive (0 rows: already clean),
0068 clause library seed. Applied by Simon via the Supabase SQL editor, each wrapped in
begin/commit. Verified: 9 clauses, 19 variants, 3 doc_templates, 0 sole mandates.
0068 Joint "mandate.term" corrected to match Bronwyn's final master (no words-in-brackets).
Plan 009 code cherry-picked onto main as 085982f.

### Next session starts here
1. Apply migration 0065 to Bon Bon (still not applied).
2. `select type, count(*) from mandate group by type;` then consolidate
   sole → exclusive.
3. Seed the clause library from `docs/templates/2026-final/` (Bronwyn's FINAL
   set, 2026-09-17; supersedes the August extracts), verbatim.
4. `lib/documents/resolve.ts`, then the `/documents` hub, entry points,
   editor, PDF.

DECIDED 2026-09-28 (Simon, confirmed with Bronwyn): **"plus VAT thereon" is final** and is the only seeded commission wording. VAT-inclusive commission happens in ~1 in 20 mandates a year; handle it as a per-document manual edit of the commission clause in the slice-1b draft editor (flagged on the document). Do not seed an inclusive variant.

Still needed from Bronwyn: whether the PPRA condition
report is a shared annexure or stays inside the Open mandate.

---

## DOCUMENT ENGINE — PLAN 007 + MIGRATION 0065 (2026-08-05, evening)

Bronwyn emailed thirteen master templates on 2026-08-04. Simon asked for a
documents section wired through from the other pages, with automatic fill or
an AI interview depending on how the agent arrives.

### Decisions locked with Simon
- **Output**: editable inside the OS, PDF only at finalisation. Not a DOCX
  round-trip — that would let someone edit offline and bypass the clause logic.
- **First slice**: mandates only, all four (Sole exists; Exclusive, Open, Joint
  to build). Business Mandate excluded — it sells a business, not a property.
- **Interview**: hybrid. Deterministic questions for the clause toggles the
  masters already enumerate; AI only for drafting free-text suspensive
  conditions, and it must propose from the clause library before writing new.
- **Template storage**: three layers — skeleton in code, clause bodies in the
  database, field values per document. Simon asked for a recommendation here;
  the deciding factor was his clause-library plan (Bronwyn keeps suspensive
  variants by entity type, and he intends to AI-extract more from past
  contracts). Dozens of variants per slot is a table, not a deploy.

### Domain correction worth keeping
**There is no separate Offer to Purchase.** The Agreement of Sale IS the offer
— clause 13 of Bronwyn's master makes the first signature an irrevocable offer
until accepted. One document, two signature stages, not two documents. Simon
had assumed two.

### Shipped (`c35c279`)
- `plans/007-document-engine.md` — architecture, fill-source rule (record →
  derived → asked), entry-point context table, interview split, learning loop,
  PDF recommendation with the rejected alternative and why.
- `supabase/migrations/0065_document_engine.sql` — clause, clause_variant,
  doc_template, doc_template_slot, document_draft; typed asking_price /
  commission_pct / commission_incl_vat / term_months on mandate (Phase 1
  concatenated these into `mandate.notes` as a string).
  `clause_variant.source` separates verbatim-from-master / agent-edit /
  ai-extracted / manual, and AI-extracted variants start `approved = false` so
  they cannot reach a binding document unread.
- `docs/templates/` — extracted text of all nine text-bearing masters. The
  clause library seeds from these verbatim.

### Audit findings on Phase 1 (worth knowing before extending it)
The existing mandate flow writes a `mandate` row only. It never creates a
`document` or `document_link` row, never uploads a file, and `mandate.document_id`
stays null — `actions.ts` flags this as intended Phase 2 work. Rendering is
React→HTML with a print stylesheet in `DocumentPage.tsx`; there is no PDF
engine in the repo at all.

### Next
- Seed the clause library from `docs/templates/`, clause by clause, verbatim.
- `lib/documents/resolve.ts` — the fill resolver.
- `/documents` hub + entry points + draft editor.
- PDF: `puppeteer-core` + `@sparticuz/chromium`, isolated behind
  `lib/documents/render.ts` so it can be swapped if the Vercel bundle complains.

### Open for Bronwyn (in the plan)
Commission default (5% hardcoded in Exclusive and Open, blank in Joint);
default mandate term per type; and whether the PPRA condition report appended
to the Open mandate should be a shared annexure any mandate can attach —
`lib/ppraDisclosure.ts` already models the questions, so it wants to be shared.

### Verification
SQL parse-checked with pglast (42 statements); every referenced table resolves
to an earlier migration. **Migration not applied to Bon Bon yet.**

---

## DEDUP OVER-MERGE: FALLBACK COORDINATES (2026-08-05, later)

Found during the browser verification of the source-chip fix, which is
how it should work. Simon turned DW on, clicked a pin, and got a
"market listing" panel offering eight other listings priced R895k to
R60M as the same property.

### The diagnosis (three queries, two wrong guesses)
First guess was centroid-collapsed coords — the failure mode already
documented for the WordPress scraper. Wrong: `centroid_rows` came back
0. Second guess was a shared `prcl_key`, Pezula-style. Also wrong: every
`prcl_key` was NULL. The row dump settled it — all nine rows sat on
**-34.067203, 23.064679, identical to six decimal places**, with
`geocode_source = 'exact'`.

Two defects compounding in the geo-proximity rule in
`lib/external-listings/dedup.ts`:

1. **The fallback guard was checking a label the scraper doesn't set
   honestly.** The rule excluded `geocode_source = 'centroid'` rows —
   the author correctly anticipated exactly this problem — but Dream's
   WordPress geocoder returns one fallback point for every address it
   can't resolve and stamps it `exact`. The guard never fired.
2. **The price gate had a null bypass.** `if (a.price != null && b.price
   != null) { ...ratio check... }` then `union()` unconditionally. Two
   price-on-request listings at 0m each unioned with everything present,
   bridging R895k to R60M in a single hop. The 15% ratio never got a say.

### Shipped (`7da34c2`)
- Trust coordinates over labels: a point claimed by more than
  `COLLISION_LIMIT` (3) rows is a fallback whatever it calls itself, and
  those rows are excluded from proximity clustering. They can still merge
  on lightstone id / prcl_key / normalised address — the signals that
  carry evidence.
- Absent price now means **don't cluster**, not cluster freely.
- Same collision guard applied to the 150m property-match fallback, which
  would otherwise have attached every collided row to whichever of our
  properties sits nearest the fallback point. That one hadn't bitten yet
  but is the same defect.
- **`lib/external-listings/__tests__/dedup.collision.ts`** — first test in
  the repo. Built from the nine real rows. `npm run test:dedup`. Uses
  `npx --yes tsx` deliberately: adding tsx to devDependencies would
  desync `package-lock.json` and break Vercel's `npm ci`.

### Verification
- Test **fails on the old code** (nine rows collapse to 1 group) and
  **passes on the new** (9 groups). Checked by reverting both guards and
  re-running, not by assuming.
- Second assertion guards the other direction: a genuine cross-portal
  duplicate (same house, 8m apart, 1.25% price difference) still merges.
  A dedup fix that stops deduping is worthless.
- `tsc --noEmit` and `next build` green with the test file in tree.
- **Not yet run against Bon Bon.** The existing bad `dedup_group_id`
  values persist until the clustering re-runs — the fix changes how
  groups are computed, it doesn't retro-fix stored ones.

### Loose ends
- **Re-run clustering against live data** to clear the three known
  over-merged groups (`f64ed20f` 9 listings, `8ad5feea` 8, `61374105` 3).
  `rebuildDedupAndMatch` fires at the tail of every source refresh, so
  "Refresh Dream listings" on /map should do it. Confirm afterwards with
  the group-size query in this session's log.
- **The upstream cause is untouched.** Dream's WordPress scraper is
  geocoding to a fallback point and labelling it `exact`, and reading
  listing addresses out of image filenames ("C13 Updated Photos",
  "Angie", "Avril"). DW is Bronwyn's own website and should be the most
  trustworthy source on the map; it is currently the least. Own arc.
- `COLLISION_LIMIT = 3` is a judgement call. Three genuinely-identical
  coordinates is implausible for distinct properties but not impossible
  (sectional title). If real duplicates start escaping dedup, that's the
  number to look at.

---

## SOURCE-CHIP FILTERING + TREE TIDY (2026-08-05)

First session run from Cowork against the local repo over the device
bridge. Cleared the two map loose ends carried forward from 2026-08-01
and tidied the working tree.

### Shipped
- **Source chips now filter the polygon + dot layers.** `ForSalePolygon`
  gained a `source: SourceKey` field, set server-side in `app/map/page.tsx`
  (`dream_os` for OS erven, the portal for market rows). MapView derives
  `visibleForSalePolygons` / `visibleUngeocoded` and drives the
  `for-sale-fill`, `for-sale-outline` and `ungeocoded-dots` layers off
  those instead of the raw props. Closes Simon's bug: with every source
  chip off you still saw coloured parcel fills, and clicking one opened
  the market-listing panel.
- **Click-through guard comes for free.** Because the filtering happens on
  the *data* rather than via a Mapbox filter expression, the click
  handler's lookup only ever holds polygons that are actually rendered.
  A hidden polygon isn't in the lookup, so the handler bails. No separate
  guard to keep in sync.
- **OS polygons honour the Mandate chips too.** Same visibility contract
  as `visiblePins` — an OS erf whose mandate chip is off no longer paints.
- **Listener-leak fix (found while doing the above).** The
  `for-sale-fill` click/hover handlers were registered inside
  `installForSaleLayers`, which re-runs on every data change. Harmless
  while deps only changed on a refetch; a real leak once chip toggles
  re-install the layers. Handlers are now bound once behind
  `forSaleHandlersBoundRef` and read current data through
  `polyLookupRef` / `mergedPinsRef`.
- **"Erf boundaries" renamed to "Cadastral outlines"** with an inline
  caption: "Every surveyed erf + muni valuation. Not listings — unaffected
  by the Sources filter." This was the other half of Simon's confusion —
  the checkbox toggles a survey layer with its own muni-valuation popup,
  and nothing in the UI said so.

### Tidy
- Eleven macOS duplicate-copy artifacts (`MapView 2.tsx` through
  `MapView 5.tsx`, `page 2.tsx`, `property24 2.ts`, `route 2.ts`,
  `0063_no_snap_sectional_title 2.sql`) plus two raw `.eml` drops moved to
  `_to_delete/`. All were older snapshots of files git already tracks —
  nothing unique lost. **Simon still needs to delete `_to_delete/`**; the
  device bridge cannot unlink files.
- `.gitignore`: added `_to_delete/` and `*.eml`.
- `tsconfig.json`: excluded `_to_delete` (the stale copies were failing
  typecheck with TS2307 while they sit in-tree). Remove that exclude once
  the folder is gone.
- **PR #56 was already merged** (`a1bb45c`) and `0064_no_snap_large_parcels.sql`
  is on main — that loose end from last session is closed. Repo and Bon Bon
  are in sync.

### Verification
- `tsc --noEmit` green, `next build` green (49 routes). **Build was run in
  the cloud container, not on the Mac** — `next build` over the device
  bridge stalled ~10 min without writing a byte to `.next`, because webpack
  reads several thousand `node_modules` files through the mount. Source
  was tarballed, staged, then `npm ci` + build in the container. Worth
  remembering as the pattern for any future Cowork session.
- **NOT yet loaded in a browser.** Per the 2026-08-01 lesson, map-layer
  changes must be visually verified before merge. Simon to run
  `npm run dev`, open /map, zoom past z14, and toggle each source chip —
  fills and dots should appear and vanish with the chips, and with all
  four off only cadastral outlines (if that box is ticked) should remain.

### Environment notes for future Cowork sessions
- Git writes in the bridged folder leave stale `.git/*.lock` and
  `tmp_obj_*` files behind, because the mount refuses `unlink`. Every
  write op needs the locks moved aside first (`mv` within the mount
  works; `mv` to `/tmp` does not — it crosses filesystems and degrades
  to copy+unlink). Commits succeed once cleared.
- `git commit` needs `-c user.name -c user.email` passed explicitly; the
  bridge user has no git identity.
- `pkill -f "next build"` kills the calling shell — the pattern matches
  the bash -c command line itself. Bracket a character.

---

## P24 MAP INTEGRITY — DIAGNOSTIC + STAGED FIXES (2026-07-31 → 2026-08-01)

Long session. Simon opened with the fatigue signal — "we seem to be
building more code onto bugs every single session … a little bit
demoralized" — and asked to regroup rather than build. Regroup
turned into a bounded diagnostic on the /map screen that surfaced
five real bugs; four shipped, one reverted mid-arc after making the
map worse than before.

### The diagnostic (agreed with Simon before code)
Ran four checks against live Property24 + Bon Bon's DB:
- **P24 site count for Knysna area 322**: 505 houses + 32 commercial
  across 26 pages. Vacant-land + apartments branches 404 (URL
  taxonomy has changed). Bronwyn's "186 P24 listings is impossible"
  was wrong direction — 186 was undercounting, real is ~500+.
- **DB vs chip**: DB had 342 active P24 rows but the sidebar chip
  showed 186. Merged-pin count derivation collapsed many-externals-
  per-property into one and dropped standalones.
- **Wrong prices confirmed**: Uitzicht farm still R 130 304 000 after
  PR #50; Fernwood plot and Simola house shipping with
  `price === source_ref` (LLM extract returning the listing-id from
  the URL as price on POR listings).
- **JSON-LD miss rate**: 30% of drains had no JSON-LD. Those rows
  retained pre-PR-48 coords + prices from the removed fallback chain.

### Shipped
- **PR #52 — P24 map integrity bundle** (`e0ea1c8`, merged).
  Three commits:
  - JSON-LD-only price extraction. Killed the LLM `price` field from
    the Firecrawl extract schema and removed the markdown-regex +
    reconcilePrice fallback from `scrapeListingDetail`. When P24
    doesn't ship a `priceCurrency:ZAR` node, price resolves to null
    → renders as "Price on request" instead of a hallucinated
    number. `regeocode-jsonld` also now nulls stale wrong prices on
    rows where JSON-LD is absent (backfill path). Deleted
    `lib/external-listings/priceParse.ts` and the `reparse-prices`
    route — both encoded the removed logic. `inspect` route
    rewritten around JSON-LD.
  - Pagination cap 20 → 30 in `scrapeListingIndex`. Real P24 has
    505 listings across 26 pages; 20-page cap ceilinged discovery
    at ~400 URLs.
  - Source chip fix: `externalCounts` prop from page.tsx carries
    raw per-source DB counts. Chip now reads authoritative (352
    matched what SQL said) instead of merged-pin count (186).
- **PR #54 — Revert market-pin clustering** (`ff06cc5`, merged).
  The clustering commit that shipped in PR #52 didn't render (never
  tested against a real Mapbox instance before push), but its
  paired zoom-hide-market-markers effect DID work. Net: at any
  regional zoom the map showed zero market pins AND no clusters.
  Reverted the two useEffects while keeping the price + count fixes
  that landed correctly.
- **PR #55 — Migration 0063: no snap for sectional-title**
  (`3a6cc9d`, merged, applied). Root cause spotted in a specific
  screenshot: a 3-bed apartment at 3 Mount Joy lit up the entire
  Highfields estate parcel. Trigger from 0045 was grabbing the
  parent-of-scheme parcel because sectional-title units share one
  parcel with the whole scheme. Migration excludes property_type
  matching `(apartment|flat|sectional|townhouse|duplex|penthouse)`
  from both snap paths (trigger + `snap_all_to_parcels()` RPC).
  Backfill nulls prcl_key on existing rows hit by regex.
- **PR #56 — Migration 0064: no snap when parcel > 1 ha**
  (unmerged at session end; SQL applied to Bon Bon manually).
  Same underlying problem as 0063 but different symptom: at Pezula,
  eight unrelated plots from eight agencies (R2.1M through R29.95M)
  merged into ONE pin covering the whole Pezula estate. Cause:
  individual plots aren't in the cadastre; only the estate parent
  parcel is. All eight snapped to it, shared prcl_key, and the
  dedup ladder collapsed them because prcl_key equality outranks
  price-similarity. Migration adds `ST_Area(cp.geom::geography) <=
  10000` to both snap paths. Backfill nulls prcl_key on rows
  currently snapped to a parcel > 1 ha. Trade-off documented: a
  legit ≥1 ha farm listing renders as a pin instead of a polygon.

### Applied to Bon Bon
- Both 0063 and 0064 SQL blocks pasted into Studio and run
  successfully. Simon confirmed "both success".
- Regeocode-jsonld drain started (was ~25 pending mid-session).
  Needed to complete so rows whose lat/lng got rewritten to a
  parcel centroid by earlier snap pull fresh JSON-LD coords.

### Feedback moments
Simon: "we seem to be going backwards in this session" — the
market-pin clustering regression. Real correction: I shipped
clustering code that hadn't been loaded in a browser once. From
now on, before merging any Mapbox layer changes, load the app and
verify visually. Type-check + local diff-review is not enough for
map-render code where install races + layer stacking bite silently.

Simon: "im a novice so how do i open the develop menu" — session
had multiple moments where I gave Safari console/dev-menu paths
without noticing Simon's stack context. Save as user memory: not
frontend-native.

### Loose ends carrying forward
- **PR #56 not merged** — Simon applied the SQL to Bon Bon manually
  but the migration file isn't on main yet. Merge to keep the repo
  and prod DB schema in sync.
- **Regeocode drain not confirmed complete** — 25+ rows were
  pending. Needed to click "Re-geocode Property24" until 0 pending
  for the coord backfill to complete.
- **Source-chip toggles don't filter for-sale polygon layer** — a
  user with all sources off can still see coloured parcel fills
  AND clicking one opens the market-listing panel. Simon spotted
  both. Not shipped; needs a second useEffect in MapView that
  filters `forSalePolygons` by enabled sources, plus a guard in
  the click handler.
- **P24 chip UI clarity** — the "Erf boundaries" checkbox toggles
  a diagnostic layer completely independent of listing data.
  Simon was confused about what these polygons represented when
  he clicked one with all sources off. Consider renaming to
  "Show cadastral outlines" and/or dimming when no sources are on.
- **Clustering, done properly** — parked. Right implementation is
  probably to move market-pin rendering off HTML markers entirely
  and onto a native Mapbox symbol layer, so one source drives both
  cluster and unclustered display. Attempting via shadow-hiding
  HTML markers behind a cluster layer (my first attempt) was
  fragile. Load the app in a browser before shipping.
- **Vacant-land + apartments P24 index URLs** — both 404 on P24's
  current site structure. `for-sale/knysna` DOES include vacant
  land in its listing (verified via Fernwood plot 117227622 in
  DB), so we're not losing them entirely. But the four-branch
  discovery loop is doing wasted work. Worth verifying if we can
  drop the two dead URLs.
- **Individual Pezula / Belvidere / Thesen erven not in cadastre**
  — root data limitation. 0064 works around by not-snapping;
  proper fix would be importing finer-grained cadastral data for
  private estates. Separate arc.

### Debugging lessons worth remembering
- **JSON-LD prices are trustworthy; markdown-regex prices are
  landmines.** P24's markdown can contain size figures formatted
  like currency ("R 130 304 000" for a 130,304 m² farm); an LLM
  asked for `price: number` on a POR listing will return whatever
  large number it sees, including the URL's listing-id segment.
  Only trust `priceCurrency:ZAR` on a schema.org Offer node.
  Anything else, show "Price on request".
- **Snap-to-parcel needs a parcel-size sanity check.** A 1 ha
  threshold works for Knysna. In other markets the cutoff would
  differ (rural farms are legitimately 5+ ha).
- **The dedup ladder's prcl_key match outranks price-similarity.**
  If lots of unrelated listings share a prcl_key (as happens with
  parent-of-scheme parcels), they collapse regardless of price.
  Either the ladder should re-order (price gate above prcl_key)
  or (as done here) prevent bad shared prcl_key assignments at
  the snap step.

---

## AGENT DASHBOARD + PROPERTY-RECORD POLISH (2026-07-28)

Half-day arc ahead of an agent meeting Simon has this week. Two PRs
shipped — first is the agent-facing scoping, second is a visual /
data lift on the Property Record.

### Shipped
- **PR #13 — Agent personal dashboard + agent picker + Lightstone
  rename** (`0c5f6e6`). Four coordinated changes:
  - `AgentPicker` on Property Record (admin only) — dropdown near the
    hero, `assignListingAgent` server action writes
    `listing.agent_user_id` and revalidates /dashboard + /mandates.
    Only agent/admin roles can be assigned; blocks inactive users.
  - `/dashboard` splits by role: admin keeps current global 3 columns,
    agent gets "My deals in flight" + "My live listings" + NEW
    "Mandates expiring soon" (60-day window on my listings). Attention
    row also surfaces mandates expiring within 14 days.
  - `/mandates` scoped per agent via pre-fetched listing-id list +
    `.in("listing_id", ids)`. Empty-set guard uses a sentinel eq so
    PostgREST doesn't fall through to returning everything.
  - Property Record: "Fetch from Lightstone" renamed to "Order
    Lightstone report" — honest label (API declined; modal is a
    manual product picker).
- **PR #13 — Registry Stamp overlay** (same PR, second commit).
  Aubergine (#3D2645) SVG rubber stamp diagonally upper-right of
  the record plate. Three variants at first pass: REGISTERED,
  MANDATE HELD, IN CONVEYANCING. `feDisplacementMap` on turbulence
  roughens the outline. `mix-blend-mode: multiply` + 72% opacity
  mimic ink absorbing into paper.
- **PR #14 — Property Record polish** (`fe5bd01`). Cherry-pick of two
  commits that GitHub's PR snapshot missed on PR #13. Three lifts:
  - **P24 photos into the hero** — external_listing rows matched to
    this property contribute `image_url` plus gallery images parsed
    out of Firecrawl `raw.markdown`. Deduped, capped at 12, filtered
    against logos/trackers. Priority P24 → PP → DW.
  - **Compact hero** — schedule rows with null values now HIDDEN
    (six lines of "—" was noise not data). Cadastre-fallback panel
    shrunk 260→140px min-height when no polygon/photo. Compass rose
    56→32px. Saves ~120px above the fold.
  - **PREPARING + SOLD ELSEWHERE stamp variants** so every property
    carries a stamp. Priority chain now: REGISTERED > SOLD ELSEWHERE
    > IN CONVEYANCING > MANDATE HELD > PREPARING.
  - **NewPropertyForm coords field** — optional "lat, lng" input on
    /properties → + New property. Garden Route bbox validation
    rejects mistyped Cape Town numbers. Passed to `createProperty`
    via `latitude`/`longitude` (action already persisted them; the
    form just wasn't wired).

### Diagnostic exchanges (no code)
- **Polygon rendering deep-dive**. Simon didn't understand when
  polygons render vs dots vs nothing. Explained three layers (erf
  outlines from cadastral_parcel, for-sale polygons from
  OS/P24/PP listings with prcl_key, dots from ungeocoded P24/PP)
  and the stage progression: address → geocoded → cadastre-snapped.
  Diagnostics showed his 175 active P24 rows split as 99 polygons /
  56 dots / 20 invisible — healthy 57% snap rate given how sloppy
  Firecrawl address extraction is.
- **The Alexandra case**. Property "The Alexandra" at 30 Glen View
  Road exists on P24 + Dream's website but no OS pin, no polygon,
  no photos on the record page. Root cause: no OS property record
  existed. UI to create one already existed on /properties as
  NewPropertyForm (Simon had forgotten), but missing lat/lng input
  meant new records landed invisible on the map. The coords field
  in PR #14 closes that loop. Path A (SQL insert for immediate
  demo) documented in-thread.

### Design lesson (added to `dream-design-language` memory)
- Aubergine `#3D2645` is now the ONLY colour for registry ink stamps.
  Off the four brand accents on purpose so stamps read as a
  different medium. Documented in
  `app/properties/[id]/RegisteredStamp.tsx` header.

### Loose ends
- **"View as agent" preview for admins** — not built. Would let
  Simon demo any agent's dashboard without switching accounts.
  ~30 min if we build it.
- **The Alexandra manual creation** — Simon needs to run the SQL
  insert + click Find ERF + click Refresh Property24 to complete
  the demo setup.
- **Bronwyn's mandate/OTP templates** — still awaited (blocks
  document vault).
- **Firecrawl upgrade** — still not made (blocks P24 backfill).
- **Housekeeping bundle** — still deferred.
- **Commission tracker** — Simon deferred to later.

---

## VALUATION ROLLS + MUNI DATA REBUILD (2026-07-27 evening)

Long single-session arc: replaced the stale ArcGIS "..._Test" Layer 58
valuation mirror with the authoritative published Knysna Muni PDFs (Full
General Valuation Roll + Supplementary Rolls). Triggered by a
credibility check on Erf 1453 — external agent's report said the muni
valued the property at R 9,145,000, our data showed R 4M (then R 6.1M
after the multi-tariff split from earlier today). Turned out the ArcGIS
endpoint hadn't been edited since **2023-02-07** — 3.5 years stale.

### Shipped
- **PR #5 — Ingest Knysna Muni Valuation Roll PDFs** (`e777731`).
  7-phase build in one branch:
  - Migration 0050: `valuation_roll_upload` table, extends
    `muni_property` (+ owner, roll_upload_id) and `muni_valuation`
    (+ sec_78, effective_date, comment, note, upload_kind, is_marker).
    New `muni_property_public` view strips owner for staff-only reads.
  - `lib/valuation-rolls/`: pdfjs-dist coordinate-aware column bucketing
    parser. Full GV adapter (12 cols) and Supplement adapter (16 cols
    incl. SG21 + Sec 78 + Eff date + Note). Both verified against real
    PDFs — Full GV 22,773 rows in 7.7s, Supplement 4 431 rows in 1.7s.
  - `lib/valuation-rolls/apply.ts`: idempotent upsert. Full GV mints
    synthetic sg_number `GV:erf:ptn:unit:TOWN` when no ArcGIS SG21
    exists, else re-uses it. Supplements key directly on SG21. Purges
    arcgis rows for touched SGs.
  - `/api/valuation-rolls/{upload,:id/parse,:id/apply}` three-step API.
  - `/admin/valuation-rolls` — list + upload form + detail with parse
    preview + Apply button. Linked from `/settings`.
  - `/api/muni/import` Layer 58 pass now identity-only (kept for suburb
    bootstrap; valuations owned by uploads).
- **PR #6 — DOMMatrix polyfill for pdfjs on Vercel Node** (`272e1b7`).
  pdfjs-dist v6 references DOMMatrix / Path2D / ImageData at module
  load. Vercel serverless Node doesn't ship them; local Node 20+ does.
  Minimal no-op polyfills in `lib/valuation-rolls/parser.ts` —
  ~30MB cheaper than installing @napi-rs/canvas.
- **PR #7 — Bundle pdfjs worker for Vercel serverless** (`3b96677`).
  After DOMMatrix fix, "fake worker" bootstrap failed to find
  `pdf.worker.mjs` in `.next/server/chunks/`. Fixed via side-effect
  import + bare workerSrc specifier + `outputFileTracingIncludes` in
  `next.config.mjs` to force-include both files at build time.
- **PR #8 — Dedupe muni_property by sg_number in Full GV apply**
  (`cdd9270`). Two stacked bugs surfaced during the first Apply on
  Vercel: (a) `syntheticSg` didn't include `unit` → sectional-title
  schemes collapsed onto one key, (b) GV has ~43 legitimate duplicate
  rows across ~22.7k. Both fixed by including `unit` in the key AND
  accumulating into `Map<sg_number, propRow>` before batching so
  ON CONFLICT DO UPDATE always sees unique targets per batch.
- **PR #9 — Clickable erf polygons on the map** (`fcfe2a1`). Before:
  clicking a bare erf polygon (no OS/P24 overlay) did nothing. Added
  click handler on `parcels-fill` with priority guard against
  `for-sale-fill`/`ungeocoded-dots`. Fetches
  `/api/muni/at-erf/:prclKey` and renders a compact Mapbox popup at
  the click point.
- **PR #10 — Match erf-click by (erf, town) not sg_number digits**
  (`12eae04`). PR #9's API was doing digits-only substring match on
  sg_number, which works for ArcGIS SG21 but MISSES GV-synthetic
  keys. Parcels vector tile already exposes `tag_value` + `maj_region`;
  now passed as `?erf=&town=` query params and matched via
  `erf_number = tag_value AND town_name ILIKE maj_region`.
- **PR #11 — Map default framing to Buffalo Bay → Noetzie coastal
  strip**. Still open at session end. `INITIAL_BOUNDS` constant with
  fitBoundsOptions passed to `new mapboxgl.Map`; pin-fit-to-bounds
  effect is now a no-op.

### Applied to Bon Bon
- Migration 0050 run in Studio.
- `valuation-rolls` Storage bucket + 4 RLS policies created via SQL.
- **Full GV uploaded and applied**: 22,635 properties + 22,660
  valuations + 81 markers. Erf 1453 KNYSNA (JWH Trust, 2 Panorama
  Road, 722 m²) now correctly shows **R 9,145,000** in
  `/erf-lookup`, the map popup, and any Property Record that joins it.
- **Supplement 4 uploaded and applied**: 431 supplemental rows on top
  of the GV baseline.
- **Cleanup**: `delete from muni_valuation where upload_kind='arcgis'`
  purged stale ArcGIS rows that were still summing into the map
  popup for erven where the GV apply couldn't reuse the ArcGIS sg
  (typically because Layer 58 suburb didn't match GV town).

### Loose ends
- **PR #11 not yet merged** — default map framing.
- **`apply.ts` hardening**: purge arcgis muni_valuation by (erf, town)
  not just by SG number, so a future ArcGIS Layer 58 re-enable can't
  silently repollute. Not urgent (Layer 58 write is disabled).
- **Bronwyn's mandate/OTP templates** still awaited — blocks the
  document-collateral vault design (discussed but not built).
- **P24 drain queue**: 256 URLs still pending. Blocked on Firecrawl
  upgrade decision (Free tier at ~117 credits remaining vs 256 needed).

### Debugging lessons worth remembering
- **pdfjs-dist v6 on Vercel serverless Node** needs both the
  browser-API polyfills AND the worker file explicitly traced (bundled
  by dynamic path resolution otherwise fails). See
  `lib/valuation-rolls/parser.ts` + `next.config.mjs` for the pattern.
- **Knysna Muni ArcGIS FeatureServer** at
  `services3.arcgis.com/Kb9idbuOS9ILjfGd/.../Property_Ownership_Deeds_Test`
  is a TEST endpoint (name literally contains `_Test`), last edited
  2023-02-07. Never authoritative for valuations — the published PDF
  rolls always are.
- **PDF column extraction via pdfjs** — use `transform[4]` (x-coord)
  for column bucketing, not whitespace splitting. `pdftotext -layout`
  merges adjacent columns (e.g. `HILL STREET914`) that pdfjs
  correctly separates by coordinate.

---

## MANDATE WATCHLIST + APP SETTINGS (2026-07-27 afternoon)

- **PR #2** (`798c4b0`) — new `/mandates` staff page: four buckets
  (Expired unresolved, Expiring in N days per configured threshold,
  Unknown expiry). Type filter chips (URL-synced). Row → Property
  Record. Only active-listing mandates (draft/live/under_offer).
- New `/settings` admin page + `app_setting` table (jsonb kv). First
  setting: `mandate.expiry_window_days` (default `[30, 60]`).
  Typed `getSetting`/`setSetting` helpers with defaults registry.
- Migration 0048 applied.

## ERF LOOKUP (2026-07-27 afternoon)

- **PR #3** (`e13058e`) — new `/erf-lookup` staff page. Search by
  ERF number (all-digits) or address (space-separated tokens).
  Suburb filter dropdown. Detail card with cadastre / valuation /
  zoning / deed / bond fields. Closes the "cold enquiry" gap where
  muni data was only visible via Property Record hero.

## MUNI VALUATION SPLIT (2026-07-27 afternoon)

- **PR #4** (`e300854`) — bug fix: Knysna Muni Valuation Roll is
  1:many per SG21 (a single erf can be rated under multiple tariff
  categories). Old importer upserted on sg_number and dropped all
  but one. Migration 0049 split `muni_valuation` into its own table
  with `(sg_number, tariff)` unique constraint. Reads sum for
  headline, expose breakdown for detail. Rewrote `muni_lookup_at_point`
  to SUM across child rows.
- Also this batch: disabled ArcGIS Layer 58 valuation writes (kept
  identity slice for suburb bootstrap only).

## P24 SOURCE OF TRUTH + DRAIN QUEUE (2026-07-27 morning)

- **PR #1** (`ee724c3`) — DW hidden by default on map. Panel primary
  sorts P24 > PP > DW. Migration 0047: `geocode_source` column;
  dedup clusterer excludes centroid-fallback rows from 20m geo rule
  (fixes unrelated Leisure Isle listings collapsing into one dedup
  group). Wired `rebuildDedupAndMatch` into P24 refresh tail. Drain
  queue button auto-loops P24 refresh past Hobby 60s ceiling.

---

## /IMPROVE AUDIT + PLANS 001–006 SHIP (2026-07-26 → 2026-07-27)

Two-day arc: ran `/improve` at commit `f3b6711`, six plans emerged, all
executed via isolated-worktree subagents with reviewer diff-check. Also
a long Property24 debugging thread and a Vercel Hobby-plan gotcha
discovery worth remembering.

### Plans shipped
- **001 Parallel signed URLs** — Property Record fetches document URLs
  in parallel instead of sequential await. Merged `daf44f0`.
- **002 Prompt-injection hardening** — extract path sandboxes untrusted
  document content; auto-commit gated on `ingest_batch.auto_commit_allowed`.
  Merged `46f6811` + `d994154`. **Migration 0043 pending Studio apply.**
- **003 Lead Inbox v1** — `/inbox` screen surfaces email-sourced enquiries
  as leads (not raw batches). TopBar entry between Overview and Map.
  Merged `a5e0dff` + `6d3bfc0`.
- **004 Firecrawl Property24 scraper** — new `external_listing` source.
  Weekly cron `0 5 * * 1` UTC. Admin "Refresh Property24" button. Merged
  `dd17bd2`. `FIRECRAWL_API_KEY` set on Vercel.
- **005 Cadastral polygon shading** — `/map` for-sale properties render
  as shaded ERF polygons instead of pins. `market` state = gold fill.
  Merged `f4af39e` + `49e9c45`. Migration 0045 APPLIED (task #70).
- **006 Contact CRM** — `/contacts` party search + role timeline.
  Multi-field OR search (name, entity, email, phone, ID), URL-synced,
  paper-hairline aesthetic, POPIA-safe masked IDs. Merged `86baf7f` +
  `d04a3c6`. Migration 0046 APPLIED 2026-07-27 (pg_trgm indexes live).

### Property24 debugging saga (mid-arc)
Firecrawl adapter had three compounding bugs surfaced by real Knysna data:
1. **Wrong area code** — was pulling from area 468 (Beaufort West). Fix:
   area 322 (verified Knysna). URL regex also matched 5-segment paths
   and captured suburb-code as listing-id; real URLs are 6 segments.
2. **Coord hallucination** — Firecrawl's LLM-structured extract fabricates
   plausible-looking lat/lng (Simola listing pinned near Wilderness).
   **Fix**: removed lat/lng from Firecrawl extract schema, use Mapbox
   forward-geocode with Garden Route bbox validation +
   `centroidForArea()` fallback. `/api/sources/property24/regeocode`
   one-shot backfill endpoint fixed existing bad rows.
3. **Silent Vercel deploy skip** — hourly cron `0 * * * *` violated
   Hobby plan's daily-cron cap. Vercel silently rejected every push for
   ~4 hours. Discovered via `vercel --prod` CLI: "Hobby accounts are
   limited to daily cron jobs." Reverted to daily `0 5 * * *`, then
   weekly `0 5 * * 1` once the URL queue was drained. Saved as memory
   `vercel-hobby-cron-cap`.

Two migrations shipped for P24: **0044** (URL queue) APPLIED (task #66),
**0045** (external_listing prcl_key auto-snap trigger) APPLIED (task #70).

### Map polygon layer install (plan 005 stability fix)
Polygons repeatedly disappeared / basemap flickered because the layer
install effect subscribed to `styledata`, which fires many times per
second during interactions. Fix: switch to `style.load` (one-shot on
genuine style change). Also deduped `forSalePolygons` by `prcl_key`
with OS-wins priority (Mapbox rejects match-expression with duplicate
branch labels). Saved as memory `mapbox-style-load-not-styledata`.

### Batch-attach ERFs enhancement
"Geocode all" button on `/map` now also runs `snap_all_properties_by_erf`
and `snap_all_to_parcels` RPCs after geocoding, so newly-geocoded
properties get their `prcl_key` bound and immediately render as
polygons instead of pins. Button always visible for admins (was gated
on `stats.missing > 0`, invisible after all 19 OS properties had coords).

### Env changes (Vercel)
- `FIRECRAWL_API_KEY` — added
- `CRON_SECRET` — already present, reused
- No new secrets for plans 001, 003, 005, 006

### Migrations pending Bon Bon's DB
Apply in order via Supabase Studio:
- **0041** partial unique erf index (from 2026-07-25 arc)
- **0042** erf sg_number (from 2026-07-25 arc)
- **0043** auto_commit_allowed gate (plan 002)

Already applied: **0044, 0045, 0046**.

### Queued for next session
- Apply 0041 + 0042 + 0043 (Simon, Studio)
- Cleanup: delete Property24 rows with bad coords/price/URL scope from
  the pre-fix runs (task #63)
- Housekeeping bundle from audit's "considered and rejected" list —
  `!.env.example` gitignore, stale `.property-hero-*` CSS, `deriveLabel`
  duplication, orphaned `SpendMeter`, silent OCR errors
- Photo classifier for embedded images in listing PDFs / EMLs (task #49)
- `/map` focus-on-property URL param (task #50)
- Muni `usage_` code lookup (task #51)
- `/map` ERF + address search box (task #52)

---

## PROPERTY RECORD REDESIGN + MUNI EXTENSIONS (2026-07-25)

Session focus: turn the Property Record from a generic SaaS card into
a specific cadastral artifact, and make the muni mirror pull its
weight.

### Muni disambiguation (0042_erf_sg_number.sql)
- Real bug on 12 Eagles Way: ERF 2934 rendered TWO muni cards — one
  for the actual Heads property, one for a Sedgefield Erf 2934 that
  happens to share the number. Erf numbers aren't unique across the
  muni; suburbs are.
- Fix: `erf.sg_number` column (nullable) storing the full SG21 code
  when the erf was attached via muni-picker. Query joins muni_property
  by SG first, falls back to erf_number for legacy rows.
- `attachErfToProperty` accepts `sg_number` and backfills on unique-
  conflict so re-picking a Muni row from an existing erf populates the
  SG on the existing row.

### Muni panel: render every field
- Panel now surfaces the full column set from `muni_property`: town,
  suburb hint, muni_erf_code, valuation-roll area (as cross-check when
  it differs from extent), declared use, sectional-title flag,
  descriptions, prev deed, bond info, sectional scheme. Empty fields
  render nothing; rich records show more.

### Compact layout pass
- Navy header padding + hero-row margins + stats-card gaps + transfer-
  card padding all tightened. When a preparing transfer has no
  parties + no agreement, the 3-column empty grid collapses to a
  single-line placeholder.

### Property Record redesign (cadastral document aesthetic)
The record now reads as a working title-deed / valuation-roll extract,
not a SaaS card. Six moves:

1. **Registry Stamp** — gold-bordered identity block, JetBrains Mono
   at 38px for the ERF, hairline internal rule, deed + SG below.
   Real SA title-deed reference-block format. Signature move.
2. **Muni valuation headline** — 34px Inter tabular, mid-page anchor.
   What Bronwyn reaches for in pricing conversations.
3. **Cadastre + Schedule two-column row** — Schedule is a proper
   hairline-ruled deed schedule. Primary rows first (extent, zoning,
   ward, suburb, type/use, ownership); secondary rows (prev deed,
   deeds office, registered date, bond, sectional) hidden when null.
4. **Cadastre panel NEVER a black rectangle** — polygon on satellite
   when bridged; CSG-diagram placeholder (compass rose + hatched
   paper + coords) when not. Then further improved: **photo primary**
   when the record has photos, since agents care about the house
   more than the boundary. Always-visible "View on map" pill in the
   bottom-left pivots to /map.
5. **Municipal Record panel REMOVED entirely** — every field folded
   into the Schedule inside the plate. One source per fact.
6. **--paper surface** — subtle vellum wash (`#FBF9F4`) with warm
   hairlines. Ownership timeline + deal card inherit the paper
   aesthetic so the whole page reads as one document. New tokens:
   `--paper`, `--paper-mute`, `--paper-line`, `--stamp` (reserved for
   a future REGISTERED red-ink overprint).

Deal card moved from parallel column to a wide strip BELOW the plate.
Actions (Fetch from Lightstone, Find ERF from Muni) folded INTO the
identity block via `actionsSlot` — they belong to the identity, not
floating in an unattached bar above.

### ERF lookup fuzzy matching
19 Glenview Road returned zero muni matches despite existing. Muni's
street_name field is inconsistent about word breaks and abbreviations
("GLENVIEW ROAD" vs "GLEN VIEW RD" vs "GLENVIEWRD"). New strategy:

- Two parallel broad fetches: contains-first-word + short-prefix
- Merge, dedupe by SG, then normalise-and-score in-process
- Compact form strips spaces and street-type suffixes on BOTH sides —
  all variants collapse to the same key
- Score bands: 100 = exact root match, 40+ = shared prefix ≥5 chars
- Handles Road/Rd, Street/St, Avenue/Ave, Drive/Dr, Lane/Ln, Close/Cl,
  Crescent/Cres, Boulevard/Blvd, Way, Park, Place/Pl, Square/Sq,
  Court/Ct, Loop, Circle/Cir, Terrace/Ter, Ridge, View, Heights/Hts,
  Alley/Al, Walk, Mews. Confirmed working.

### Ship
- `supabase/migrations/0041_erf_unique_null_portion.sql` — partial
  unique index (Postgres NULL != NULL edge case caused ERF 2934 dup)
- `supabase/migrations/0042_erf_sg_number.sql` — nullable SG column
  + partial index on non-null values
- `app/properties/[id]/PropertyHero.tsx` — full rewrite around
  Registry Stamp + Schedule + photo-primary visual + map pivot
- `app/properties/[id]/page.tsx` — muni fallback logic, schedule
  builder, muni panel removed
- `app/properties/[id]/actions.ts` — attachErfToProperty accepts
  sg_number, backfills on conflict
- `app/properties/[id]/ErfLookup.tsx` — passes SG when attaching
- `app/api/erf-lookup/route.ts` — fuzzy street-name matching
- `app/globals.css` — --paper token family, Registry Stamp styles,
  Schedule table styles, cadastre-fallback with compass rose, hero-
  photo, hero-map-pivot pill

### Not built this arc
- Migration 0041 + 0042 SQL still needs to be applied to Bon Bon's DB
  (Simon has the DDL; apply via Studio at his convenience)
- Photo classification for embedded images in listing PDFs / EMLs —
  many properties (like 15 Eagles) have listings + correspondence
  attached but no `doc_type='photo'` records, so the new photo-primary
  hero can't show anything for them yet
- Focus-on-property support on /map — "View on map" pill currently
  just opens /map; extending MapView to accept `?focus=<id>` and pan
  there is a separate task
- The muni's `usage_` field is a numeric code ("27") without a lookup
  table; renders as "use 27" in the valuation subtitle and "Erf · 27"
  in Type/Use. Cosmetic; needs the muni code map or LLM interpretation

---

## INTAKE EMAIL: SWITCH FROM POSTMARK TO RESEND (2026-07-24)

Discovered mid-session that the intake email flow had never actually run.
Bronwyn forwarded two St James Hotel emails to `intake@dreamproperties.app`
and nothing landed. Root cause was compound:

1. **Migrations 0022 and 0023 were never applied** to Bon Bon's DB (audit
   query showed everything 0024→0033 applied but 0022/0023 skipped, which
   is why `ingest_batch.sender_email` didn't exist and the webhook errored
   on insert). Applied both, plus a new **0034_provider_message_id.sql**
   that renames `postmark_message_id` to `provider_message_id` for the
   provider switch. Combined SQL was pasted straight into Studio.
2. **Postmark was never signed up for.** The webhook code shipped
   2026-07-08 assumed Postmark as the MX + inbound-parse provider, but the
   Postmark account + DNS never got done. Emails to
   `intake@dreamproperties.app` had nowhere to land — Simon's outbound
   SMTP silently queued them because MX was unset, so no bounce.

Switch: **Resend** for inbound (already using Resend for outbound admin
alerts, so one-vendor consolidation). Trade-off: Resend's inbound webhook
only delivers metadata; we make follow-up API calls to fetch the email
body + attachment bytes from signed CDN URLs. More network hops per
email but a cleaner mental model.

### Ship
- **`lib/resend/inbound.ts`** — thin client: `retrieveReceivedEmail(id)`,
  `listReceivedAttachments(id)`, `fetchAttachmentBytes(url)`, and a
  `fetchInboundEmailComplete(id)` helper that pulls the email + attachment
  list in parallel. Uses `RESEND_API_KEY` (already on Vercel).
- **`app/api/intake/email/route.ts`** — rewritten. Svix signature
  verification (svix npm package, ~90 KB, no crypto reimpl). Webhook
  envelope has `type: "email.received"` + `data.email_id` + attachments
  metadata; body + real from-address come from the follow-up API fetch.
  Idempotency: `provider_message_id = 'resend:<email_id>'`. Everything
  downstream (sender allow-list, fuzzy match, batch insert, classify) is
  unchanged behaviour.
- **`0034_provider_message_id.sql`** — rename column + comment. Applied
  same time as 0022/0023 catch-up.
- **`svix ^1.99.1`** added to package.json.

### Env vars to add on Vercel
- **`RESEND_WEBHOOK_SECRET`** — from Resend dashboard when the inbound
  webhook is created. Signs the payload; we verify with svix.
- (`RESEND_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` were already set.)
- (`INTAKE_WEBHOOK_TOKEN` is now unused — safe to remove.)

### Resend dashboard setup (Simon's side)
1. Domains → `dreamproperties.app` added, region eu-west-1 (Ireland).
2. DNS records at the domain registrar:
   - DKIM TXT (`resend._domainkey`)
   - SPF MX + TXT on the `send.` subdomain (outbound return-path — doesn't
     touch main mail routing)
   - DMARC TXT (optional)
   - **Inbound MX on the root domain** — Enable Receiving toggle reveals
     this record; needs to be added and verified before Resend accepts mail
     at `intake@dreamproperties.app`.
3. Webhooks → new webhook for `email.received` event, POST to
   `https://dreamproperties.app/api/intake/email`, copy signing secret to
   Vercel as `RESEND_WEBHOOK_SECRET`.

### Not built this arc
- Reply email confirming triage URL (still parked from the original ship).
- Auto-extract on inbound. Bronwyn triggers bulk-extract from /triage; the
  extract path still needs a service-role auth refactor.
- Removal of the now-unused `INTAKE_WEBHOOK_TOKEN` from Vercel — cosmetic.

### Queued to verify
Once Resend DNS verifies and `RESEND_WEBHOOK_SECRET` is set, Simon forwards
the two St James emails again. Expected: two batches in `/triage` with the
gold "via email" pill, one new "The St James Boutique Hotel of Knysna"
property record created by the first email, second email fuzzy-matches to
that record. Bulk-extract → commit → docs land on the property.

---

## LIGHTSTONE STRATEGY: PORTAL STAYS, LINE ITEMS MIGRATE (2026-07-22)

Resolves the open "should we sign up for Lightstone API?" question. Lightstone
quoted R5k/month — mismatched to Dream's real volume (~30 Property Reports/
month portal). The pivot: keep the Property Report on the Lightstone portal
(SIE/PIP flags + free personal history list have no market substitute); migrate
the discrete paid line items (DOT, title-deed, CIPC, trust) to source-direct or
a single no-subscription reseller; build inside the CRM the things no vendor
covers well (team-wide report history, boundary-aware comparables, mandate-
expiry and new-listing alerts).

No code shipped this arc — it's the strategy record. Follow-up ships queued
below.

### Discovery (Bronwyn's 2026-07-22 workflow reply)
Team collated: Bronwyn + Jo, referencing Vanessa, Angie, Candy.
- 5–10 Property Reports/week normal; up to 100/week during targeted road
  trawls (buyer wants front-row, team pulls neighbour reports across a
  whole road to find contactable owners); ~30/month average.
- Full-bundle pull every time — because they never knew granular facets
  existed, not because they want the full bundle.
- Personal history list is load-bearing: pay once, view forever. Vanessa
  relies on it daily.
- Portal reliability varies by user: Angie 3× logins avg, Vanessa never
  logs out, Candy fluent with map search. Configuration/skill variance.
- Comparables considered unreliable in Knysna (conflates neighbouring
  estates, averages plots+houses). **Never shared with buyers.**
- Separate paid line items beyond Property Report: **DOT** (Deeds Office
  Tracker — pending-registration status), title-deed one-offs, CIPC
  (company/director), trust searches.
- Bronwyn confirmed erf-numbered map is landing: "will alleviate guess
  work" when trawling a road.

### Vendor pivot (from `lightstone-line-item-migration.md` co-work brief)
- **Property Report** → **stays on Lightstone portal.** SIE/PIP flags have
  no confirmed market substitute; history list is best-of-breed.
- **DOT + title-deed** → **Lexis WinDeed** (pay-per-search, no
  subscription, one shared team login). ~R24.21 ex VAT / DOT search;
  ~R21.65–R25.67 incl VAT / title-deed search. **DeedsWeb-direct** as the
  R19 / R109 floor if we ever wrap deeds calls inside the CRM.
- **CIPC** → **direct to CIPC** (BizPortal / e-Services). R30 full
  electronic disclosure. Habit change only, no vendor needed — the
  clearest saving in the exercise.
- **Trust** → stays FICA pack + conveyancer. Master's beneficial-ownership
  register (trustonline.justice.gov.za) is restricted access, not a self-
  service agent tool.
- **Deeds-transfer alerts** on a short watchlist (past clients / expired
  mandates, ~20–30 properties) → **WinDeed Alerts** at ~R5.31/property/
  month ex VAT. Everything else uses our own new-listing scrape alerts —
  earlier and more actionable.
- **API path (future, only if we integrate at scale)** → **SearchWorks
  OneHub** (via Standard Bank) or **AfriGIS Property Ownership & Deeds
  API**. Both are true REST/JSON, both quote-gated — no numbers yet.

### Build inside the CRM (what no vendor covers)
- **Team-wide "pay once, view forever" report history.** File every
  purchased PDF (Lightstone Property Report, WinDeed DOT, deed copy)
  against the property record, viewable by all agents indefinitely. Once
  this exists, the pay-per-view objection to *any* provider disappears.
  Pairs with the intake webhook + document pipeline.
- **Boundary-aware buyer-shareable comparables.** Built from scraped
  `external_listing` (Dream nightly; P24 + PP queued) plus our own
  `transfer` records with proper Knysna suburb/estate boundaries and
  plot-vs-house separation. Removes the strongest single reason to pull a
  Property Report. Target = something Bronwyn shares with buyers, which
  Lightstone can't offer.
- **Mandate-expiry alerts.** Pure internal DB.
- **New-listing alerts on watched areas/estates.** Reads from
  `external_listing`. Earlier signal than a deeds-transfer alert.
- **Erf-numbered map.** DONE (cadastre marathon 2026-07-09 → 2026-07-10).

### Queued from this arc
- **CIPC-direct habit note to Bronwyn** — no-regret action this week.
- **WinDeed account setup** — Bronwyn/Vanessa's action; small.
- **Team-wide report history feature** — small ship, high value.
- **Boundary-aware comparables model** — the largest Lightstone-reduction
  lever; medium ship.
- **Deeds-transfer alerts** on the short watchlist — small ship via
  WinDeed Alerts wrapper or (if the CIPC-direct wiring goes well)
  DeedsWeb-direct.
- **Mandate-expiry alerts** — small ship, DB-only.

### Not built this arc
The pivot itself. Four memory files added (`dream-team-roster`, `dream-
lightstone-usage`, `dream-comparables-approach`, `dream-deeds-vendor-map`)
+ `lightstone-api-pending` updated to reflect the R5k/mo decline. Co-work
research deliverable saved at `Dream Knysna Properties/lightstone-line-
item-migration.md`.

---

## MARKET CACHE AUTO-INVALIDATION ON REGISTRATION (2026-07-14)

Closes the last "manual force-refresh required" hole in the Lightstone cache
layer. When one of our own transfers advances to `registered` — through any
path — the four permanent-facet cache columns on the matching
`market_property` row are nulled automatically, so the next
`getMarketFacet()` call for `deeds` / `ownership` / `last_sale` /
`comparables` misses and re-fetches under the budget. AVM has its own
12-month TTL and is intentionally left alone.

### Ship
- **`0032_register_invalidate_market_cache.sql`** —
  `invalidate_market_cache_on_register()` trigger function
  (security definer, search_path=public) + `trg_transfer_register_invalidate`
  AFTER INSERT OR UPDATE OF status ON transfer. Fires when status transitions
  to `registered`; skips no-op re-sets (old.status = new.status = registered).
  Joins `transfer.property_id → property.lightstone_property_id →
  market_property` and nulls `legal_fetched_at`, `ownership_fetched_at`,
  `last_sale_fetched_at`, `comparables_fetched_at`. Silent no-op if the
  property has no `lightstone_property_id` yet (common for pre-take-on
  records) or no matching `market_property` row.
- **`lib/market/service.ts`** — top-of-file comment updated. The
  "trigger is out of scope" note was written for 0026's cache-layer ship;
  now reflects that 0032 closed it. `invalidateMarketFacet()` stays as-is
  for programmatic invalidation (still called from nothing today, kept for
  future explicit-clear UIs).

### Fires from every existing status→registered path
- `commit_batch()` (migration 0018) — title-deed evidence auto-advances.
- `merge_transfers()` (migration 0019) — winner may inherit registered
  status via coalesce from the loser's `registered_date`; safe because the
  trigger only fires when status *changes* to registered.
- Direct SQL edits, admin UIs, future manual "Mark registered" actions.

Migration to apply on Bon Bon's DB: **0032**.

### Queued next (unchanged)
See CADASTRE MARATHON section's queued list. Top item still:
erf-snap real-data pass on `/map` at z16+ to find pins on wrong parcels.

---

## CADASTRE MARATHON: CSG → VECTOR TILES → SNAP (2026-07-09 → 2026-07-10)

**The map now has erf boundaries.** Every property record has a
`prcl_key` bridge to a specific parcel in the SA Chief Surveyor
General cadastre. The whole pipeline — CSG import, MVT tile server,
Mapbox vector layer, coordinate snap — is live and rendering navy erf
outlines with parcel-number labels over the satellite basemap.

75,745 parcels imported for the KNYSNA + GEORGE magisterial districts
(the pre-1994 admin regions that CSG uses — KNYSNA covers Knysna town,
Sedgefield, Rheenendal, wider Garden Route). 7,156 of them cluster on
Leisure Isle. Every listing now bridges to a specific erf via
`external_listing.prcl_key`; every future Lightstone lookup can key
off the same identifier.

### Adjust pin + move-pin UX (start of arc, 2026-07-09 morning)
- **`0027_property_geo_manual.sql`** — `property.geo_manual boolean
  default false`. Every automated geocoder now filters
  `.eq("geo_manual", false)` so a hand-placed pin can never be
  clobbered.
- **`savePropertyPin(propertyId, lng, lat)`** admin action + drag-mode
  wiring in MapView: dragKey / pinPropertyIdRef / handlePinDropRef so
  the persistent `dragend` handler on the Mapbox marker reads current
  state without stale closures. `router.refresh()` after successful
  save.
- Preview panel gains a **Pin location** section with the `Move pin`
  CTA (renamed from Adjust pin — the whole action, not the intended
  outcome). Restyled as full-width navy CTA, 44px min-height. On drag
  entry the map `easeTo`s the pin at zoom 17 so it's unmistakable
  which pin is grabbable. The dragging pin pulses (1.4s gold ring,
  respects reduced-motion).
- Adjusted pins get a small gold dot on the marker badge + a "PIN
  ADJUSTED" chip in the preview so admins can see hand-placed pins at
  a glance.

### Erf-boundary layer shipped end-to-end
- **`0028_cadastral_parcel.sql`** (recorded — user applied) — table +
  `parcel_mvt(z,x,y)` function returning MVT bytea via ST_AsMVT.
- **`0029_cadastre_import_and_snap.sql`** — `cadastral_import_cursor`
  singleton, `upsert_parcel(...)` RPC (GeoJSON → PostGIS),
  `snap_all_to_parcels()` RPC (bulk ST_Contains + centroid update,
  respects `geo_manual=true`), `property.prcl_key` +
  `external_listing.prcl_key` + `external_listing.geo_manual`.
- **`0030_cadastre_consecutive_fail.sql`** — one column on the cursor
  for cross-batch timeout retries.
- **`0031_upsert_parcel_int_cast.sql`** — `nullif(p_parcel_no, '')::int`
  inside the function so the text parameter casts cleanly to the int
  column. Fixed the "every upsert rejects" state.
- **`/api/cadastre/import`** — resumable, cursor-driven, admin session
  OR bearer auth. Per-keyword discovery, empty-first-page skip, fail-
  forward on HTTP + ArcGIS errors, cross-batch timeout retry via
  `consecutive_fail`, per-parcel try/catch (one bad ring can't kill a
  batch), skip-town after 5 consecutive HTTP fails (stops runaway
  offset increments past a town's data), `?peek=1` returns current
  cursor state without any work, `?reset=1` wipes cursor for a clean
  restart.
- **`/api/tiles/parcels/[z]/[x]/[y]`** — MVT server via
  `parcel_mvt(z,x,y)` RPC. Handles Supabase bytea in base64 or `\x`-
  prefix hex. Returns 204 below z=14 and for empty tiles.
  `Cache-Control: public, max-age=86400, s-maxage=86400`.
- **`/api/cadastre/snap`** — standalone admin trigger for
  `snap_all_to_parcels()`.
- **MapView "Erf boundaries" toggle** — vector source pointing at
  `${origin}/api/tiles/parcels/{z}/{x}/{y}` (absolute URL — Mapbox
  picks this up more reliably than a path-only string), fill + line +
  label sub-layers, styledata re-install on basemap swap. Navy fill @
  12%, navy lines @ 95% opacity 1-3px width (bumped from muted gold
  after Bronwyn tested and saw nothing; gold + satellite basemap was
  invisible), white text labels with navy halo for TAG_VALUE at z≥17.

### `CadastreImport` panel (map rail, admin-only)
- Compact panel under the Sources chips: idle → **Import cadastre**
  button; running → batch counter + total erven + current town @
  offset + Stop / Cancel; done → green totals + snap results +
  Dismiss.
- Peek on mount via `?peek=1` so a `router.refresh()` from an unrelated
  action (Adjust pin save, Refresh Dream listings) can't hide the
  in-flight cursor and trick the admin into clicking a fresh-start
  button that wipes 11k erven of progress.
- "Done · check warnings" gold state when totalSoFar === 0 && done —
  visually distinct from real success.
- Auto-open `<details>` on warnings with URL + payload snippet, monospace
  cards with word-break so long ArcGIS error strings are readable.

### DFFE-specific quirks we had to unstick
The DFFE portal's ArcGIS Server layer rejects a lot of standard params
that other services accept. Notes for future adapters:
  - `f=geojson` + `returnGeometry=true` → HTTP 200 with
    `{ error: { code: 400 } }` inside. Use `f=json` and convert ESRI
    rings to GeoJSON MultiPolygon client-side.
  - `geometryPrecision`, `maxAllowableOffset`, `orderByFields` on
    non-OBJECTID columns → HTTP 400. Drop all three.
  - `outFields` accepts `PRCL_KEY`, `TAG_VALUE`, `MAJ_REGION` (in
    WHERE only, not outFields — weirdly). `PARCEL_NO`, `MIN_REGION`,
    `PROVINCE` return 400 when queried. Feed `maj_region` from the
    local `town` variable on upsert instead.
  - Distinct-value discovery works with `f=json + returnGeometry=false`,
    fails otherwise.
  - GeoJSON output for paged queries breaks silently past ~offset
    (town-record-count); we skip the town after 5 consecutive HTTP
    fails since DFFE returns network errors when offset exceeds data.

### Same-house merge (dedup enhancements)
- `dedup.ts` `Row` + `Prop` types gain `prcl_key`. External listings
  sharing a `prcl_key` cluster into the same dedup group.
  `matchFor(row)` ladder is now:
  `lightstone_id → prcl_key → normalised address exact →
  token-subset → geo-proximity`.
- Token-subset match: `"19 glenview" ⊆ "19 glenview road the heads"`
  triggers a match. Requires at least one house-number-shaped token
  so "the heads" alone can't latch onto every Heads property.
- **Map merge** collapses a matched external listing into its
  property's pin even when the property has no coords of its own —
  seeds the merged pin at the listing's coordinate. No more phantom
  market pin at the same address as a real record.

### Mobile responsive pass (2026-07-09 midday)
Field agents work off phones. Three screens hardened for ≤900px:
- **TopBar** collapses to a hamburger + slide-down drawer at ≤768px.
- **Map** rail becomes a fixed-position bottom sheet with a 56px peek
  handle. Preview panel goes from right-slide-in to full-width bottom
  sheet at 82vh with a 44px close control.
- **Properties list** table transforms into per-row cards via
  `display: block` + `td[data-label]::before` at ≤640px.
- Property Record: cadastral strip wraps to 2-up, header status chip
  stacks below title, photo tiles rescale.
- Viewport pinned in `app/layout.tsx` (`export const viewport`) so iOS
  Safari can't fall back to 980px or auto-zoom on input focus.

### Dream scraper geocode refinements (queued from prior arc)
Also shipped in this window (2026-07-09 midday, before the cadastre
push):
- Filename cleaner strips WordPress `-scaled`, `-eNNNNNN`, resize
  dimensions `-NNNxNNN`, and trailing photo index. Original uploads
  sort before resized variants so the pin picture stays sharp.
- `anchorForGardenRoute(address, suburb?)` replaces `anchorForKnysna`.
- Region-guard: bbox lat -34.20 to -33.65, lng 22.30 to 23.60.
- Centroid fallback for known estates (Pezula, Thesen, Simola,
  Eastford, Brenton, etc.) when Mapbox fails or returns out-of-bbox.
- One-time cleanup on every refresh nulls historical out-of-bbox
  coords. Explicit null-on-park so stale in-box pins can't survive.
- Refresh Dream listings button in the map rail (admin only).
- DW pins recoloured to Dream navy.

### Property intake email + Team screen (2026-07-08 evening, folded in)
- Postmark inbound webhook `/api/intake/email` with URL-token auth.
  Subject-prefix router: `Property:` / `Client:` / no-prefix.
  Fuzzy-match RPCs `match_property_by_address` + `match_party_by_name`
  so re-forwarded emails attach to existing records instead of
  duplicating. Migrations 0022 (source + postmark_message_id, view
  refresh), 0023 (party_id + fuzzy RPCs).
- **`/team`** screen (0024 `job_title` + `phone` on `app_user`,
  `roles.ts` with Dream tone `admin → "Director"`, admin invite via
  `service.auth.admin.inviteUserByEmail`, self-lockout guards, access
  map panel). Admin-only tab in TopBar.
- Lightstone cost controls (0026): budget cap + soft/hard threshold
  alerts to Directors via Resend, monthly rollover on the
  `lightstone_budget` singleton, per-call ledger, `market_property`
  cache (permanent for deeds/ownership/last_sale/comparables,
  12 months for AVM), spend meter on the map rail.

### Ship checklist (all in production, all applied)
Migrations: **0021 → 0031** all applied to Bon Bon's DB.

Env vars live on Vercel:
- SUPABASE_SERVICE_ROLE_KEY
- INTAKE_WEBHOOK_TOKEN
- NEXT_PUBLIC_SITE_URL
- CRON_SECRET
- RESEND_API_KEY + NOTIFY_FROM
- (LIGHTSTONE_API_BASE + LIGHTSTONE_API_KEY still stub-behind — set
  when the subscription opens)

Postmark inbound stream at `intake@dreamproperties.app` → webhook.
Vercel Cron at `0 3 * * *` hits `/api/sources/dream/refresh`.
Dream WordPress scraper + scan pipeline live and self-healing.

### Diagnostic scars (for the next Ops moment)
Half the day was spent surfacing DFFE's actual error responses in the
CadastreImport panel — `<details open>` on warnings + URL + full
`error.details` array from the ArcGIS envelope. If a future adapter
hits a similar "empty details, no clue" wall, load a curl in the
Bash tool and probe the endpoint directly — that's what finally
narrowed the `f=geojson` bug down.

### Queued for next session
- **Look at how existing properties line up with erven.** Real-data
  pass on `/map` at z16+ to spot which properties snapped correctly
  vs which need `Move pin`. Likely surfaces 5-15 properties that need
  manual placement.
- ~~**/dupes callout on Dashboard**~~ — SHIPPED 2026-07-13 (commit
  f82b869 — Director-only pair count on Overview).
- **WhatsApp conversation ingestion** — schema brief lives at
  `docs/whatsapp-schema-brief.md`. Person-anchored model
  (people/person_phone_numbers/conversations/messages/deals/
  conversation_deal_links), Meta Cloud API webhook, phone-based
  matching. Parked for a later session — a full arc in itself
  (multiple migrations + webhook + outbound send window handling +
  POPIA retention flag).
- **Doc revision dedupe** on Property Record (`normaliseFilename` +
  `byte_size`, keep newest). Still pending from prior arcs.
- **P24 + Private Property scraper adapters** — the same
  `external_listing` table + same `rebuildDedupAndMatch` pipeline;
  each adapter is a self-contained route. Blocked on portal access.
- ~~**Registered-transfer → market cache invalidation trigger.**~~
  SHIPPED 2026-07-14 (migration 0032 — see arc at top of file).
- **Force-refresh checkbox on the Lightstone Fetch modal** — the
  server already accepts `force:true` on Market facet calls; needs a
  UI toggle so an admin can bypass the cache when they know something
  changed.

---

## MARKET OVERLAYS + LIGHTSTONE COST CONTROLS (2026-07-08 evening)

Second half of 2026-07-08. Two big arcs:
  1. The map becomes a market map — Dream's own website is scraped nightly
     into external_listing, merged with our stock into one pin per physical
     listing, with per-source badges + a per-source preview panel. P24 + PP
     adapters slot into the same table when their access opens.
  2. Every billable Lightstone call is now gated by a monthly budget, cached
     in market_property, and mirrored to a ledger. Cross 80% → Directors get
     an email; cross 100% → pulls block and Directors get a second email.

### Market overlays — external_listing + Dream scraper
- **`0025_external_listing.sql`** — repo copy of the applied schema.
  `listing_source` enum (dream_website / property24 / private_property),
  `external_listing` table with source_ref, url, headline, address_raw,
  price, bedrooms, image_url, lat/lng, lightstone_property_id,
  matched_property_id, dedup_group_id, raw jsonb, first_seen/last_seen,
  active. Unique (source, source_ref). RLS: staff read + admin write.
- **`app/api/sources/dream/refresh`** — GET/POST scraper. Auth: bearer
  CRON_SECRET (used by Vercel Cron) OR authenticated admin. Fetches
  https://www.dreamknysna.co.za/knysna-properties/, regex-parses listing
  URLs, fetches each page, extracts slug + og:title + price ("R 2,730,000"
  → numeric) + address hint (og:description / h1 / image filename fallback)
  + property_type guess. Upserts on (source, source_ref). Delist path
  fetches active dream_website ids and deactivates the diff. Geocodes new
  / changed rows via Mapbox (same Knysna-anchored pattern as
  `app/map/actions.ts`). Ends every run with rebuildDedupAndMatch.
- **`lib/external-listings/dedup.ts`** — union-find clustering: same
  lightstone_property_id → same normalised address → within 20 m + price
  within 15%. Reuses an existing dedup_group_id inside a cluster so uuids
  don't shuffle between refreshes. Matches to our DB by lightstone id →
  normalised address → 50 m proximity. Never overwrites a manually-set
  matched_property_id (code note about a future override table).
- **`lib/external-listings/geocode.ts`** — Mapbox forward-geocode helper
  shared by the scraper and any future adapter.
- **`vercel.json`** — one cron: `0 3 * * *` (03:00 UTC / 05:00 SAST) →
  `/api/sources/dream/refresh`. Vercel Cron auto-attaches
  `Authorization: Bearer $CRON_SECRET` when the env var is set.
- **`app/map/page.tsx`** — fetches active external_listing alongside
  property/listing/transfer data. Builds MergedPin[] server-side:
  1) our properties with coords seed prop-{id} pins; 2) externals with
  matched_property_id attach to that pin (adds to sources[]);
  3) remaining externals with dedup_group_id cluster into grp-{uuid} pins;
  4) singletons become ext-{id} pins. Externals without any coord anchor
  are skipped (geocode fills them next run).
- **`app/map/MapView.tsx`** — merged-pin rendering. New rail sections:
  Sources chips (Our listings / Dream website / Property24 / Private
  Property) with contribution counts + a "Split duplicate pins by source"
  toggle that fans a merged pin into per-source markers at the same coord.
  Pin styling: our stock keeps mandate colours, market-only pins get a
  dashed white pill on grey pointer, merged pins carry a compact source
  stack (`OS DW P24 PP`) beneath the price. Preview panel rebuilt:
  our-property block on top when we own it, "Also listed on" per-source
  table with price + agency + Open-arrow outbound link, and a "Prices
  differ across sources" flag when the range spans >5%.
- **CSS additions** — .source-chips, .source-chip.on, .source-stack,
  .source-dot palettes (navy / gold / magenta / green), .price-pin.market
  (dashed white).

### Lightstone cost controls — gateway + cache + budget cap + alerts
- **`0026_lightstone_cost_controls.sql`** — repo copy. Three tables:
  * `lightstone_budget` singleton (id bool PK check id) with
    monthly_call_budget (default 200), soft_warn_pct (default 80),
    month_key, alerted_soft, alerted_hard.
  * `lightstone_usage` ledger — every call lands one row (billable,
    cache_hit, blocked, http_status, error, user_id, our_property_id,
    lightstone_property_id, generated month_key). Partial index on
    (month_key) where billable AND NOT cache_hit AND NOT blocked so the
    "how many billable calls this month" count is O(1).
  * `market_property` — per-facet json + per-facet fetched_at (address /
    legal / land / owners / last_sale / comparables / avm).
  RLS: budget + usage admin-only; market_property staff-read + admin-write.
- **`lib/lightstone/gateway.ts`** — the single billable-Lightstone entry
  point. `guardedGet(path, meta)` with meta.endpoint + optional billable
  (default true) + userId / ourPropertyId / lightstonePropertyId context.
  Month rollover: if `month_key` on the budget row is stale, reset it plus
  both `alerted_*` flags BEFORE the count check. Non-billable calls skip
  the meter but still ledger. Billable calls: count → block if >= cap
  (insert `blocked=true, billable=false`, throw `BudgetReachedError`) →
  otherwise do fetch, ledger the call, re-read count, fire notifyAdmins on
  first cross of soft_warn_pct and hard cap (each once per month). Exports
  `getBudgetSummary()` for the map spend meter.
- **`lib/lightstone/live.ts`** — refactored. Every facet call now
  routes through `billableFacet(path, { endpoint, lightstonePropertyId })`;
  Property Search is `freeCall(...)` with `billable:false`. apiBase /
  apiKey / raw fetch moved into gateway.ts.
- **`lib/notify.ts`** — `notifyAdmins(subject, bodyText)`. Fetches active
  admin emails (service role), sends via Resend REST (no SDK). Fail-soft:
  logs to console and returns without throwing if RESEND_API_KEY or
  NOTIFY_FROM aren't set, or if no active admins have emails.
- **`lib/market/service.ts`** — cache-first `getMarketFacet(lsId, facet,
  { force?, userId?, ourPropertyId? })`. Reads market_property, honours
  per-facet freshness (permanent for deeds / ownership / last_sale /
  comparables, 12 months for AVM), falls through to `guardedGet` on miss
  or force. Cache hits get ledgered with `cache_hit=true` so admins see
  the calls we saved. Upserts data + fetched_at back into market_property.
  `invalidateMarketFacet(id, facet)` for the future "new registered
  transfer" trigger.
- **`/api/lightstone` + `/api/lightstone/search`** — both catch
  `BudgetReachedError` and return **HTTP 429** with `code: "BUDGET_REACHED"`
  and the actionable message ("ask a Director to raise it"). Other errors
  still 502.
- **Spend meter** — new SpendMeter section on the map rail, admins only.
  Reads `getBudgetSummary()` server-side in page.tsx and hands the snapshot
  to MapView. Shows used/budget, a progress bar, the month key, the warn
  threshold. Palette shifts: navy on mist → gold at ≥80% → deep-red at
  ≥100% ("Budget reached · pulls paused").

### Ship checklist
Applied migrations already: **0025 + 0026** (both live in Bon Bon's DB).
Vercel env vars to add now:
- **CRON_SECRET** — `openssl rand -hex 32`. Vercel Cron auto-sends this as
  `Authorization: Bearer …` on every scheduled invocation.
- **RESEND_API_KEY** — from resend.com after verifying dreamproperties.app.
- **NOTIFY_FROM** — verified sender, e.g. `Dream OS <alerts@dreamproperties.app>`.
- **LIGHTSTONE_API_BASE** + **LIGHTSTONE_API_KEY** — set only when
  Lightstone opens the subscription.

Nothing else on the human side: cron self-registers when vercel.json
deploys, first scheduled run is 05:00 SAST the day after deploy. Or fire
a manual scrape:
```
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://dreamproperties.app/api/sources/dream/refresh
```
Response returns `{ upserted, delisted, geocoded, matched, groups, errors }`.

### Not built this arc (parked)
- Property24 + Private Property adapters. They'll write into
  external_listing under the appropriate source; the dedup pass already
  handles cross-source clustering. Slot when access opens.
- Manual override table for matched_property_id (currently the code
  respects any non-null match but a dedicated table is the durable
  version).
- Market screen consuming `getMarketFacet`. The cache is warm as soon as
  someone does a Fetch on a property; the UI to browse cached facets on
  demand (deeds history, AVM chart, comparables) is a follow-up.
- "New registered transfer → invalidate deeds/ownership/last_sale/
  comparables" trigger. `invalidateMarketFacet` exists; wiring it to
  transfer status is future.
- Refresh button in take-on Fetch modal to force-bypass the cache — the
  server already accepts `force:true`; UI wiring is small.

---

## INTAKE + LIGHTSTONE TAKE-ON + TEAM SCREEN (2026-07-08)

Full day of arcs closing the "how does work enter the system?" question. Four
migrations (0021–0024), one new webhook, one new admin screen. Property
intake is now: forward the email, records get created, everything shows up
in /triage. Team access is now: Directors invite from the app, no Supabase
Studio round-trip.

### Lightstone take-on wiring — search + propertyId capture (morning)
Continuation of the Lightstone adapter shell from 2026-07-07. Simon then
extended `live.ts` with the actual Azure API Management gateway calls
(lspsearch/v1 + lspdata/v1), added `AddressCandidate` + `PropertyRef.propertyId`
to the adapter interface, and taught the stub to return one obvious sample
candidate. My side wired the app around it:

- **`0021_lightstone_property_id.sql`** — `property.lightstone_property_id
  bigint` nullable + partial index. Reused for every future Property Data
  facet call so the live adapter doesn't have to re-resolve address text.
  lng/lat already existed (0015).
- **`/api/lightstone/search`** — admin-gated POST. Calls
  `getLightstoneAdapter().searchAddress(query)`. Returns `{ ok, source,
  candidates }`; `source` reflects whether the live env vars are set so the
  UI can badge SAMPLE.
- **NewPropertyForm** now has a compact "Lightstone lookup" panel above the
  address fields. Type an address → Search → clickable candidate list →
  picking one prefills the address (strips `[SAMPLE]`), matches the suburb
  dropdown by name, and captures the propertyId as a badge with a `clear`
  link.
- **`createProperty`** accepts `lightstone_property_id`, `latitude`,
  `longitude`, `suburb_name`. Server-side fallback: if only a suburb name
  arrives, resolves it against the `suburb` table with `ilike` — never
  invents a row.
- **`/api/lightstone`** now passes `propertyId: prop.lightstone_property_id`
  into the ref. Structured-field coalesce expanded to: `title_deed_no`,
  `extent_sqm`, `lat`, `lng`, `suburb_id` (via `ilike` name lookup), and
  `erf_number` (inserts an `erf` row if none matches). Never overwrites
  non-null. `town`/`municipality`/`province`/`postal_code`/`estate_name`/
  `scheme_name` are dropped — the full raw JSON stays on the document row.
  Filename map now handles `application/json → "json"` for the live adapter's
  per-facet responses.

### Property intake email — Postmark inbound webhook (afternoon)
Bronwyn's ergonomic path: forward a mandate email to
`intake@dreamproperties.app`, get a triage batch tied to a property record
with all attachments already classified. Zero clicks required.

- **`0022_intake_email.sql`** — `ingest_batch.sender_email` and
  `postmark_message_id` (unique index for retry idempotency).
  `v_triage_queue` refreshed to expose `source` + `sender_email`.
  `ingest_batch.source` already existed (0007) so `'email'` is a valid
  value out of the box.
- **`lib/supabase/service.ts`** — `createServiceClient()` reads
  `SUPABASE_SERVICE_ROLE_KEY`. Server-only; never touches the browser
  bundle. Used for webhook writes that have no user session (RLS would
  otherwise block them).
- **`lib/classify-batch.ts`** — factored `classifyBatch`'s internals into
  `classifyBatchWithClient(batchId, supabase)` so the webhook can pass its
  service client in. The `classifyBatch` server action in
  `app/triage/actions.ts` now thin-wraps it.
- **`/api/intake/email`** — URL token auth (constant-time compare against
  `INTAKE_WEBHOOK_TOKEN`). Postmark JSON parser. Sender allow-list against
  `app_user.email` (case-insensitive). MessageID dedupe returns the
  existing batch on retries. Creates property, batch, uploads
  `email-body.txt` + attachments (base64-decoded, 20 MB cap) to `staging`,
  runs classify. Skips auto-extract — Bronwyn triggers with the same
  bulk-extract button she uses on drag-drop batches (extract's auth
  refactor deferred as unnecessary scope).
- **`/triage` list** — new gold pill `via email` next to the folder name
  for `source='email'` rows; tooltip shows sender.

### Intake router — subject prefix + fuzzy match on both paths (afternoon)
Follow-up ship after Simon's "does the property record update as more
info arrives?" question. Answer: it didn't. Now it does. Also opened
the intake to client-first onboarding.

- **`0023_intake_router.sql`** — `ingest_batch.party_id` (nullable FK).
  `match_property_by_address(q, min_sim)` + `match_party_by_name(q, min_sim)`
  RPCs — pg_trgm similarity, top 5 results. `v_triage_queue` refreshed to
  expose `party_id`.
- **Webhook subject parser** — strips `Fwd:`/`Re:` prefixes first, then
  detects `Property:` / `Client:` / `Contact:`. No prefix → property
  (backwards compat).
- **Fuzzy resolution** — `resolveProperty` (threshold 0.55 against
  `primary_address`) and `resolveParty` (0.60 against `party.display_name`).
  Above threshold → batch tied to existing row and the commitBatch fallback
  puts new docs on that record. Below → new row created. Weaker matches
  ignored; /dupes handles the residue.
- **`/triage` list** — client-intake rows show `client via email` in the
  same gold treatment. Tooltip distinguishes property vs client intent
  plus sender. `/triage/[id]` didn't need changes — the review page was
  already generic enough to render a party-only batch (no property diff,
  just files + label = "Client · Name").

### Team & Access screen — /team (evening)
Directors can now invite and manage team members from the browser. Was
Supabase Studio work; is now app work. Also lays down the vocabulary that
"admin = Director" in Dream tone.

- **`0024_app_user_profile.sql`** — `app_user.job_title` + `phone`.
  Distinct from `role` so Vanessa can be an Agent with title "Sales &
  Marketing" without the two agreeing.
- **`app/team/roles.ts`** — `ROLE_LABEL` (`admin → "Director"`),
  `ROLE_ACCESS` (one-liners per role used verbatim in the access-map
  panel), `ROLE_PILL` (palette tuned for the white table — topbar's
  `.role-*` classes were built for the dark navy strip).
- **`app/team/actions.ts`** — `requireAdmin()` gate on both writes.
  `updateTeamMember` only patches fields explicitly passed (never nulls
  a non-null by accident). Self-lockout: a Director can't demote or
  deactivate themselves. `inviteTeamMember` runs
  `service.auth.admin.inviteUserByEmail(email, { redirectTo })`, then
  upserts the `app_user` row on the returned auth id — profile lands
  immediately so the invitee shows in the staff table before they've
  clicked through.
- **`/team` page** — server component, `dynamic = "force-dynamic"`.
  Admin-gated with a polite "Directors only" panel for non-admins (never
  500s). Invite CTA + staff table (one `TeamRow` per member: name/email,
  title + phone editable inline, role select, FFC, transfers-led count
  from `transfer.lead_agent_user_id`, active toggle, per-row Save). Access
  map below the table with pill + one-line description per role.
- **`TopBarClient.tsx`** — `Team` tab added, `adminOnly: true`.
- **Reuses** `SUPABASE_SERVICE_ROLE_KEY` (already set for the intake
  webhook). Optional `NEXT_PUBLIC_SITE_URL` so the invite email lands
  people at `/login`.

### Ship checklist (four migrations, four env vars)
Apply in Bon Bon's DB in order: **0021 → 0022 → 0023 → 0024**.
Vercel env vars needed:
- `SUPABASE_SERVICE_ROLE_KEY` (used by both intake webhook + /team invites)
- `INTAKE_WEBHOOK_TOKEN` (generate: `openssl rand -hex 32`)
- `NEXT_PUBLIC_SITE_URL=https://dreamproperties.app` (invite redirect)
- `LIGHTSTONE_API_BASE` + `LIGHTSTONE_API_KEY` — when the subscription
  becomes active (still stub-behind-env until then; nothing to do today).

Postmark setup: create an inbound stream, webhook URL
`https://dreamproperties.app/api/intake/email?token=<TOKEN>`, then MX
`intake` at Postmark's inbound host.

### Not built this arc (scope kept tight)
- Auto-extract in the intake webhook. Would need `/api/extract` refactored
  to accept a service-role bypass. Bronwyn uses her existing bulk-extract
  button on inbound batches; not a real pain point yet.
- Party-batch commit path — a client batch that reaches commit today
  routes docs through the existing commitBatch flow (parties get linked
  via extraction match_candidates). If a client-batch-specific commit
  helper is needed later, it's a thin server action that just promotes
  files to documents linked to the party.
- Reply email confirming triage URL. Postmark outbound is easy to add
  when the intake flow proves out with Bronwyn.
- Custom Dream Mapbox Studio style (still Simon's court).

---

## QUEUED FOR NEXT SESSION — bulk-migration unlocks

Four ships that would flip the migration path from "click each batch" to
"click a queue" and close the trickle-in workflow gap. None are
architectural; they're all extensions to what already exists.

**Sequence rationale**: #1 and #2 were **shipped 2026-07-06 evening** — see
the design-pass section below. Remaining queue: bulk migration throughput
(bulk extract + bulk commit) plus new items from tonight's real-data run
(transfer picker + merge-transfers UI + doc-revision dedupe).

**~~1. Manual "attach to existing property" — SHIPPED 2026-07-06~~**
- Right now, when the matcher finds no property candidate (e.g. a FICA-only
  drop with no address in the extracted fields), Bronwyn has no way to
  say "this batch belongs to `42 Duthie`" manually. `commit_batch` falls
  back to `Unknown address` and creates a phantom property.
- New: a search box in the Matches panel for the property target — type
  an address / deed / erf, get autocomplete results from `property`,
  click one to inject its `id` into `fields.property.id`. Reuses the
  same code path the auto-`link` decision already uses.
- Also: a "attach to this existing transfer" picker when linking to a
  property that already has transfers — closes the second-transfer noise
  without needing dedupe to guess.
- ~2 hours. Highest priority.

**~~2. On-commit document dedupe — SHIPPED 2026-07-06~~** (transfer dedupe still open)
- Before creating a `document` row from an `ingest_file`, check whether a
  document with the same `normaliseFilename(title)` AND `byte_size`
  already exists linked to the target property. If yes: reuse the
  existing document row and only add the new `document_link` — with the
  new `document_link.role` set to `batch:<label>` so the provenance
  survives.
- Also do a lightweight transfer dedupe: if this batch's proposed
  agreement price + date matches an existing transfer on the linked
  property, reuse that transfer instead of creating a new one.
- Uses the same `lib/diff.ts` helpers the differ already uses.
- Turns the "informational" differ into the "safe on commit" differ.
- ~medium; 2–3 hours.

**3. Bulk extract button** (`/triage` page)
- "Extract all unextracted green batches" (or `green + amber`). Fires
  `/api/extract` per batch in sequence with a small concurrency cap
  (probably 3). Same cost model as today — the user triggers, nothing
  fires automatically on drop.
- Show an estimated LLM cost (rough $/batch × count) on the button so
  nobody accidentally torches R500 on a wave.
- Progress ticker + fail-tolerant (if one batch OCR errors, keep going).
- ~1 hour to build.

**4. Bulk commit button** (`/triage` page)
- "Commit all one-click-safe batches" — bar: `tier=green` AND every
  match target has an auto-decided `link` AND (once #2 is in) no
  document-dedupe conflicts on the differ.
- Skips anything that would create a duplicate transfer or has field
  conflicts on the property target's differ.
- Reports "committed X, skipped Y for review" with a table of skips.
- ~half day.

**~~5. Transfer picker at commit time — SHIPPED 2026-07-07~~**
- `0017_commit_transfer_link.sql`: `commit_batch` reads
  `p_fields.transfer.id`; if set (and the transfer belongs to the linked
  property — defensive check), commits into it instead of creating a
  new one. Extends `match_candidate.target_kind` check to include
  `'transfer'`. Backward compatible.
- `linkTransfer(batchId, transferId | null, label)` server action +
  `TransferPicker.tsx` client component. Renders inside the Matches
  panel below the linked property row when the property has ≥1
  existing transfer. Default is "Create a new transfer"; each existing
  transfer is a clickable row with humanised status pill and date.
- Property target changes wipe stale transfer picks
  (`linkPropertyManually` + `decideMatch`).
- Needs 0017 applied to Bon Bon's Database before test.

**6. Merge transfers UI on the Property Record** (queued 2026-07-06 evening)
- Small "Merge into another transfer…" button on each transfer card in
  the ownership timeline. Opens a picker of the other transfers on this
  property. Runs the DO-block pattern from tonight's 15 Eagles Way SQL
  as a server action. Handles the transfer_party / fica / document_link
  unique-constraint clashes cleanly.
- Retroactive tool for records already polluted; #5 stops the pollution
  happening in the first place. Build #5 first.
- ~2 hours.

**7. Doc revision dedupe** (queued 2026-07-06 evening)
- Optional cleanup pass: when multiple docs on a property share the same
  `normaliseFilename(title)` but different `byte_size` (e.g. Property
  Information v1 + v2 dropped separately), keep only the newest by
  `uploaded_at` and archive the others.
- Off by default; run via SQL or a maintenance button. Not a hot path.

**8. Custom Dream Mapbox Studio style** — Simon building in parallel. Once the
   style URL exists, one line goes into the BASEMAPS array as a fourth chip.
- "Extract all unextracted green batches" (or `green + amber`). Fires
  `/api/extract` per batch in sequence with a small concurrency cap
  (probably 3). Same cost model as today — the user triggers, nothing
  fires automatically on drop.
- Show an estimated LLM cost (rough $/batch × count) on the button so
  nobody accidentally torches R500 on a wave.
- Progress ticker + fail-tolerant (if one batch OCR errors, keep going).
- ~1 hour to build.

**2. Bulk commit button** (`/triage` page)
- "Commit all one-click-safe batches" — bar: `tier=green` AND every
  match target has an auto-decided `link` AND (once #3 is in) no
  document-dedupe conflicts on the differ.
- Skips anything that would create a duplicate transfer or has field
  conflicts on the property target's differ.
- Reports "committed X, skipped Y for review" with a table of skips.
- ~half day.

**3. On-commit document dedupe** (in `commitBatch` server action)
- Before creating a `document` row from an `ingest_file`, check whether a
  document with the same `normaliseFilename(title)` AND `byte_size`
  already exists linked to the target property. If yes: reuse the
  existing document row and only add the new `document_link` — with the
  new `document_link.role` set to `batch:<label>` (or similar) so the
  provenance survives.
- Also do a lightweight transfer dedupe: if this batch's proposed
  agreement price + date matches an existing transfer on the linked
  property, reuse that transfer instead of creating a new one.
- Uses the same `lib/diff.ts` helpers the differ already uses.
- Turns the "informational" differ into the "safe on commit" differ.
- ~medium; 2–3 hours.

**Sequence**: build 3 first (dedupe is what makes bulk-commit safe), then
2, then 1. Or 1 and 3 in parallel (both touch different files) and 2 last.

Also queued from earlier (smaller):
- Cosmetic: `IN_CONVEYANCING` → "In conveyancing" pill.
- `transfer.status` advance to `registered` when a `title_deed` doc is
  present in the batch.
- Sync `geom` from `lng, lat` (needs a small PostGIS helper migration).
- Staging bucket cleanup for the historical `imageNNN.*` signature files
  purged from the DB (bytes still in storage).
- Safer `Classify`: skip files above 0.9 confidence so hand-fixes survive.
- Photo carousel in Map preview card (needs media-table reshape).

---

## TRANSFER PICKER + DASHBOARD REDESIGN + MODERN TYPE (2026-07-07 evening)

Big arc. Root fix for transfer duplication, a proper attention-first dashboard,
whole-app type swap to modern sans, and title-deed → registered auto-advance.

### Transfer picker at commit — root fix for "one listing, three transfers"
- `0017_commit_transfer_link.sql`: `commit_batch` honours `p_fields.transfer.id`.
  Verifies it belongs to the linked property (defensive), otherwise falls
  through to creating a new one. Extends `match_candidate.target_kind` check
  to include `'transfer'`. Backward compatible.
- `linkTransfer` server action + `TransferPicker.tsx` client component. Shows
  inside the Matches panel below the linked property row when the property
  already has ≥1 transfer. Default is "Create a new transfer"; each existing
  transfer is a clickable row with humanised status pill + date.
- Property target changes wipe stale transfer picks (both `linkPropertyManually`
  and `decideMatch` do the cleanup).

### Registered advance on title-deed evidence
- `0018_registered_advance.sql`: `commit_batch` now checks the batch for any
  file classified as `title_deed`. If present, transfer status → `registered`
  and `registered_date` coalesces (existing, then AoS transfer_date, then
  today). Fires after the earlier `in_conveyancing` assignment so the deed
  wins.
- One-shot backfill included: every transfer where a title-deed doc is
  already linked (via transfer or property) advances to `registered`.
  Cleans up historical stuck-in-conveyancing records.

### Merge transfers UI — retroactive cleanup tool
- `0019_merge_transfers.sql`: `merge_transfers(winner, loser, reason)` RPC.
  Same shape as `merge_properties` from 0013 — admin-gated, same-property
  guard, unique-constraint clashes dedup'd on `transfer_party` / `fica` /
  `document_link` before repoint, audit log written, loser deleted.
- `MergeTransfer.tsx` on each transfer card in the Property Record.
  Admin-only, appears when the property has more than one transfer.
  Expandable picker + native confirm on the destructive action.

### Dashboard redesign — attention-first, not KPI-first
- Ripped out the 4 KPI tiles (the "template answer" the frontend-design
  skill calls out). Hero now shows THE specific deal that needs
  attention — transfer with the nearest transfer_date in in_conveyancing,
  with a "N days to transfer" countdown as the payload. Falls back to
  most-recent transfer, then to an empty invitation.
- Three columns of work replace the KPIs: **Deals in flight** /
  **Live listings** / **Waiting for review**. Column headers absorb the
  count that used to live in the tile. Rows are actual things to look
  at — Fraunces (later Inter) primary + mono secondary + a right-aligned
  payload chip (countdown / price / tier). Column dividers carry a
  2px vertical gold-tideline whisper at the top, so the signature
  repeats and consistently means "primary axis of attention".
- Cut: "Live database, live map, live pipeline" marketing tagline, the
  4 KPI tiles, and the AMBER pill leaking on recent-activity rows.

### Type: modern all-sans across the app
- Simon read Fraunces as dated. Swapped whole-app to **Inter** (display +
  body) + **JetBrains Mono** (utility). Loaded fresh weights (300-800 for
  Inter, 400-700 for JetBrains Mono). Dropped Fraunces + Hanken + Spline
  Sans Mono from the font-load altogether.
- Display sizes got weight bumps 600 → 700/800 and tighter tracking
  (-0.025 to -0.04em) so Inter reads intentional at large sizes — Fraunces
  at 600 was heavier than Inter at 600 without the compensation.
- 51 CSS references + 6 inline-styled components (TransferPicker,
  PropertyAttach, DiffPanel, PairCard, MapView) all updated.

### Real-data cleanup as we went
- Suburb backfill for pre-fallback commits — patched every property with
  a missing suburb where the address contained a seeded suburb name.
- Bronwyn's admin role — delete+reinvite had left her `app_user` row
  orphaned. Rebound to her new `auth.users.id` with role='admin'.
- Two rounds of transfer merge SQL (before and after property merges
  on `/dupes`). Consolidated 3 Oupad × 3, Plot A4 × 2, 15 Eagles Way ×
  multiple into single rows.
- Listing dedupe SQL — after property merges, the survivor had duplicate
  live listings. Kept newest per (property_id, asking_price, status).

### Queued for next session (order)
1. **Cascade dedupe on `merge_properties`** — when properties merge, also
   collapse duplicate transfers and live listings on the survivor.
   Tonight's SQL block for the listing/transfer residue should never be
   needed again after this. Small ship.
2. **/dupes callout on Dashboard** — surface pair counts on the Overview
   so Bronwyn is driven to review rather than the tool being hidden
   behind a nav tab.
3. **`/dupes` threshold defaults + per-pair confidence display** — catch
   borderline pairs like the two 6 Bowden variants (address strings
   differed too much for 0.5 trigram), but with clearer confidence
   surfacing so low-score noise doesn't dominate.
4. Bulk extract on `/triage` (~1h)
5. Bulk commit on `/triage` (~half day)
6. Doc revision dedupe (optional)
7. Custom Dream Mapbox Studio style (still Simon's court)

Also: `merge_listings` RPC + browser button on Property Record is a
natural counterpart to `merge_transfers`. Not urgent — the auto-cascade
in #1 covers most cases.

---

## EVENING ARC — DESIGN PASS + REAL-DATA FIXES (2026-07-06 evening)

Second big block of the day. Everything that shipped between "map is live"
and "Bronwyn's book is Bronwyn-ready".

### Map pins redesign
Teardrop pins couldn't hold variable-length price text (`R 24.5M` overflowed)
and pure navy fills sank into satellite imagery. Swapped for the horizontal
**price-pill pattern** real-estate portals use (Zillow / Rightmove /
Property24). Rounded rectangle sized to the price text, mandate colour on
fill, small pointer arrow at the bottom, white 2px ring for contrast on
satellite basemap. POR variant for no-price rows: compact muted badge with
the mandate colour as a thin ring.

### Basemap switcher — Satellite as default
Three-tab toggle (Satellite / Streets / Light) in the left rail. `mapbox/
satellite-streets-v12` as the default so Bronwyn sees actual roofs on
Leisure Isle and Pezula with mandate pins on the buildings. `map.setStyle()`
keeps HTML markers across style changes so no marker gymnastics.

### Manual property-attach shipped
- `searchProperties(q)`: ilike over `primary_address` + `title_deed_no`,
  ilike over `erf.erf_number`, dedupe by property id, backfills erven for
  every result.
- `linkPropertyManually(batchId, propertyId, label)`: wipes existing
  `match_candidate` rows for the property target, inserts a fresh one
  with `decision='link'` + `candidate_id`. `commit_batch` reads that path
  and attaches to the chosen property.
- `PropertyAttach.tsx` client component: expandable inline search, 250ms
  debounce, big address + mono suburb/erf/deed per result. Renders next to
  "Create new record instead" on the Property target, AND as a standalone
  section when the auto-matcher didn't propose a Property target at all
  (the FICA-only trickle case).

### On-commit document dedupe
`commitBatch` now pre-fetches existing `document_link` rows on the target
property and builds a `normaliseFilename(title) + byte_size` map. When
processing each `ingest_file`, matches reuse the existing `document` row
and only add the new `document_link` for the transfer. First-in-batch
duplicates also collapse. Historical dupes (169 Links, Eagles Way) don't
retro-fix — only new commits.

### Property Record design pass (frontend-design skill)
Interim data-first layout replaced.

- **Header status pill**: current transfer status as a chip on the right of
  the masthead. Same palette as map pins. Humanises `IN_CONVEYANCING` →
  `In conveyancing`, `REGISTERED` → `Registered`, `NO_LIVE_DEAL` → `No live
  deal`. Transfer date under the pill when set.
- **Cadastral strip** replaces the 6-tile fact grid. Reads left-to-right in
  SA deeds-registration order: Erf · Title Deed · Extent · Suburb · Type ·
  Ownership. Hairline verticals between items. Values dim to half opacity
  when empty. Mono for deed / erf, Fraunces for named values.
- **Ownership timeline** as the signature move. The app's gold tideline
  motif (previously only a decorative rule) becomes a vertical rail down
  the transfers section with a year marker + tideline dot per transfer.
  Applies the app signature to an axis where time actually is information.
- **Photos strip strict**: only `doc_type_code === 'photo'` files land here.
  Scanned IDs and passports (image files, classified as `id_document` /
  `passport`) no longer leak into a strip that reads as public property
  photos. POPIA hygiene. Bigger tiles (168×126).
- **Documents grouped by category** with gold-tideline underlines under
  each category eyebrow. FICA eyebrow renders in red as a quiet visual
  signal that PII lives under it. `Documents (N)` wrapper heading dropped
  (Chanel critique: one accessory removed).

### 15 Eagles Way triage exercise (real-data test)
- Two batches for "one listing, trickled in over two folders" hit the
  live pipeline. Both linked to the existing `b3a041a7-...` property via
  manual attach. Committed cleanly.
- Result: three transfers on one property (the two new commits + a July 2
  empty pilot) — this is the transfer-dedupe gap in real life.
- Manual SQL DO-block collapsed the three into one keeper. Ownership
  timeline flattened to a single transfer with all 8 documents attached.
- Queued: transfer-picker-at-commit (root fix) + merge-transfers UI
  (retroactive cleanup) so this doesn't need SQL again.

### Suburb backfill for pre-fallback commits
One-shot `update ... coalesce()` iterating every seeded suburb — patched
Suburb tile on every property already committed before the 0016 landing.
The Heads / Leisure Isle / Pezula / Simola / Belvidere / Brenton records
now all read correctly.

### Cosmetic wins
`IN_CONVEYANCING` → `In conveyancing` etc. (was queued as a cosmetic
follow-up) — done as part of the design pass.

---

## LIVE MAP + FIRST REAL BOWDEN COMMIT (2026-07-06 afternoon)

**Bronwyn's first real email → committed Property Record**, and the map screen
came fully to life. The afternoon was a series of "the pipeline actually
works, now let's find and fix the next thing hiding" moments.

### The Bowden pipeline run
- Bronwyn dropped five `.eml` files for 6 Bowden Park, Leisure Isle. Batch
  auto-classified as Email Correspondence (correct — the wrappers). Unpack
  silently produced 0 attachments.
- **Root cause found by parsing a Bowden .eml locally with mailparser**: my
  earlier inline-signature filter (`f5a1be4`) was over-eager. It skipped any
  attachment with `contentId` set — but Outlook sets a contentId on nearly
  every attachment, including real PDFs (Lightstone report, Signed Joint
  Mandate, 6 Bowden Park Plans). All silently dropped. Fixed by removing the
  `!!contentId` check from the skip signal: only `contentDisposition === 'inline'`
  OR `related === true` count as skip signals now.
- Also bumped `/api/unpack` maxDuration 60 → 300, added per-file error
  surfacing (download/read/parse/upload/insert stage), and stopped marking
  `.eml` files as `parsed` on partial failures so retries actually retry.
- After the fix: 14 documents committed to a live Property Record — Lightstone,
  Signed Joint Mandate, Plans, Zoning Certificate ERF 7474, Municipal Account,
  Insurance, guest-house docs — with Stephen Athey Collins as the extracted
  seller.

### Extraction gaps found + fixed
- Empty Suburb / Type / Ownership on the Bowden record → three problems:
  1. `commit_batch` had no fallback for suburb when the LLM lumped it into
     `primary_address`. Added a scan-address-for-seeded-suburb-name fallback
     in `commitBatch` (`fcfe217`).
  2. `TEXT_TARGETS` in `/api/extract` didn't include `lightstone_report`,
     `title_deed`, `rates_account`, `boundary_relaxation`, or
     `ppra_disclosure` — the LLM never saw the Lightstone report even though
     it was in the batch. Added them (`34b4b32`).
  3. `JSON_SHAPE` had no `property_type` or `ownership_type` fields. Added
     them with the seeded taxonomy vocabulary in the prompt. Migration
     `0016_property_facts.sql` teaches `commit_batch` to look them up by
     code OR label and write the FK columns on insert, plus fills NULLs on
     link so a follow-up batch enriches existing records.

### Map screen — went live, painfully
Everything wrong that could be silently wrong, was. The sequence of hunts:
1. `/map` showed "No properties yet" → **0015 migration hadn't been applied**;
   query for `lng/lat` failed silently, `data` was null, count was 0.
2. Fixed migration, page then showed "No coordinates on file" — geocoder
   button visible but Bronwyn's Mapbox token wasn't being read (dark navy
   canvas, no basemap).
3. Sequence of token diagnostics revealed the token was VALID (returned
   full style JSON when hit directly) — Vercel wasn't the problem.
4. Added a temporary debug panel to `MapView` — logged `container size on
   init: 1248x0`. **Root cause: the `.map-shell` grid had one implicit row
   with no `grid-template-rows`, so the row auto-sized to content, and
   since `.map-canvas` is position:absolute it contributed 0.** Row
   collapsed. Fixed by switching `.map-shell` to flexbox with explicit
   `height: calc(100vh - 54px)` and `.map-stage { height: 100% }`.
5. Basemap tiles finally rendered. Geocode button still looked disabled →
   the `.map-empty` overlay at z-index 25 was covering the geocode-bar at
   z-index 22, blocking clicks. Fixed by raising the bar to z-index 30
   and setting `pointer-events: none` on the empty-state overlay.
6. Geocode fired, all 7 properties (including 6 Bowden) landed on the map,
   mandate-coloured pins with price labels baked in, side preview card
   working end to end. Debug panel ripped out.

Also queued along the way:
- Safer paste hygiene: `.trim()` the Mapbox token everywhere it's read
  (Vercel env-var trailing whitespace was a real suspect).
- `mapboxgl.supported()` check → surfaces a specific error if WebGL is
  disabled.
- `map.resize()` + `ResizeObserver` on the map container — belt-and-braces
  against future layout-shift regressions.
- Full Mapbox `on('error')` handler → surfaces a red banner on the map.

### Basemap switcher shipped
Three-tab toggle in the left rail: **Satellite** (default, satellite-streets-v12
— gorgeous for property, roofs and pools visible), **Streets** (colored
navigation style), **Light** (the original). `map.setStyle()` swaps live;
HTML markers stay put across style changes so no re-add gymnastics.

### Content-based reclassifier + differ shipped earlier in the day
Already documented below — they held up well against the day's real data
(Gas COC content-classify catching the SAQCC file was mentioned; the
batch differ didn't get exercised yet since Bowden was a fresh property).

### Queued for next session (unchanged from the earlier queue)
1. Manual "attach to existing property" at batch review (correctness fix
   for the FICA-only trickle case)
2. On-commit document + transfer dedupe
3. Bulk extract button
4. Bulk commit button

Plus: **custom Dream Mapbox Studio style** (in progress — Simon is building
the palette in Studio with a gold coastline as the signature. Once
published, one line goes into the BASEMAPS array as a fourth chip.)

Also the smaller follow-ups list stays (IN_CONVEYANCING pill, transfer
status advance, geom sync, staging bucket cleanup, safer Classify, photo
carousel).

---

## BATCH DIFFER — "WHAT THIS BATCH ADDS" (2026-07-06)

**Answers the "nugget in one file" concern**. Bronwyn worried that batch-level
dedup would lose value — one folder might carry a unique document or a
better field value that the other doesn't have. Rather than dedupe upstream,
this ship exposes what a batch would ADD when it links to an existing
property, so the reviewer can decide whether the incremental data is worth
committing.

- `lib/diff.ts` — types + normalisation. `normaliseFilename` collapses
  whitespace / underscores / hyphens and strips extension + `(N)` copy
  markers so "169 Links Photo (2).jpg" matches "169 Links Photo.jpg".
- `app/triage/[id]/page.tsx` — server computes `PropertyDiff` when the
  property target has a `link` decision. Fetches the linked property's
  fields, existing `document_link` documents, and existing transfers +
  agreements. Classifies each property field as `adds` (empty on record,
  filled by this batch), `conflict` (both non-null and different),
  `same`, or `empty`. Also detects whether this batch would create a
  duplicate transfer (checks proposed agreement price+date against
  existing transfers).
- `app/triage/[id]/DiffPanel.tsx` — client render sitting between the
  Matches panel and Proposed fields. Summary tiles (new files, duplicate
  files, fields filled, field conflicts, existing transfers) + only-
  changed-rows table for property field diffs + side-by-side New /
  Duplicate file lists + an existing-transfers table with a warning
  banner if this commit would spawn a new transfer.

Not this ship (queued):
- Actual dedupe on commit — right now the differ is informational; if you
  commit the batch, duplicate documents still get created. Task #2 from
  the earlier three-item list (document dedupe on attach) is the natural
  companion.
- Party-level diff (existing parties vs proposed). The Matches panel
  already shows candidate parties independently, so this was deferred.
- Selective per-file commit — skip specific files at commit time.

---

## CONTENT-BASED RECLASSIFY (2026-07-06)

**Fixes the Gas COC problem** — files whose filename was uninformative (like
`20260219134128251.pdf`, obviously a SAQCC Gas certificate but invisible to
`lib/classify.ts`) landed as `other`. The extractor already OCRs scanned PDFs
but only pulls fields — it never fed that content back to the classifier.
This ship closes the loop.

- `lib/content-classify.ts` — regex ruleset that scans document text (from
  PDF text layer, docx, or OCR). Ordered rules, first hit wins. Covers Gas
  COC, Electrical COC, Beetle, FICA, ID, passport, marriage cert, title deed,
  rates, juristic-party paperwork (resolution / CIPC / trust / share
  register / VAT), mandate types, PPRA disclosure, CMA, Lightstone report,
  offer to purchase, agreement of sale, movables, addendum, plans, design
  manuals.
- `app/api/reclassify/route.ts` — targets files marked `other` OR unclassified
  OR classification_confidence < 0.5 (so manual `setFileType` corrections
  above 0.5 are safe). For each: uses cached `ocr_text` if present, else
  downloads and extracts text via `textFromFile` (pdf-parse / mammoth /
  raw). If text is empty (scanned image with no text layer), OCRs via
  OpenRouter's `file-parser` + `mistral-ocr` plugin (same path `/api/extract`
  uses). Regex classifier first; LLM fallback (single classify prompt,
  cheap) for the rest. Writes back `detected_doc_type_id`, `is_pii`,
  `classification_confidence`, and caches `ocr_text`. Skips photos and
  `.eml` wrappers.
- **UI**: "Reclassify unknowns (N)" button in the batch review header, only
  shown when N > 0. Sits between Classify and Extract fields (AI).

Cost sanity: ~$0.01 OCR + ~$0.001 LLM classify per unknown file. A batch with
3–5 unknowns costs a few cents.

**No migration needed.** Just push.

---

## MAP + DASHBOARD REWORK + SHARED TOP BAR (2026-07-06)

**First real front-end pass** — lifts the live app from an admin table shell
towards the wireframe fidelity (Estuary v0.3). Three ships in one:

**Shared top bar** (`app/components/TopBar.tsx` + `TopBarClient.tsx`) applied
to every signed-in page. Estuary navy, gold tideline underneath, brand mark
in Fraunces, nav tabs (Overview / Map / Properties / Triage / Dupes — the last
admin-only) with active-tab detection via `usePathname`, role pill (gold for
admin), signout. First shared spine the app has had. Login stays untouched.

**`/map`** — live-data map screen backed by property + latest listing + mandate
+ latest transfer. Mapbox GL with a custom navy map-drop pin, price rendered
directly on the pin body, coloured by mandate (gold Exclusive / forest Sole /
navy-ish Joint / amber Under offer / grey Open / darker grey None). Left rail:
mandate filter chips with counts + scrolling listing list. Right slide-in
preview card on pin click with address, mandate + status chips, asking price
(with a gold underline signature), extent / deed / transfer summary, and a
"Open property record →" CTA. Public Mapbox demo token as fallback; production
swap is `NEXT_PUBLIC_MAPBOX_TOKEN`. Empty states for zero properties or zero
geocoded.

**Geocoder** — `geocodeMissingProperties` server action + admin-only "Geocode
all" button in the map's top-right. Iterates properties where `lng is null`,
hits Mapbox Geocoding v6 forward endpoint (anchored to Knysna centre +
`country=za` + a Knysna/Sedgefield/Pezula regex guard for short addresses),
writes `lng, lat` back. Cheap enough at scale (500 folders ≈ ~$0). Uses
`MAPBOX_SECRET_TOKEN` server-side (falls back to the public token if not set).
Migration `0015_map_coords.sql` adds the `lng, lat` numerics — no geom sync
here (needs a PostGIS helper; deferred).

**Dashboard rework** — replaces the 3-link welcome with a proper landing:
KPI tiles (Properties / Transfers / In-conveyancing / Live listings, each with
a deep link) + a Recent activity strip pulling the last six committed
`ingest_batch` rows with a jump to their property record. Fraunces figures with
the gold tideline motif under each KPI value.

Styles are additive: ~350 new lines in `globals.css` for topbar, KPI tiles,
map shell, pin, preview card, and mandate colour semantics. No existing
classes changed; all previous pages still render fine.

**Needs `0015_map_coords.sql` run + a push.** First test: land on
/dashboard → nav tabs work; hit /map → "N of M pinned" bar shows in the
top-right (M is your property count); hit **Geocode all** → refresh → pins
appear coloured by mandate; click one → preview card slides in. For an
alternative Mapbox token set `NEXT_PUBLIC_MAPBOX_TOKEN` in Vercel.

Out of scope for this ship, on the follow-up list:
- Photo carousel in preview card (needs the media-table reshape).
- Basemap switching (satellite / streets / cadastral).
- `transfer.status` advance to `registered` when a title-deed doc is present
  (raised in earlier conversation) — still queued.
- Cosmetic: `IN_CONVEYANCING` → "In conveyancing" pill formatting.
- Sync `geom` from `lng, lat` (needs a small SQL helper).

---

## PHOTO CLASSIFICATION + INLINE-IMAGE FILTER (2026-07-05)

**Two extraction-pipeline bugs fixed** noticed while browsing committed data:

1. **Photos landed as `other`**. `lib/classify.ts` had zero image rules and the
   `document_type` seed had no `photo` code, so `IMG_1234.jpg` matched nothing
   and fell through. Added `photo` (category `photo`) to seed.sql + catch-up
   migration `0014_photo_doctype.sql` for Bon Bon's Database. Classifier now
   has an image-extension fallback (`.jpg .jpeg .png .heic .heif .webp .tif
   .tiff .gif .bmp`) that fires after the text rules miss, so a filename that
   says "Front Elevation.jpg" still hits the plan rule first.

2. **Bronwyn's Dream email signature/footer was being imported as attachments**.
   `app/api/unpack/route.ts` only skipped inline images that were both unnamed
   AND < 20 KB — but Outlook always names inline images (`image001.png`) and
   the Dream footer PNG is well over 20 KB, so they came through. Fixed to
   skip on the actual MIME signals: `contentDisposition === 'inline'`, mailparser's
   `related === true`, or a set `contentId` (cid: body reference). Plus a
   belt-and-braces regex against Outlook auto-names.

Interim: newly-classified photos still land as `document` rows on commit, not
`media` rows. A Photos section on Property Record + the media-table reshape are
a follow-up ship. For now `photo` is searchable + viewable via the existing
Documents section.

**Needs `0014_photo_doctype.sql` run against Bon Bon's Database + a push.**
Existing batches keep their prior classifications. Re-open a batch and hit
"Classify" to re-run against the updated ruleset — heads-up: `classifyBatch`
overwrites every file's `detected_doc_type_id` from the filename, so any manual
`setFileType` corrections in that batch flip back. A "reclassify only files
still marked `other`" pass would fix that, but is out of scope for this fix.

## POST-HOC DUPE FINDER (2026-07-05)

**Admin screen to merge duplicates that predate the matching flow** — replaces the
ad-hoc SQL DO block used on 2026-07-02 to clean up `15 Eagles Way × 2` and the
`7 The Grove` pair. Turns that pattern into a scan + merge that works from the
browser as new dupes surface.

**Migration `0013_dupe_finder.sql`** adds:
- `dupe_dismissal` table (unique on target_kind + normalized pair `a_id < b_id`,
  admin RLS) so "not a duplicate" judgments persist between scans.
- `find_property_dupes(threshold, limit)` — pairwise trigram scan on
  `primary_address` OR exact `title_deed_no` match, returns each side's label +
  deed + suburb + extent + counts (erven / transfers / listings) so the admin
  can pick the winner on evidence. Uses the pg_trgm GIN indexes from 0011.
- `find_party_dupes(threshold, limit)` — same shape for `display_name` OR exact
  `id_number` / `registration_no`. Only compares within the same `party_type`
  (won't cross individuals with juristics).
- `merge_properties(winner, loser, reason)` and `merge_parties(winner, loser,
  reason)` — security-definer, `is_admin()`-gated. Winner keeps id + non-null
  values; loser's non-null values fill winner's gaps (`coalesce` per column,
  notes concatenated with a merge marker). All FKs repointed; unique-constraint
  clashes on `erf`, `transfer_party`, `fica`, `party_member`, `document_link`
  resolved by dropping the loser's conflicting row first. Both spouse
  self-marriage and party_member self-membership guarded. Audit row logged;
  loser deleted; dismissal rows referencing loser cleaned up.
- `dismiss_dupe(kind, a_id, b_id, reason)` — normalises pair order and inserts
  idempotently.

**UI `/dupes`** (admin-only, `role === 'admin'` gate + admin-check in the RPCs):
tabs for Properties / Parties, adjustable score threshold (default 0.5), and one
`PairCard` per candidate showing the two sides side-by-side with field-level
diffs highlighted. Buttons: **Keep A → merge B**, **Keep B → merge A**, **Not a
duplicate** (with an optional reason that lands in the audit log). Linked from
the dashboard for admins only.

Typecheck green, `next build` compiles clean (12/12 pages; the `/login`
prerender-env error is the same known local-only issue — Vercel has the vars).

**Needs `0013_dupe_finder.sql` run against Bon Bon's Database + a push**. First
runtime test: rescan Properties tab — should be empty (the 2026-07-02 cleanup
already collapsed the historical dupes). Then re-run 15 Eagles Way (Vanessa
folder if there is one) as a batch and commit it to a new address form → the
next scan should surface the pair, and Keep-A-merge-B should collapse them.

Out of scope for this ship (follow-ups):
- Juristic-party matching in the *pre-commit* flow (still deferred from the
  2026-07-02 note). The post-hoc scan here already covers juristics.
- 3-way / n-way merge (only pairs today).
- Undo / restore-from-audit — the merge is destructive; the audit_log row is
  the only trace after loser deletion.

## MATCH/MERGE REVIEW UI (2026-07-02)

**Pre-commit fuzzy-match candidate review shipped** as the first duplicate-prevention
step for the 500-folder scale. Before this, `commit_batch` matched inline on exact
keys only (`title_deed_no`, `id_number`, `lower(entity_name)`), silently creating on
miss — guaranteed to duplicate "3 Oupad" vs "3 Oupad Road" etc.

New: **migration 0011_matching.sql** — enables `pg_trgm`; adds GIN trigram indexes on
`property.primary_address` + `party.display_name`; adds `find_property_candidates`,
`find_party_candidates` (individuals only for this ship — juristic parties deferred),
and `propose_matches(batch_id, fields)` which populates `match_candidate` rows.
Idempotent — decided rows (link/create) are preserved on re-run.
Auto-decides `link` when a target has exactly one candidate scoring ≥ 0.95, so
green batches with a perfect match still one-click.

`commit_batch` extended to honour explicit IDs: if `fields.property.id` is set (from
a "link" decision), it's used directly. Same per-party via `upsert_party` — an
`id` in the party jsonb short-circuits the match-or-create path.

New UI on `/triage/[id]`: **Matches panel** above the Proposed fields section.
Auto-runs `propose_matches` on first mount when there are extractions but no
candidates. Groups by target (Property / Seller N / Purchaser N). Each row shows
score, existing-record label, extracted-vs-existing summary. Two decisions:
**[Link]** on a candidate, or **[Create new record instead]** for the whole target.
**[Reset]** clears a decided target. **Commit is disabled** while any target has
neither a link nor an all-`create` decision — the button surfaces which targets
are open in its tooltip.

New server actions in `app/triage/actions.ts`: `proposeMatches(batchId, rows)` and
`decideMatch(batchId, targetRef, candidateId, decision)`. `commitBatch` reshape
folds `decision='link'` rows into `fields.property.id` and per-party `id`.

Compile + typecheck green (`✓ Compiled successfully`; prerender-time env error on
`/login` is local-only, Vercel has vars set).

**Coordination note (2026-07-02):** 0011 was written from the 0009 version of
`upsert_party` and silently dropped the `registration_no` + `party_member` handling
that 0010 had added. Reconciled by **0012_reconcile_upsert_party.sql**, which merges
both behaviours (explicit link from match-review + juristic-party members).
`commit_batch` from 0011 is unchanged and correct.

**Run order: 0010 → 0011 → 0012.** All three need to be applied against Bon Bon's
Database before push. First runtime test = drop a batch that references a
property/party already in the DB; UI should surface it as a candidate with score.
Also verify a juristic-party batch (e.g. re-run of Plot A4 shape) still captures
directors — that's what 0012 protects.

Rule for future shared-function migrations: read the **latest** definition (grep
all migrations in numeric order) before `create or replace`, and preserve every
behaviour already present. Applies especially to `upsert_party`, `commit_batch`,
and the helper casters.

**Post-merge dedupe (2026-07-02):** Test-run of the pipeline surfaced two
historical duplicate pairs in `property` that predated matching:
`15 Eagles Way, The Heads, Knysna` × 2 (both empty deed/suburb, 1046 m²) and
`7 The Grove, Leisure Isle` (empty) vs `7 The Grove, Leisure Isle, Knysna`
(deed T62677/2025, 614 m²). Cleaned with an ad-hoc merge DO block: most-complete
record wins, gaps filled from loser, erven/transfer/listing/ingest_batch/
document_link repointed, loser deleted. Property table: 8 → 6 rows. Matcher
would catch these on any new commit going forward.

Out of scope for this ship, on the follow-up list:
- Juristic-party matching (companies/CCs/trusts) — need trigram on `entity_name`
  + a `find_juristic_candidates` and matching UI path.
- Post-hoc dupe finder UI (the 7 The Grove / 15 Eagles Way merge was manual
  SQL; a proper screen would scan all `property` + `party` for likely dupes
  and let admin merge from the browser).
- "Merge two existing records" — the `merge` decision option in the schema.

## LIVE ON CUSTOM DOMAIN (2026-07-02)

App is live at **https://dreamproperties.app** (Cloudflare-registered domain → Vercel; apex A
`76.76.21.21` + www CNAME `cname.vercel-dns.com`, DNS-only; Vercel auto-SSL). Supabase Auth Site URL +
redirect URLs pointed at the new domain. This is the URL for Bronwyn.

Minor follow-up: OpenRouter attribution header in `app/api/extract/route.ts` still says
`app.dreamknysna.co.za` — cosmetic, update to dreamproperties.app on next push.

## PIPELINE COMPLETE (2026-07-02)

**Folder → live database record works end to end, proven on the hardest case.** Plot A4 Pezula —
a dual-company deal (Fortis Dux buying, BSANDAY selling), from a folder of scanned documents —
committed into live records: both parties as `company` with registration numbers, their UBO/director
as `party_member` rows, agreement/property/erf/mandate all captured. The full chain now runs in
production: drop → unpack .eml → classify → tier → name → AI extract (text + OCR + deep juristic) →
review/edit → commit (match-or-create). Also proven: 7 The Grove (text), 3 Oupad (scanned OCR),
169 Links (listing). Fixes this session: model slug, batch naming, input state binding, input width,
commit migrations 0009/0010 run.

---

## Now (current session — 2026-07-01)

**Started the build. Database-first, migration-led.**

- **Accounts stood up:** GitHub `BronwynDream/Dream-Properties-OS` (owned by Dream);
  Supabase project **"Bon Bon's Database"**, EU/Ireland region (POPIA-clean), healthy,
  no migrations yet. Simon's GitHub user `simonhoughton-source` to be added as a
  collaborator (Write) so his linked account can push while the repo stays Dream's.
- **Schema v0.1 written** as ordered Supabase migrations in `dream-os/supabase/migrations/`
  (0001 init → 0006 storage) + `seed.sql`. 35 tables, 24 enums. SQL validated (parses
  clean; no forward-reference FK problems). Not yet run against Supabase.

### Four structural gap-fixes baked in (from the 8-folder + 7 The Grove audit)
1. **Juristic parties** — `party` = individual OR company/CC/trust/partnership;
   `party_member` links directors/trustees/partners/UBOs + signatory flag.
   (Plot A4 = company; 7 The Grove = partnership.)
2. **Document versioning** — `agreement`/`document` carry status (template→draft→
   clean_final→executed) + version + supersedes_id.
3. **Plans + estates** — `media.kind` covers elevations/sections/floor/concept plans;
   `estate` holds design manuals + levies (Pezula, Thesen, Simola).
4. **Communications log** — `communication` gives email threads + the WhatsApp waiver
   a home. Plus: suspensive conditions, milestones (dated obligations), explicit offers,
   conveyancer firm→many contacts, nullable commission.

- **Drop-and-triage designed.** Spec at `dream-os/docs/drop-and-triage-spec.md`; staging
  tables shipped in `0007_staging.sql` (ingest_batch / ingest_file / extraction + RLS +
  private `staging` bucket). Pipeline: drop → parse/OCR → classify → AI extract →
  human confirm → transactional commit (mirrors the pilot). Nothing hits live tables
  until confirmed; batches are reversible.

- **Next.js app scaffolded (Phase A).** Login-gated shell at repo root — `/login`
  (Supabase email+password), `/dashboard` (protected, shows name+role), middleware
  session-gating, `@supabase/ssr` clients, Estuary-styled. **Build verified** (typecheck +
  `next build` both green). Vercel is linked to the repo → push auto-deploys.

## Next (immediate)
- [x] Pushed schema v0.1 to `BronwynDream/Dream-Properties-OS` (main @ 4ee7645, 10 files) via `simonhoughton-source`.
- [x] Ran migrations 0001–0006 + seed against "Bon Bon's Database" — all seven green. DB is live.
- [x] **App deployed & login working** on Vercel (`dream-properties-*.vercel.app`). Env vars set (publishable key = anon), redeploy baked them in. Auth → dashboard → RLS proven live.
- [x] Auth users + `app_user` rows live for Bronwyn (e34de424…) + Simon (eef1d2c1…), both admin. **Admin pill resolves in the app** — RLS role round-trip confirmed. Vanessa (agent) still to add.
- [x] Pilot **7 The Grove** loaded to "Bon Bon's Database" — ran green ("Success, no rows"). Golden record live: partnership seller + partners, joint buyers, executed agreement, waived condition, milestones, FICA, docs, comms. Schema proven against a real, awkward deal. Script: `dream-os/supabase/pilot_7_the_grove.sql`.
- [ ] Run `0007_staging.sql` + `0008_triage_queue.sql` against "Bon Bon's Database" (staging tables, bucket, tiering, `v_triage_queue`, `match_candidate`).
- [x] Triage screen v1 built (`/triage`): folder-picker drop zone → creates `ingest_batch` + `ingest_file`, uploads to `staging` bucket; queue list from `v_triage_queue`; gated route; linked from dashboard. Build verified. **Needs `0007`+`0008` run + a push to go live.**
- [x] Classification + batch-review screen built (`/triage/[id]`): rule-based filename→document_type
  classifier (`lib/classify.ts`), `classifyBatch` action sets types + PII + tier (red=juristic,
  green=agreement+FICA, amber=else), editable per-file type dropdown. **Verified 28/28 on real
  deal filenames.** Build green. Needs `0007`+`0008` run + push to go live.
- [x] **AI extraction wired** (`/api/extract`, OpenRouter). Downloads staging files, extracts text
  (docx via mammoth, text PDFs via pdf-parse, eml/txt as text), sends to LLM with strict JSON schema
  (`lib/extract.ts`), writes `extraction` rows; "Extract fields (AI)" button + proposed-fields view on
  the review screen; auto-classify on drop. Build verified. **Needs `OPENROUTER_API_KEY` in Vercel env
  + push.** Scanned-image PDFs (no text) return a "needs vision/OCR" note — that's the next extraction step.
- [x] **.eml unpacking** (`/api/unpack`, mailparser). Fixes the big gap: Bronwyn's `.eml` files bundle
  their attachments inside (e.g. 12 Eagles = 15 attachments in one 22 MB file). The route cracks each
  `.eml` open, extracts every attachment as its own staging `ingest_file`, keeps the body as text.
  Auto-runs on drop (unpack → classify); "Unpack emails" button on the review screen for existing batches.
  Build verified. Needs push (installs mailparser).
- [x] Fixes: default extraction model → `openai/gpt-4o-mini` (the `anthropic/claude-3.5-sonnet` slug
  returned "no endpoints" for the account — needs credit/enabling); batch auto-naming from the
  property/agreement/mandate doc (re-run Classify to apply — no more "Dropped files"). Build verified.
  Unpacking confirmed working live (batches now 16/19/32 files, tiers green/amber/red).
- [x] **Vision/OCR extraction** added to `/api/extract`. When a doc has no text, it sends the scanned
  PDF to OpenRouter with the `file-parser` plugin (`mistral-ocr` engine) or an image via vision, same
  JSON schema. Cost ≈ 3–5¢ per scanned agreement (OCR ~$2/1k pages + gpt-4o-mini structuring);
  ~$40–80 for the whole 500-folder migration. Build verified. Untested against live OpenRouter — the
  `file-parser`/`mistral-ocr` call needs a real run to confirm the plugin format.
- [x] Batch naming: rank-based (property_info→listing→agreement→mandate), plus a one-click
  **"Name batches from documents"** button on the queue that renames all generic "Dropped files"
  batches at once. Verified clean names on real files (e.g. "3 Oupad Morris to Wilson"). Build green.
- [x] **Extraction proven live** — text (7 The Grove docx, 14 fields, all correct incl. partnership seller)
  AND OCR (Oupad scanned agreement, 22 fields). Extended to **listing folders** (property_info / CMA /
  detailed_listing / mandate) so a mandate-only folder like 169 Links extracts property + asking price +
  mandate type, not just sales. Schema/prompt now cover listing.asking_price + mandate.type/expiry. Build green.
- [x] **Commit step built.** `0009_commit.sql`: `commit_batch(batch_id, fields jsonb)` RPC (security-definer,
  admin-gated) does atomic match-or-create → property (by deed) / party (by id_number, partnership-aware) /
  transfer / transfer_party / agreement / listing / mandate / conditions / commission, with safe casters.
  Editable proposed fields + "Commit to database" button on the review screen; `commitBatch` server action
  reshapes edits → RPC. Batch flips to `committed`. Build + SQL structure verified. **Needs `0009` run + push.
  RPC plpgsql untested at runtime — first real commit is the proof.**
- [x] **Deep extract + de-dupe.** Extractor now reads the top 6 docs (agreement + FICA + company docs),
  OCRs the executed agreement when it's a scan (so filled-in buyers come through), and captures
  company `registration_no` + directors/members/shareholders (`party_member`). Schema/prompt/mapping/reshape
  extended; commit handled by `0010_deep_commit.sql` (upsert_party stores reg no + members via upsert_individual).
  Classify now de-duplicates files ingested twice (folder had .eml + loose copies). Build + SQL verified.
  **Needs `0010` run + push. First real run confirms OCR-of-primary + member capture.**
- [x] **Property Record screens** built (`/properties` list + `/properties/[id]` detail): reads live
  property / erven / transfers / parties (+ juristic members) / agreements / milestones. Linked from
  dashboard. Committed deals are now viewable in the app, not just SQL. Build verified.
- [x] **Document promotion + viewer.** On commit, each classified file becomes a `document` row linked
  to the transfer + property (`ingest_file.committed_document_id` set, status→committed). Property Record
  now shows a **Documents** section per transfer with signed-URL view links (1h) and PII tags. Files stay
  in the `staging` bucket for now (private, staff-gated) — moving to dedicated documents/fica buckets is a
  later refinement. No new migration (document/document_link exist from 0004). Build verified.
  _Note: only NEW commits get documents; deals committed earlier (7 The Grove, Plot A4, Oupad) predate this._
- **⚠ Parallel-work note:** `0011_matching.sql` was added by Claude Code (not this session) — fuzzy
  trigram matching + `propose_matches` + explicit-link support. Good feature, BUT its `upsert_party`
  redefinition **dropped 0010's registration_no + members handling** (would regress juristic capture).
  **Fix: `0012_reconcile_upsert_party.sql`** merges both (explicit link + reg/members). Run order:
  …0010 → 0011 → **0012**. The matching functions are dormant until the app wires a match-review step.
- [x] **Post-hoc dupe finder** — `0013_dupe_finder.sql` + `/dupes` admin UI. Ships the browser-driven replacement for the manual DO-block merge. See top of file.
- [ ] Next: move files to documents/fica buckets; lead inbox; map; agent RLS test; juristic pre-commit matching.
- [ ] Commit `0007`, `0008`, `pilot_7_the_grove.sql`, `docs/drop-and-triage-spec.md` to GitHub.

**Scaling model (for ~500 folders):** decouple automated ingestion from human confirmation.
Bulk-drop (parent folder → one batch per subfolder), score each batch green/amber/red,
work a priority queue (active → recent → historical), one-click-approve green, merge-review
duplicates. "Two a day" = the first learning wave only, then waves of 25–50.

- **Hosting/deployment planned.** `dream-os/docs/deployment.md`. Recommended stack:
  **Next.js (React/TS) on Vercel** (auto-deploy from GitHub) + Supabase (EU) backend,
  app at `app.dreamknysna.co.za`. Personal data stays in Supabase; Vercel serves only the
  app shell (POPIA-safe). Path: scaffold Next.js + login → triage screen → deploy → DNS.
  _Pending Simon's nod on framework; only infra ask is DNS access for dreamknysna.co.za._

## Soon
- [ ] Reconcile the remaining PROJECT.md drift as screens/schema evolve.
- [ ] Conveyancer magic-link room RLS + client portal RLS (deferred from baseline).
- [ ] OCR pipeline for scanned/image PDFs (signed agreements come in image-only).

---

## Decisions this session
- Data-first sequencing: **lock schema → Supabase + storage + RLS → drop/triage loop → pilot on 7 The Grove → bulk migrate**, UI grown from there.
- Repo owned by Dream (`BronwynDream`), Simon accesses via collaborator grant, not by re-linking the connector.
- Interim "basic UI" = Supabase Studio (Table Editor + Storage) until the schema is proven against ~a dozen real folders.
- RLS baseline: admin full; agent scoped to transfers they lead; FICA bucket admin-only for now.
- Institute this `project.state.md`; keep it current each session.

## Open (needs Simon/Bronwyn)
- Supabase project-ref + whether to use CLI or SQL editor for first apply.
- Which historical folders to pilot after 7 The Grove (suggest Plot A4 next — exercises the juristic-party model).
- Lightstone API tier, P24/PP partner-feed credentials (still open from PROJECT.md).
