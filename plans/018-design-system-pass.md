# Plan 018: Design system pass — three separate PRs (system tokens, phone-width fixes, copy pass)

> **Executor instructions**: This plan is deliberately structured as
> **three PRs** — 018-a, 018-b, 018-c. Each PR has its own Scope,
> Steps, and Done criteria. Ship them sequentially in the order
> below; do NOT roll them into one big PR. The system pass (018-a)
> lands the tokens the other two consume. Run every verification
> command and honor STOP conditions per PR.
>
> **Screenshots are NOT the executor's job.** Claude (Cowork) takes
> before/after screenshots at 375px and 1440px on the live site
> (`dreamproperties.app`) after each deploy — Simon's decision
> 2026-09-28. The executor has no login credentials and must not
> handle them. Per-PR verification for the executor is `npm run
> typecheck` + `npm run build` + `npm run test:dedup` (+ `npm run
> lint` if it runs non-interactively — see notes per PR). Do NOT
> commit PNGs.
>
> **Drift check (run first, before 018-a)**:
> `git diff --stat ca0887a..HEAD -- app/globals.css app/layout.tsx app/components/TopBarClient.tsx app/dashboard app/compliance app/properties/[id]/page.tsx app/pipeline app/mandates app/estates app/erf-lookup app/contacts app/admin/valuation-rolls app/viewings app/map app/triage`
> If any listed file changed since this plan was written, re-read
> against the "Current state" excerpts of each PR before proceeding.

## Status

- **Priority**: P2 (product-shape / UX debt; not a blocker but every
  new page after this ships in the fixed system, which is cumulative
  win)
- **Effort**: L (three PRs; roughly one session each, ~2–4 hours per
  PR including manual verification)
- **Risk**: MED — 018-a touches `app/globals.css` and `app/layout.tsx`,
  both load-bearing across every page. Every page renders through the
  changed body background + font stack, so a regression is
  system-wide. Mitigation: manual verification at 375px AND 1440px is
  a hard done criterion, not a nice-to-have.
- **Depends on**: nothing. Composes with everything (any subsequent
  page work benefits automatically once 018-a lands). Do NOT touch
  plans 010–017 while executing this plan — they're queued
  independently and their patches will merge cleanly with the design
  system after this lands.
- **Category**: dx / tech-debt / UX
- **Planned at**: commit `ca0887a`, 2026-09-28

## Why this matters

Source: `docs/qa/2026-09-28-ux-audit.md`. Live-site UX audit at phone
width using the `frontend-design` and `estate-agency-design` skills.
Verdict quoted verbatim: *"The bones are good. Strong domain
vocabulary, a real signature (the deeds-office card with its 'IN
CONVEYANCING' stamp), mono-for-data mostly honoured, and a clear
dashboard. What drags it down is inconsistency, not concept: two
colour systems, a font that never loads, ~960 inline styles, and
several phone-width breakages. Fix the system first; most
screen-level problems then fall out cheaply."*

The audit numbered 18 items across P1/P2/P3. This plan covers the
first three of the audit's suggested sequence (items #1–#12 across
the three PRs). Screen-level UX work (audit items #13–#18) becomes
separate plans (numbered 019+ after this lands).

## Direction decisions (locked before writing this plan)

Simon confirmed 2026-09-28 evening:

1. **Keep Dream's navy + gold as the brand.** Header stays navy;
   primary buttons stay navy; the signature stamp (`--stamp`,
   aubergine) stays untouched. The brand identity is a decision that
   predates this plan.

2. **Make every surface warm paper.** Page background moves from
   `--mist` (cool blue-grey) to `--paper-0` (warm cream). Cards
   already use paper tokens; only the underlying page background
   changes. Brand on top, paper beneath. One system.

3. **Fraunces stays a display font.** Not body. Only used for
   card/section headings and the deeds-office title style; loaded
   via `next/font` so it actually renders (currently references it
   ~17 times but the font never loads, so those headings render in
   Times New Roman — the audit's #1 finding).

4. **No wholesale inline-style removal in this plan.** Audit item
   #8 (963 inline `style={{}}` blocks) is real but is the tail;
   moving inline styles to CSS classes is a per-file refactor that
   piggybacks on future page work, not a system pass. Just the
   fonts, background, focus, buttons in 018-a. Simon noted this
   explicitly: "retire inline styles file by file as each screen is
   touched (#8, #9)."

## Overall approach

Three PRs, sequenced. Each PR is a full commit + screenshots +
plan-status update.

```
PR 018-a  System pass — fonts, paper background, focus, buttons.
PR 018-b  Phone-width fixes — overflow, dashboard rows, contrast, header.
PR 018-c  Copy pass — user-facing labels, empty-state actions.
```

**Do not merge them into one PR.** The audit's sequencing rationale
is that 018-a lands the tokens the other two consume — a single big
PR would mix "system change every page consumes" with "one-file copy
change on the compliance page" and make review hell.

## Commands you will need (all three PRs)

| Purpose                   | Command                                         | Expected                                             |
|---------------------------|-------------------------------------------------|------------------------------------------------------|
| Typecheck                 | `npm run typecheck`                             | exit 0                                               |
| Build                     | `npm run build`                                 | exit 0, 49+ routes                                   |
| Dedup regression          | `npm run test:dedup`                            | PASS                                                 |
| Lint (opt.)               | `npm run lint -- --strict` or `next lint`       | exit 0 IF non-interactive; skip if it prompts        |

`npm run lint` currently triggers an interactive ESLint setup on
first run in a fresh worktree (no `.eslintrc.json` in the repo).
The executor should run it once; if it prompts, cancel and skip —
lint remains a plan-012-follow-up. Do NOT commit `.eslintrc.json`
scaffolded by that prompt in this plan.

## Screenshots — NOT the executor's job

Claude (Cowork) captures before/after screenshots at 375px and
1440px on the live site (`dreamproperties.app`) after each PR
deploys, per Simon's 2026-09-28 decision. The executor has no
login credentials and must not handle them. **Do not commit PNGs
to the repo.** The executor's only verification is the commands
in the table above.

The audit doc (`docs/qa/2026-09-28-ux-audit.md`) captures the
pre-plan-018 state. Post-PR screenshots land wherever Cowork
stores them (not in this repo).

## Git workflow

- Do NOT push. Simon owns push after reviewing each PR.
- One commit per PR (three total). Commit messages:
  - `Plan 018-a: system pass — fonts, paper background, focus, buttons`
  - `Plan 018-b: phone-width fixes — overflow, attention rows, contrast, header`
  - `Plan 018-c: copy pass — user-facing labels + empty-state actions + button-trio migration`
- Each commit contains **only code + CSS changes**. No PNGs.
- Push is Simon's step per house rules.

---

## PR 018-a — System pass (fonts, paper background, focus, buttons)

Fixes audit items **#1, #7, #10, #11, #12** at the source. Every
subsequent page automatically inherits the fix.

### Current state (PR 018-a)

**Font loading — `app/layout.tsx` (all 41 lines):**

```tsx
<head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
    rel="stylesheet"
  />
</head>
```

Loads Inter + JetBrains Mono via Google Fonts CDN. **Fraunces is
never loaded.** Grep confirms ~17 sites in `app/**/*.tsx` set
`fontFamily: "'Fraunces', 'Cormorant Garamond', serif"` inline
(`app/pipeline/page.tsx:329, 343`; `app/mandates/page.tsx:365`;
`app/compliance/page.tsx:331, 391, 598, 863`; `app/viewings/page.tsx:205, 267`;
`app/estates/page.tsx:91`; `app/contacts/[id]/page.tsx:285`;
`app/erf-lookup/ErfResultsTable.tsx:123`;
`app/admin/valuation-rolls/page.tsx:141`;
`app/properties/[id]/DealCompliance.tsx:114, 518`;
`app/properties/[id]/FixturesAndMovables.tsx:160`; and one
`<div style="font-family:'Fraunces',serif;...">` embedded in a
Mapbox popup at `app/map/MapView.tsx:625`). All render as Times New
Roman today.

**Body background — `app/globals.css:115-120`:**

```css
html, body {
  margin: 0;
  padding: 0;
  background: var(--mist);
  color: var(--ink);
  font-family: "Inter", -apple-system, sans-serif;
```

`--mist` is `#EDF0F8` — cool blue-grey. Cards live on top in warm
paper tokens (`--paper-0`, `--paper-1`), producing the "warm paper
cards on a cool page" mismatch the audit calls out (#7).

**Focus rules — three total, all input-scoped:**

```
app/globals.css:186 input:...:focus { outline: 2px solid var(--gold); ... }
app/globals.css:316 .type-select:focus { outline: 2px solid var(--gold); ... }
app/globals.css:349 .kv-input:focus { outline: 2px solid var(--gold); ... }
```

No global `:focus-visible` rule; buttons, links, and interactive
divs have no visible focus indicator when tabbed to.

**Reduced-motion — two blocks:**

```
app/globals.css:577  @media (prefers-reduced-motion: reduce) { ... }
app/globals.css:2228 @media (prefers-reduced-motion: reduce) { ... }
```

Both scope specific animations (a marquee + a stamp shimmer).
Neither is a global "wrap all transitions" rule.

**Button styles (five defined in globals.css):**

- `button.primary` (line 188) — navy background, white text
- `button.ghost` (line 269) — transparent, subtle hover
- `.cta` (line 281) — same shape as primary
- `.ghost-dark` (line 325) — bordered navy on paper
- `.ghost-link` (line 275) — link-shaped ghost

Property Record has three visible on one card per audit (#11):
bordered sans, bordered sans small, navy-outlined mono caps. Some
are inline styles overriding class defaults.

**Tokens in place already** (`app/globals.css:26-49`):
- `--paper-0` (aliases `--paper`) — warm cream `#FBF9F4`. Available.
- `--accent-600` = `var(--navy)` — brand navy already aliased into
  the accent slot. This is what buttons will bind to.
- `--gold` — for focus ring on navy backgrounds.

Fraunces / Inter / JetBrains Mono are the three fonts the audit
names. `next/font` is `next/font/google` for hosted Google Fonts;
self-hosts them at build time so no CDN round-trip.

### Scope (PR 018-a)

**In scope:**
- `app/layout.tsx` (replace Google Fonts `<link>` with `next/font/google`
  imports for Inter, Fraunces, JetBrains Mono; set CSS variables on
  the `<body>`)
- `app/globals.css` — surgical edits:
  - Change body `background: var(--mist)` → `background: var(--paper-0)`
    (line 118)
  - Change body `font-family: "Inter"...` → `font-family: var(--font-body)`
    (line 120)
  - Migrate every `font-family: "Inter"` and `font-family: "JetBrains Mono"`
    string in `globals.css` to the new tokens (~15 sites; grep-verified
    list in Step 2)
  - Add a global `:focus-visible` rule (below tokens block, above the
    existing input `:focus` rules)
  - Add one all-covering `@media (prefers-reduced-motion: reduce)`
    rule that disables `transition` and `animation` globally
  - Define exactly three button classes: `.btn-primary`, `.btn-secondary`,
    `.btn-quiet`. Existing `button.primary`, `.cta`, `.ghost-dark`,
    `.ghost-link` stay defined so old markup keeps working — 018-c
    migrates callers to the new trio and deletes the old classes.
- **Every inline `fontFamily` string in `app/**/*.tsx`.** Migrate:
  - `"'Fraunces', 'Cormorant Garamond', serif"` → `"var(--font-display)"`
  - `"'Fraunces', serif"` → `"var(--font-display)"`
  - `"Inter", "-apple-system", sans-serif` → `"var(--font-body)"`
  - `"'JetBrains Mono', ui-monospace, monospace"` → `"var(--font-mono)"`
  - Also the ONE embedded `<div style="font-family:'Fraunces',serif;...">`
    inside a Mapbox popup HTML template in `app/map/MapView.tsx:625`.
  - Rationale: `next/font` renames CSS families to hashed identifiers
    like `__Fraunces_a1b2c3` and only sets the plain `Fraunces` name
    via the CSS variable it injects on `<html>`. A literal
    `fontFamily: "'Fraunces', ..."` string in inline JSX does NOT
    resolve to the loaded font — the browser looks up "Fraunces" as
    a font family name, finds nothing (only `__Fraunces_xxx` is
    registered), falls back to `Cormorant Garamond` (also absent),
    finally lands on generic `serif` = Times New Roman on macOS/iOS.
    Result: the audit's #1 finding stays broken even after Step 1
    loads Fraunces via `next/font`. Every inline string must move to
    `var(--font-display)`.
- Currently identified inline sites (grep-verified 2026-09-28):
  - `app/pipeline/page.tsx:329, 343` (Fraunces)
  - `app/mandates/page.tsx:365` (Fraunces)
  - `app/compliance/page.tsx:331, 391, 598, 863` (Fraunces)
  - `app/estates/page.tsx:91` (Fraunces)
  - `app/erf-lookup/ErfResultsTable.tsx:123` (Fraunces)
  - `app/contacts/[id]/page.tsx:285` (Fraunces)
  - `app/admin/valuation-rolls/page.tsx:141` (Fraunces)
  - `app/viewings/page.tsx:205, 267` (Fraunces)
  - `app/properties/[id]/DealCompliance.tsx:114, 518` (Fraunces)
  - `app/properties/[id]/FixturesAndMovables.tsx:160` (Fraunces)
  - `app/map/MapView.tsx:625` (Fraunces, inside a template-string
    HTML fragment)
  - **Also Inter and JetBrains Mono** — grep for those before
    starting (see Step 4).

**Out of scope for 018-a:**
- Any component structure change beyond `fontFamily` swaps.
- Any wholesale inline-style refactor (audit #8 is per-file
  follow-up work; 018-a only touches inline `fontFamily`).
- Any content copy change (that's 018-c).
- Any per-page CSS rewrite. `globals.css` stays 2 511 lines; audit
  item #9 (split into modules) is a future plan.
- Any change to `--mist` itself. It stays defined and still used by
  various pill and card rules; only the body background stops
  reaching for it.
- Migration of `.cta` / `.ghost-dark` / `.ghost-link` call sites —
  that's 018-c.

### Steps (PR 018-a)

#### Step 1: Migrate font loading to `next/font/google`

**Do:**

1. Rewrite `app/layout.tsx`. Replace the Google Fonts `<link>`
   pattern with `next/font/google` imports and bind them to CSS
   variables. Target shape:

   ```tsx
   import type { Metadata, Viewport } from "next";
   import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
   import "./globals.css";

   // Body sans. Load the weights the app actually uses (grep --font-weight
   // across globals.css + inline styles shows 400/500/600/700; 300 and 800
   // used only in a couple of headings and can be dropped if bundle size
   // matters). Latin subset only — Bronwyn's book is EN + a few Afrikaans
   // place names, all Latin.
   const inter = Inter({
     subsets: ["latin"],
     display: "swap",
     weight: ["400", "500", "600", "700"],
     variable: "--font-body",
   });

   // Display serif. Used for card headings, page titles on some pages,
   // the deeds-office title style. Reference is `docs/qa/2026-09-28-ux-audit.md`
   // #1 — was never loaded before.
   const fraunces = Fraunces({
     subsets: ["latin"],
     display: "swap",
     weight: ["400", "500", "600"],
     style: ["normal"],
     variable: "--font-display",
   });

   // Mono for data (Rand amounts, deed numbers, extent, coordinates).
   const jetbrainsMono = JetBrains_Mono({
     subsets: ["latin"],
     display: "swap",
     weight: ["400", "500", "600"],
     variable: "--font-mono",
   });

   export const metadata: Metadata = {
     title: "Dream Properties OS",
     description: "Dream Knysna operating system",
   };

   export const viewport: Viewport = {
     width: "device-width",
     initialScale: 1,
     viewportFit: "cover",
   };

   export default function RootLayout({
     children,
   }: {
     children: React.ReactNode;
   }) {
     return (
       <html
         lang="en"
         className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
       >
         <body>{children}</body>
       </html>
     );
   }
   ```

   Remove the `<head>` block entirely (no more Google Fonts CDN
   preconnect / stylesheet).

2. `npm run build` — confirm `next/font` bundles the three fonts
   without error. Build log should show three font entries being
   optimised.

**Verify**:
- `npm run typecheck` exits 0
- `npm run build` exits 0 with mentions of font optimisation
- `grep -n "fonts.googleapis.com" app/layout.tsx` returns nothing
- `grep -n "next/font/google" app/layout.tsx` returns three matches

**STOP if**:
- `next/font/google` can't fetch the fonts at build time (rare;
  build machine has no network). Fall back to `next/font/local`
  with self-hosted files — but that requires downloading the
  font files first, which is a scope expansion. Report and stop.

#### Step 2: Add font tokens to `globals.css` and migrate `font-family` strings

**Do:**

1. Do NOT add `--font-body` / `--font-display` / `--font-mono` tokens
   to `:root` in `globals.css`. `next/font`'s `variable: "--font-body"`
   config (Step 1) already sets those CSS variables on `<html>`.
   Adding aliases would shadow the real values.

   Optional documentation comment: add a small comment near the
   existing `--step-*` block noting the contract:

   ```css
     /* Font tokens (2026-09-28). next/font (app/layout.tsx) injects
        --font-body, --font-display, --font-mono on <html>. Callers
        reach for them via var(--font-*). */
   ```

2. Replace every `font-family: "Inter", -apple-system, sans-serif;`
   in `app/globals.css` with `font-family: var(--font-body);`.
   Grep-verify sites before changing:

   ```
   grep -n 'font-family: "Inter"' app/globals.css
   ```

   Expected sites (approx from earlier grep): lines 120, 125, 295, 322.
   Change each. Do NOT change `.mono` or `table.queue th` — those
   should migrate to `var(--font-mono)`.

3. Replace every `font-family: "JetBrains Mono", ...` in
   `app/globals.css` with `font-family: var(--font-mono);`. Grep:

   ```
   grep -n 'font-family: "JetBrains Mono"' app/globals.css
   ```

   Expected sites: 132, 164, 259, 267, 301, 334, 359, 369. Change each.

4. Do NOT touch `fontFamily` strings in `app/**/*.tsx` in this step.
   Step 4 below handles them systematically.

**Verify**:
- `grep -c 'font-family: "Inter"' app/globals.css` returns 0
- `grep -c 'font-family: "JetBrains Mono"' app/globals.css` returns 0
- `grep -c 'var(--font-body)' app/globals.css` returns >= 4
- `grep -c 'var(--font-mono)' app/globals.css` returns >= 8

**STOP if**:
- Any grep returns unexpected sites (e.g. an "Inter" mention in a
  comment string — leave those alone; only change actual CSS
  `font-family` declarations).

#### Step 3: Move body background from `--mist` to `--paper-0`

**Do:**

1. In `app/globals.css:115-120`, change:

   ```css
   html, body {
     margin: 0;
     padding: 0;
     background: var(--mist);
     color: var(--ink);
     font-family: "Inter", -apple-system, sans-serif;
   ```

   To:

   ```css
   html, body {
     margin: 0;
     padding: 0;
     background: var(--paper-0);
     color: var(--ink-900);
     font-family: var(--font-body);
   ```

   Note: `color: var(--ink)` also moves to `--ink-900` (warm near-black)
   to sit properly on paper. Cool `--ink` (`#15203A`) on warm paper
   reads slightly wrong; `--ink-900` (`#1F1B16`) is the paper-side
   equivalent. This is a small colour drift but it lands the
   "one system, warm on top of paper" direction.

2. Grep for other `background: var(--mist)` sites that render at
   page-background scale. Card / pill / hover states can keep
   `--mist` (it stays defined). Only change sites that visually act
   as "the page":

   ```
   grep -n 'background: var(--mist)' app/globals.css
   ```

   Review each. Most should stay (pill hover, dropdown, chip
   background). If you find a site that IS a page-scale background,
   change it and note in the commit. Conservative default: change
   nothing beyond the body rule unless the fix is obvious.

**Verify**:
- `grep -n 'background: var(--paper-0)' app/globals.css` includes
  the body rule
- Browser at 375px + 1440px: the underlying page background is warm
  cream, not blue-grey. Cards no longer look like they're floating
  on a mismatched substrate.

**STOP if**:
- Any card that was designed to contrast with `--mist` now looks
  bleached against `--paper-0`. Note the site; do NOT redesign it
  in this PR. Copy any breaks into a follow-up list at the end of
  018-a's completion report.

#### Step 4: Migrate every inline `fontFamily` string in `app/**/*.tsx` to the CSS variables

**Rationale (re-stated because this step is load-bearing):**
`next/font/google` mints hashed family names like `__Fraunces_a1b2c3`
under the hood. It only exposes the plain `Fraunces` name via a CSS
variable (`--font-display`) it injects on `<html>`. Any inline
`fontFamily: "'Fraunces', ..."` string in JSX names a family
`Fraunces` that isn't registered on the page — the browser falls
back to `Cormorant Garamond` (also absent), then generic `serif`,
finally Times New Roman on macOS/iOS. Result: audit #1 stays broken
even after Step 1 loads the font. All inline strings must be
converted to `var(--font-display)`.

**Do:**

1. Run these greps to enumerate every site:

   ```
   grep -rn "fontFamily.*Fraunces" app/ --include="*.tsx" --include="*.ts"
   grep -rn "fontFamily.*Cormorant" app/ --include="*.tsx" --include="*.ts"
   grep -rn "fontFamily.*'Inter'\|fontFamily.*\"Inter\"" app/ --include="*.tsx" --include="*.ts"
   grep -rn "fontFamily.*JetBrains Mono\|fontFamily.*JetBrains_Mono" app/ --include="*.tsx" --include="*.ts"
   ```

   Confirm the site list matches (or expands on) the Scope section's
   inventory. Add any newly-found sites to the mental list.

2. For each hit, replace the string per this mapping:

   | Old inline value                                                | New value                     |
   |-----------------------------------------------------------------|-------------------------------|
   | `"'Fraunces', 'Cormorant Garamond', serif"`                     | `"var(--font-display)"`       |
   | `"'Fraunces', serif"`                                           | `"var(--font-display)"`       |
   | `"Fraunces, serif"` (no quotes)                                 | `"var(--font-display)"`       |
   | `"Inter, -apple-system, sans-serif"` (any variant)              | `"var(--font-body)"`          |
   | `"'JetBrains Mono', ui-monospace, monospace"` (any variant)     | `"var(--font-mono)"`          |

   Example — before at `app/pipeline/page.tsx:329`:

   ```tsx
   fontFamily: "'Fraunces', 'Cormorant Garamond', serif",
   ```

   After:

   ```tsx
   fontFamily: "var(--font-display)",
   ```

3. **`app/map/MapView.tsx:625` is different — the font name lives
   inside a template-literal HTML string embedded in a Mapbox popup**:

   ```ts
   <div style="font-family:'Fraunces',serif;...">
   ```

   Replace with:

   ```ts
   <div style="font-family:var(--font-display);...">
   ```

   Mapbox HTML popups render inside the Mapbox container, which is a
   descendant of `<html>`, so the CSS variable resolves.

4. Do NOT introduce new inline `style={{}}` blocks or refactor
   existing markup. Only change the string value.

**Verify**:
- `grep -rn "fontFamily.*Fraunces" app/ --include="*.tsx" --include="*.ts"`
  returns 0 lines
- `grep -rn "fontFamily.*Cormorant" app/ --include="*.tsx" --include="*.ts"`
  returns 0 lines
- `grep -rn "fontFamily.*'Inter'\|fontFamily.*\"Inter\"" app/ --include="*.tsx" --include="*.ts"`
  returns 0 lines (or only comment strings, which is fine)
- `grep -rn "fontFamily.*JetBrains" app/ --include="*.tsx" --include="*.ts"`
  returns 0 lines
- `grep -rn "font-family:'Fraunces'\|font-family:\"Fraunces\"" app/ --include="*.tsx" --include="*.ts"`
  returns 0 lines (catches the Mapbox popup HTML string form)
- `npm run typecheck` exits 0
- `npm run build` exits 0

**STOP if**:
- A site has `fontFamily` computed dynamically (e.g. from props or a
  helper function). Trace to the source; the mapping still applies.
- Any TSX site uses `fontFamily` with a family this plan didn't
  scope (e.g. a decorative one-off). Report and stop; do not invent
  a new token.

#### Step 5: Add global `:focus-visible` and reduced-motion rules

**Do:**

1. In `app/globals.css`, immediately after the `html, body` block
   (around line 122), add:

   ```css
   /* Global :focus-visible (2026-09-28). Applies to every interactive
      element by default. Overridden by input-specific :focus rules
      further down where those need a different treatment. Gold ring
      reads on both navy header surfaces and warm paper body. */
   :focus-visible {
     outline: 2px solid var(--gold);
     outline-offset: 2px;
     border-radius: 2px;
   }

   /* Reduced-motion — global (2026-09-28). Users with the OS
      "reduce motion" preference get animations and transitions
      cancelled everywhere. Individual rules that need animation for
      correctness (e.g. progress spinners) can opt in by scoping their
      animation inside :not(.reduce-motion) or using the OS preference
      directly. */
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important;
       scroll-behavior: auto !important;
     }
   }
   ```

2. Leave the existing input-scoped `:focus` rules (lines 186, 316,
   349) alone. They target `input` elements specifically and provide
   a stronger gold-on-border indication for form fields.

3. Leave the existing `@media (prefers-reduced-motion: reduce)`
   blocks at 577 and 2228 alone. They target specific animations;
   the new global rule adds a floor.

**Verify**:
- `grep -c ':focus-visible' app/globals.css` returns >= 1
- `grep -c '(prefers-reduced-motion: reduce)' app/globals.css`
  returns 3 (the two existing + the new global)
- Browser test: tab through the dashboard with keyboard only. Every
  link, button, and interactive control shows a gold outline on
  focus. Set macOS System Settings → Accessibility → Display →
  Reduce motion, then reload; animations pause.

**STOP if**:
- The new focus outline breaks an existing rule that expected NO
  outline (e.g. a decorative "click here" tile that already has
  a hover state and doesn't want two indicators layered). Note the
  site; scope the exception with `:focus-visible:not(.<class>)` or
  document as a follow-up. Do not remove the global rule.

#### Step 6: Define `.btn-primary` / `.btn-secondary` / `.btn-quiet` trio

**Do:**

1. In `app/globals.css`, find the button section (starts around line
   188 with `button.primary`). Add three new classes ABOVE the
   existing definitions:

   ```css
   /* Button trio (2026-09-28). Reference is docs/qa/2026-09-28-ux-audit.md
      #11 — property record has three visible button styles on one card.
      Consolidate on three named classes.
      Existing .cta, .ghost-dark, .ghost-link stay defined so old markup
      keeps working; new markup reaches for .btn-primary/.btn-secondary/
      .btn-quiet. Full migration is per-page follow-up. */

   .btn-primary {
     background: var(--accent-600);          /* var(--navy) */
     color: var(--white);
     border: 1px solid var(--accent-600);
     padding: 10px 18px;
     border-radius: var(--radius-md);
     font-family: var(--font-body);
     font-size: 14px;
     font-weight: 600;
     cursor: pointer;
     transition: background 120ms ease, box-shadow 120ms ease;
   }
   .btn-primary:hover:not(:disabled) {
     background: var(--accent-700);          /* var(--estuary) */
     box-shadow: var(--shadow-sm);
   }
   .btn-primary:disabled {
     opacity: 0.55;
     cursor: default;
   }

   .btn-secondary {
     background: transparent;
     color: var(--accent-600);
     border: 1px solid var(--accent-600);
     padding: 9px 17px;
     border-radius: var(--radius-md);
     font-family: var(--font-body);
     font-size: 14px;
     font-weight: 600;
     cursor: pointer;
     transition: background 120ms ease;
   }
   .btn-secondary:hover:not(:disabled) {
     background: var(--mist);
   }

   .btn-quiet {
     background: transparent;
     color: var(--ink-700);
     border: none;
     padding: 8px 12px;
     border-radius: var(--radius-md);
     font-family: var(--font-body);
     font-size: 13px;
     font-weight: 500;
     cursor: pointer;
     transition: background 120ms ease, color 120ms ease;
   }
   .btn-quiet:hover:not(:disabled) {
     background: var(--paper-1);
     color: var(--ink-900);
   }
   ```

2. Do NOT delete the existing `button.primary`, `.cta`, `.ghost-dark`,
   `.ghost-link`. They stay as-is. The new trio is opt-in.

3. Do NOT change any existing markup that uses the old classes.
   Migration is per-page follow-up.

**Verify**:
- `grep -c '\.btn-primary\|\.btn-secondary\|\.btn-quiet' app/globals.css`
  returns >= 6 (definitions + hover/disabled states)
- Old button classes still render the same. Property Record and any
  other page using `button.primary` / `.cta` / `.ghost-dark` looks
  identical to before this PR.

**STOP if**:
- Adding the new classes triggers a name collision with an existing
  class (unlikely — no `.btn-*` classes exist per grep). If it does,
  rename the new class rather than dropping the old.

#### Step 7: Commit

**Do:**
1. `git status` — confirm the changed set matches the Scope list
   (roughly: `app/layout.tsx`, `app/globals.css`, and ~15–17 TSX
   files with `fontFamily` swaps).
2. Commit with the message:
   `Plan 018-a: system pass — fonts, paper background, focus, buttons`
3. Do NOT push. Do NOT update `plans/README.md` (the reviewer
   maintains the index — dispatcher override per closing-the-loop
   protocol).
4. Do NOT commit any screenshot files.

**Verify**:
- `git log --oneline -1` shows the commit
- `git status` clean
- `grep -rn "\.png$" $(git diff-tree --no-commit-id --name-only -r HEAD) 2>/dev/null` returns nothing (no PNGs in the commit)

### Done criteria (PR 018-a)

Machine-checkable. ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` exits 0
- [ ] `npm run test:dedup` exits 0
- [ ] `grep -n "fonts.googleapis.com" app/layout.tsx` returns nothing
- [ ] `grep -c "next/font/google" app/layout.tsx` >= 1
- [ ] `grep -c "var(--font-body)" app/globals.css` >= 4
- [ ] `grep -c "var(--font-mono)" app/globals.css` >= 8
- [ ] `grep -n "background: var(--paper-0)" app/globals.css` shows
      the body rule
- [ ] `grep -c ":focus-visible" app/globals.css` >= 1
- [ ] `grep -c "prefers-reduced-motion" app/globals.css` == 3
- [ ] `grep -c "\.btn-primary\|\.btn-secondary\|\.btn-quiet" app/globals.css` >= 6
- [ ] **Zero literal font family names in TSX** — all four greps
      return 0 non-comment lines:
      - `grep -rn "fontFamily.*Fraunces" app/ --include="*.tsx" --include="*.ts"`
      - `grep -rn "fontFamily.*Cormorant" app/ --include="*.tsx" --include="*.ts"`
      - `grep -rn "fontFamily.*['\"]Inter['\"]" app/ --include="*.tsx" --include="*.ts"`
      - `grep -rn "fontFamily.*JetBrains" app/ --include="*.tsx" --include="*.ts"`
      - `grep -rn "font-family:['\"]?Fraunces" app/ --include="*.tsx" --include="*.ts"` (Mapbox popup form)
- [ ] `git status` clean; commit shipped
- [ ] No PNG files in the commit

### STOP conditions (PR 018-a)

- `next/font/google` fails to bundle at build time (network / DNS).
- Any grep finds unexpected sites the plan didn't scope.
- A TSX file uses `fontFamily` with a family this plan didn't
  scope (e.g. a decorative one-off).

---

## PR 018-b — Phone-width fixes (overflow, dashboard rows, compliance contrast, header, form controls, full-bleed band)

Fixes audit items **#2, #3, #4, #17** plus three items Simon added after
Cowork's live 018-a verification (2026-09-28):

- **Form controls don't inherit fonts.** Some `<button>` renders as Arial
  because `button/input/select/textarea` need explicit `font: inherit`.
  User-facing: buttons look sans-serif-but-wrong, especially against the
  now-loaded Inter body.
- **Navy header band + gold tideline stop short of the right edge at
  375px**, leaving a pale strip. The `.app-head` element or its container
  is width-constrained; needs to be full-bleed on phones.
- **Deeds-card stamp still overhangs and clips "IN CONVEYANCING"** at
  375px, even though `.record-plate` has `overflow: hidden`. The mobile
  breakpoint for stamp resize is at `max-width: 700px`; needs a stronger
  contain at `≤480px` per Simon's directive.

Runs after 018-a lands.

### Current state (PR 018-b)

**Horizontal overflow candidates (audit #2):**
- Deeds-office card stamp — absolutely positioned, overhangs its
  card. Suspect on Property Record.
- Pipeline board — 8 columns side-scrolled per audit #13; on
  Pipeline it's intentional but on the dashboard's Pipeline embed
  it may bleed.
- `min-width: 200px` sites in `globals.css` at ~L1426 and ~L2504
  (per audit; verify exact line before editing).

**Dashboard Attention rows (audit #3):** `app/dashboard/page.tsx:275+`
renders `<ul className="dash-attention-list">`; each item is an
`<li>` with primary/secondary/payload/variant per line 162-170. On
phones the red status text takes the width, collapsing address to
"3." or "7…". Fix: stack status under address below ~480px.

**Compliance link contrast (audit #4):** `app/compliance/page.tsx:184-192`:

```tsx
<Link href="/settings" style={{ color: "var(--navy)", fontWeight: 600 }}>
  Settings
</Link>
```

Navy text (`#132B84`) on a navy header (per `.app-head` at
`app/globals.css:252` — background likely inherits page or is styled
navy). WCAG contrast fails outright. Same treatment on `/team`
link at 189-192.

**Mobile header crowding (audit #17):** `app/components/TopBarClient.tsx`
has hamburger + brand + nav + Sign out button (`topbar-signout` at
line 161). At 375px these compete. Simon's ask: move Sign out into
the menu; keep logo + menu + optionally one quick action.

### Scope (PR 018-b)

**In scope:**
- `app/globals.css` — new rules and media queries for:
  - **Base**: `button, input, select, textarea { font: inherit; }` so
    form controls stop computing to Arial (Simon's addition #1,
    2026-09-28)
  - **Full-bleed navy band on phones**: at `≤640px` (aligning with the
    existing `.app-body` mobile block), make `.app-head` extend
    edge-to-edge — likely `margin-inline: -16px; padding-inline: 16px`
    OR `width: 100vw; margin-left: calc(50% - 50vw)` — pick whichever
    the DOM supports without scrollbar side-effects. Same treatment
    for the `.tideline` element when it sits under the band (Simon's
    addition #2)
  - **Deeds-card stamp contained at `≤480px`**: extend the existing
    `.registered-stamp` media query (currently at `≤700px`) with a
    stricter `≤480px` variant that either shrinks the SVG further,
    repositions it entirely inside the plate, or clips harder via
    `contain: layout paint` on `.record-plate`. Verify the "IN
    CONVEYANCING" text renders fully at 375px (Simon's addition #3)
  - `.dash-attention-list` items stacking on phones
  - `.topbar-signout` hidden on narrow, shown inside menu drawer
  - Fix for the identified horizontal overflow offender per screen
- `app/compliance/page.tsx` — change the inline `color: var(--navy)`
  on the Settings/Team links to a light-on-dark colour (gold or
  white) with appropriate weight
- `app/components/TopBarClient.tsx` — move Sign out inside the
  hamburger drawer; remove it from the top bar
- `app/dashboard/page.tsx` — nothing structural if the CSS
  stacking works; touch only if the markup can't be styled
  responsively

**Out of scope:**
- Any change to the pipeline mobile UX (audit #13 — separate plan)
- Any change to the property record hierarchy (audit #14 — separate plan)
- The full `properties list` redesign (audit #15)
- The compliance page's grouping / pill duplication (audit #16)

### Steps (PR 018-b)

#### Step 0 (fast wins): `font: inherit` on form controls + full-bleed navy band

Two small edits to `app/globals.css`. Do these first — the executor can
land them with high confidence before diagnosing the harder overflow
case.

**Do:**

1. Immediately after the `html, body { ... }` rule near the top of
   `app/globals.css` (around line 117-121), add:

   ```css
   /* Form controls don't inherit fonts by default. Without this,
      <button> renders as Arial on macOS/Chrome even after next/font
      loads Inter globally (Simon, 2026-09-28 — verified live). */
   button, input, select, textarea {
     font: inherit;
   }
   ```

   Placement: after `html, body` and before the `:focus-visible` rule
   (018-a's Step 5).

2. In the existing `@media (max-width: 640px)` block (around line 2545),
   extend `.app-head` so its background reaches the viewport edges. The
   current rule is:

   ```css
   .app-head {
     padding-left: 16px;
     padding-right: 16px;
   }
   ```

   Change to (or replace the whole `.app-head` sub-block with):

   ```css
   .app-head {
     /* Full-bleed on phones so the navy band and its gold tideline
        reach the viewport edges (Simon, 2026-09-28). Uses the
        100vw / calc trick because .app-head lives inside <main> which
        has its own padding at this breakpoint. */
     margin-left:  calc(50% - 50vw);
     margin-right: calc(50% - 50vw);
     padding-left: 16px;
     padding-right: 16px;
   }
   .tideline {
     /* Same treatment when tideline sits directly under .app-head. */
     margin-left:  calc(50% - 50vw);
     margin-right: calc(50% - 50vw);
   }
   ```

   Rationale: `calc(50% - 50vw)` computes a negative margin equal to
   the width of `<main>`'s left padding, pulling the element out to
   the viewport edge without affecting layout of following elements.
   Works with any parent padding as long as `<main>` doesn't set
   `overflow: hidden`.

   Alternative if the trick produces a horizontal scrollbar
   (unlikely — `overflow-x: hidden` on body would prevent it): use
   `width: 100vw; position: relative; left: 50%; transform: translateX(-50%);`
   pattern instead. Report if you had to switch.

3. Verify the fix visually is Cowork's job post-deploy; here just check
   that the CSS compiles and the rules land in the built stylesheet.

**Verify**:
- `grep -n "button, input, select, textarea { font: inherit" app/globals.css`
  returns 1 match
- `grep -n "calc(50% - 50vw)" app/globals.css` returns >= 2 matches
  (one for `.app-head`, one for `.tideline`)
- `npm run typecheck` exits 0
- `npm run build` compiles (pre-existing prerender errors for /login
  and /forgot-password are acceptable — Supabase env vars missing
  locally is a known worktree constraint)

**STOP if**:
- The `font: inherit` rule accidentally deletes an existing font
  declaration elsewhere. It shouldn't — `font: inherit` is a shorthand
  that resets all font properties to inherit and doesn't collide with
  other rules the way `font-family: inherit` would.
- The `calc(50% - 50vw)` approach produces a horizontal scrollbar in
  the built HTML output. Check by loading the built page locally if
  possible; if not, note the risk and let Cowork verify.

#### Step 1: Find the horizontal-overflow offender

**Do:**

1. Load `/dashboard` in dev mode at 375px. Open DevTools →
   Elements → find the widest element wider than 375px. Chrome
   DevTools has a "Layout" pane; Safari's Web Inspector shows
   scroll-width per element.
2. Note the culprit. Common suspects:
   - `.record-actions` (Property Record admin bar; may set fixed
     `min-width` on child buttons)
   - `.dash-attention-list` (Attention row items may not wrap)
   - The Property Record deeds card + its stamp overlay
     (`.registered-stamp` or similar, positioned absolutely)
3. Repeat on `/properties`, `/properties/<id>`, `/compliance`.
4. Report findings in the commit message.

**Verify**:
- The offender is identified for each of the four screens.

**STOP if**:
- No single offender exists — every screen has a different one.
  That's normal; fix per-screen in Step 2. Do NOT scope creep into
  fixing the pipeline or other screens beyond the four listed
  above.

#### Step 2: Fix the overflow per screen + contain the deeds stamp at ≤480px

**Do:**

1. **Deeds card stamp — Simon-confirmed live**: even though `.record-plate`
   has `overflow: hidden` and the existing `@media (max-width: 700px)`
   shrinks the stamp to 152×64 at `top: 8px; right: 8px`, the stamp
   still overhangs at 375px and clips "IN CONVEYANCING" visibly.

   Add a stricter mobile block. Insert into `app/globals.css` after
   the existing `@media (max-width: 700px) { .registered-stamp { ... } }`
   block (search for it):

   ```css
   /* PR 018-b, Simon's #3 (2026-09-28): the ≤700px block leaves the
      stamp overhanging at 375px because the SVG's rendered text width
      exceeds the shrunk container. Belt-and-braces at ≤480px:
      - Shrink further (128×54)
      - Add explicit contain rule so the parent clips harder
      - Reposition so the right edge sits fully inside the plate's
        content box */
   @media (max-width: 480px) {
     .registered-stamp {
       width: 128px;
       height: 54px;
       top: 10px;
       right: 12px;
       opacity: 0.55;
     }
     .record-plate {
       /* Stronger than overflow:hidden — contain layout AND paint. */
       contain: layout paint;
     }
   }
   ```

   If Simon later flags the stamp reads as "hidden" at 375px, drop
   `opacity: 0.55` back to `0.65` (matches the 700px variant).

2. For any OTHER overflow offender Step 1 identified, apply the
   least-invasive fix in the same media block:
   - Fixed `min-width` on child that overflows: reduce or drop at
     phone widths.
   - Unwrapped flex row: add `flex-wrap: wrap`.
   - Long inline content: `overflow-wrap: anywhere` or truncate with
     `text-overflow: ellipsis; overflow: hidden`.

3. Test each of the four screens at 375px (visual verify is Cowork's
   job — here just check the CSS lands and typecheck/build pass).

**Verify**:
- `grep -c "@media (max-width: 480px)" app/globals.css` returns >= 1
  (the new block; there may be others from prior work)
- `grep -A5 "@media (max-width: 480px)" app/globals.css | grep -c "registered-stamp"`
  returns >= 1

**STOP if**:
- The `contain: layout paint` breaks an existing render (e.g. an
  absolutely-positioned tooltip that used to extend beyond the plate).
  Drop the `contain` rule and rely on `overflow: hidden` alone;
  narrow the fix to only the stamp resize.

#### Step 3: Dashboard Attention rows stack on phones

**Do:**

1. Read `app/dashboard/page.tsx` render section around line 275+
   (the `<ul className="dash-attention-list">` block). Identify
   how each row is currently laid out (probably flex or grid with
   status in a rightmost column).

2. In `globals.css`, add to the media block from Step 2:

   ```css
   @media (max-width: 480px) {
     .dash-attention-list li {
       display: flex;
       flex-direction: column;
       gap: 4px;
     }
     .dash-attention-list li .dash-attention-payload {
       align-self: flex-start;
       font-size: 11px;
     }
   }
   ```

   Adjust class names to actual markup — check
   `app/dashboard/page.tsx` render for the exact classes on the
   payload / status text element.

3. Test: at 375px, each Attention row shows address on top, status
   below, both readable.

**Verify**:
- Screenshot at 375px shows full address + full status per row, no
  truncation.

#### Step 4: Compliance header link contrast

**Do:**

1. Edit `app/compliance/page.tsx:184-192`. Change the inline
   `color: var(--navy)` on both Settings and Team links to a
   light-on-dark colour that reads on the navy header:

   ```tsx
   <Link href="/settings" style={{ color: "var(--gold)", fontWeight: 600 }}>
     Settings
   </Link>
   ```

   Same for the `/team` link at 189-192. Gold-on-navy reads (audit
   confirmed brand palette). Alternative: `color: var(--white)`.
   Gold matches Dream's brand accent so goes first.

2. Verify contrast — WCAG AA for text on dark backgrounds needs
   4.5:1. Gold `#C8A032` on navy `#132B84` is >5:1 per contrast
   checkers.

**Verify**:
- Screenshot at 375px + 1440px: Settings + Team links visible and
  legible on the compliance page header.
- No console warnings.

#### Step 5: Move Sign out into the menu drawer

**Do:**

1. Read `app/components/TopBarClient.tsx` around lines 159-165 for
   the current `<form action="/auth/signout">` block.

2. Move the Sign out form inside the drawer / menu component. The
   TopBar's drawer opens on hamburger click; add a "Sign out" item
   at the bottom of the drawer's list.

3. Remove the top-level `<button className="topbar-signout">`.

4. At >= 481px viewport, verify Sign out is still reachable via
   the drawer OR add a small quick-access variant if it's important
   for desktop admins.

**Verify**:
- Screenshot at 375px: top bar shows hamburger + brand only (no
  Sign out button).
- Opening the hamburger drawer shows Sign out at the bottom.
- Screenshot at 1440px: top bar layout doesn't regress; Sign out
  either lives in the drawer (if drawer is available on desktop) or
  gets a smaller "user menu" affordance.

**STOP if**:
- The drawer doesn't currently exist on desktop and removing Sign
  out from the top bar leaves desktop admins with no visible way
  to sign out. Adapt: keep a small user-menu dropdown on
  `min-width: 481px` viewports.

#### Step 6: Commit

**Do:**
1. Confirm changed set matches Scope (roughly `app/globals.css`,
   `app/compliance/page.tsx`, `app/components/TopBarClient.tsx`).
2. Commit: `Plan 018-b: phone-width fixes — overflow, attention rows, contrast, header`
3. Do NOT push. Do NOT update `plans/README.md`. Do NOT commit PNGs.

### Done criteria (PR 018-b)

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` compiles (auth-page prerender errors OK if
      Supabase env vars missing locally — see 018-a's report)
- [ ] `npm run test:dedup` exits 0
- [ ] `grep -c "button, input, select, textarea { font: inherit" app/globals.css`
      returns 1 (Simon's #1 — form-control font inheritance)
- [ ] `grep -c "calc(50% - 50vw)" app/globals.css` returns >= 2
      (Simon's #2 — full-bleed navy band + tideline)
- [ ] `grep -A5 "@media (max-width: 480px)" app/globals.css | grep -c "registered-stamp"`
      returns >= 1 (Simon's #3 — deeds stamp contained at 480px)
- [ ] `grep -n "\.dash-attention-list" app/globals.css` shows the
      new phone-width stacking rule
- [ ] `grep -c "topbar-signout" app/components/TopBarClient.tsx`
      returns 0 (moved into drawer) OR the class is scoped to
      desktop-only via a media query
- [ ] Compliance page Settings + Team links: `grep -n "var(--gold)\|var(--white)" app/compliance/page.tsx`
      shows the two link colour swaps
- [ ] `git status` clean; commit shipped
- [ ] No PNG files in the commit

### STOP conditions (PR 018-b)

- Step 1's DevTools inspection can't identify the overflow
  offender for a screen (all children fit but the scrollbar
  appears anyway — could be a `body { min-width: N }` or a
  `viewport` header issue).
- Removing Sign out from the top bar leaves any user with no way to
  sign out at any width.

---

## PR 018-c — Copy pass + button-trio migration + two 018-b carry-overs

Fixes audit items **#5, #6, #16**, migrates the old button classes to
the 018-a trio and deletes the old classes, and picks up two small
carry-overs from Simon's Cowork verification of 018-b (2026-09-29):

- **Deeds-card stamp still overhangs the card's right border by ~10px
  at 375px** (last letter touches the edge). 018-b shrunk to 128×54 at
  right:12px — needs further shrink + a hard `max-width` cap so it
  cannot exceed the plate's content-box width.
- **Mobile nav drawer pane background is plain white** (`--white`);
  should be `--paper-0` to match the rest of the paper surfaces.

Runs after 018-a and 018-b land.

### Current state (PR 018-c)

**Jargon leaks (audit #6):**
- "AMBER" — triage confidence code — shown as a status on the
  dashboard (`app/dashboard/page.tsx` — grep confirms). Bronwyn
  reads "Needs review" as intent.
- "Muni" — sidebar / popup label — read as "Municipal valuation".
- "SG C0390005…" — surveyor-general code in the map / erf lookup.
  Read to Bronwyn as an internal ID; add friendly label +
  keep the code as a subtitle.
- "ATTACH P24 LISTING" — shouty mono caps on Property Record.
  Read as "Link Property24 listing".

**Property record dead end (audit #5):**
`app/properties/[id]/page.tsx` around line 1122+ has an empty state:
`"No live transfer yet. Drop a folder in the Take-on section below (or via Triage) to bring in ownership history and start a deal."`.
The audit specifically named a DIFFERENT empty state — `"No listing on this property yet — create one first"` alongside `Prepare mandate…` — but no `Create listing` button. Grep for that empty-state text and fix it too.

**Compliance repetition (audit #16):** each party's row shows the
pill "FICA · DOCS IN — NOT VERIFIED" and then the redundant line
"Docs in — not verified" underneath. Keep the pill, drop the line.
Group parties by deal side (sellers / buyers).

### Scope (PR 018-c)

**In scope:**
- Every user-facing string in the listed pages that reflects a
  code, an enum, or an internal jargon term. Search:

  ```
  grep -rn 'AMBER\|GREEN\|RED\b\|\bMuni\b\|ATTACH P24\|ATTACH ' app/ --include="*.tsx"
  ```

  and evaluate each hit against Bronwyn's mental model. Change
  in-place with a friendly label.

- `app/properties/[id]/page.tsx` — every empty state must show the
  resolving action as a button/link:
  - "No live transfer yet…" → add "Start a deal" button pointing at
    the Take-on section or /triage (verify the target)
  - "No listing on this property yet — create one first" → add
    "Create listing" button pointing at wherever a listing is
    created (grep confirms the current flow)

- `app/compliance/page.tsx` — remove the redundant "Docs in — not
  verified" line under the pill. Group parties by deal side.

- **Migrate every remaining `.cta` / `.ghost-dark` / `.ghost-link` /
  `button.primary` usage to `.btn-primary` / `.btn-secondary` /
  `.btn-quiet`** (defined by 018-a), then DELETE the old class
  definitions from `app/globals.css`. Old-class removal only lands
  after every call site has migrated.

- **Carry-over 1 — stamp containment at ≤480px** (Simon, 2026-09-29):
  the 018-b `@media (max-width: 480px) .registered-stamp` rule
  (currently 128×54 at right:12px) still lets ~10px of the last letter
  overhang the plate border. Tighten further AND add a hard
  `max-width` cap so the stamp can never exceed the plate's
  content-box width. Location: same `@media (max-width: 480px)` block
  018-b added to `app/globals.css`.

- **Carry-over 2 — drawer nav background** (Simon, 2026-09-29):
  `app/globals.css:2424` — `.topbar-drawer-nav { background: var(--white); ... }`.
  Change `var(--white)` → `var(--paper-0)` so the drawer pane matches
  the warm-paper surface direction from 018-a.

**Out of scope:**
- Renaming enum values in the DB (that's a schema change — separate
  plan if worth doing).
- Rewriting bulk copy across the app (e.g. onboarding tooltips).
- The properties list redesign (audit #15).
- Adding new features (e.g. a new "Create listing" flow if one
  doesn't exist — flag it and stop instead).

### Steps (PR 018-c)

#### Step 0: Two 018-b carry-overs (fast wins, do first)

**Do:**

1. **Drawer background**: `app/globals.css:2424`. Change:

   ```css
   .topbar-drawer-nav {
     background: var(--white);
     ...
   }
   ```
   to:
   ```css
   .topbar-drawer-nav {
     background: var(--paper-0);
     ...
   }
   ```
   Preserve all other declarations on the rule.

2. **Stamp contain further** at `≤480px`. Find the existing block
   018-b added (grep `"@media (max-width: 480px)"` + `.registered-stamp`):

   ```css
   @media (max-width: 480px) {
     .registered-stamp {
       width: 128px;
       height: 54px;
       top: 10px;
       right: 12px;
       opacity: 0.55;
     }
     ...
   }
   ```

   Replace with (same block, tightened numbers + `max-width` cap):

   ```css
   @media (max-width: 480px) {
     .registered-stamp {
       /* 018-c (Simon, 2026-09-29): 018-b's 128×54 at right:12 still
          overhangs by ~10px at 375. Shrink further AND hard-cap the
          width against the plate content-box so it can never exceed
          the visible plate area. */
       width: 108px;
       height: 46px;
       top: 10px;
       right: 16px;
       opacity: 0.55;
       max-width: calc(100% - 32px);
     }
     ...
   }
   ```

   Keep the `.record-plate { contain: layout paint; }` sibling rule
   inside the same media block untouched.

**Verify**:
- `grep -A8 "@media (max-width: 480px)" app/globals.css | grep -c "max-width: calc(100% - 32px)"` returns >= 1
- `grep -n "background: var(--paper-0)" app/globals.css` includes a hit near the `.topbar-drawer-nav` rule (line ~2424)
- `grep -c "\.topbar-drawer-nav" app/globals.css` still returns >= 1 (rule not accidentally deleted)

**STOP if**:
- The stamp SVG has fixed pixel-value font sizes internally (see
  `app/properties/[id]/RegisteredStamp.tsx`) — if further container
  shrinking clips the SVG text visually (readable-vs-legible tradeoff),
  note it. The plan accepts a smaller, unreadable stamp over an
  overhanging readable one at 375px — the stamp is a signature
  moment but readability is optional at phone width.

#### Step 1: Grep every jargon site and draft replacements

**Do:**

1. Run:

   ```
   grep -rn 'AMBER\|GREEN.*tier\|RED.*tier' app/ --include="*.tsx" --include="*.ts"
   grep -rn '\bMuni\b\|Municipal valuation' app/ --include="*.tsx"
   grep -rn 'ATTACH P24\|attach p24\|Attach Property24' app/ --include="*.tsx"
   grep -rn 'SG C\|sg_number' app/ --include="*.tsx"
   ```

2. For each hit, decide the friendly label. Reference table from
   the audit + judgement:

   | Internal code       | Friendly label                        |
   |---------------------|---------------------------------------|
   | AMBER / GREEN / RED | Needs review / Ready / Manual review  |
   | Muni                | Municipal valuation                   |
   | ATTACH P24 LISTING  | Link Property24 listing               |
   | SG <code>           | Surveyor-General code (keep code as small subtitle) |

3. Change each hit in-place. Preserve any interpolation (`${row.tier}`
   → look up via a helper if the tier code IS the enum, not just a
   label). If the internal code IS in the DB, keep it in the DB and
   translate at render time.

**Verify**:
- Every jargon term identified has been either replaced or wrapped
  with a friendly label.
- Post-change grep for the same terms shows only DB-facing usage
  (query strings, RPC params).

**STOP if**:
- A jargon term is deeply embedded in RPC signatures or class
  names — leave the code alone, only change the render text.

#### Step 2: Add "Create listing" and "Start a deal" empty-state buttons

**Do:**

1. Grep the property page for empty-state text:

   ```
   grep -n "No listing\|No live transfer\|No mandate" app/properties/\[id\]/page.tsx
   ```

2. For each empty state, add a button/link that resolves it. The
   button style should be `.btn-primary` (defined by 018-a).

   Example shape:

   ```tsx
   <div className="record-deal-empty">
     <p className="eyebrow">Active deal</p>
     <p>
       No live transfer yet. Bring in ownership history and start a deal.
     </p>
     <Link href="/triage" className="btn-primary">
       Start a deal (via triage)
     </Link>
   </div>
   ```

3. Verify the target URL exists and does the right thing. If a
   "Create listing" flow doesn't exist in the app today, do NOT
   invent a button that goes nowhere — flag it in the commit message
   and STOP for that specific empty state (Simon decides whether
   to build the flow or reword the empty state).

**Verify**:
- Every empty state on the property record has a next-step action
- Buttons use `.btn-primary` / `.btn-secondary` (from 018-a)

**STOP if**:
- The target URL for "Create listing" doesn't exist in the app.

#### Step 3: Drop the redundant compliance line + group by deal side

**Do:**

1. Read `app/compliance/page.tsx` around the per-party row rendering.
2. Find the `<pill>` + `<p>redundant line</p>` pattern. Delete the
   `<p>`.
3. Group the parties: wrap the current flat list in two sections,
   one per side. Section headers: "Sellers" and "Buyers" (or their
   SA-vocabulary equivalents "Sellers" and "Purchasers" — grep the
   codebase for which term Bronwyn uses).

**Verify**:
- Screenshot at 375px + 1440px: each compliance row shows a pill,
  no redundant text below.
- Parties visually grouped under Sellers / Purchasers headings.

#### Step 4: Migrate every old button class site to the new trio, then delete the old classes

**Rationale:** 018-a defined the new trio but kept the old classes
alive so 018-a's diff stayed system-only. 018-c is where the tail
migration lands. Once every call site has moved, the old class
definitions in `globals.css` become dead code and get deleted.

**Do:**

1. Enumerate every old-class call site:

   ```
   grep -rn "className=[\"'].*\bcta\b" app/ --include="*.tsx"
   grep -rn "className=[\"'].*\bghost-dark\b" app/ --include="*.tsx"
   grep -rn "className=[\"'].*\bghost-link\b" app/ --include="*.tsx"
   grep -rn "className=[\"'].*\bghost\b" app/ --include="*.tsx"
   grep -rn "<button[^>]*className=[\"']primary[\"']" app/ --include="*.tsx"
   ```

   Also plain `button.primary` — where JSX renders `<button className="primary">`.

2. For each hit, migrate per this mapping:

   | Old class            | New class         | Notes |
   |----------------------|-------------------|-------|
   | `cta`                | `btn-primary`     | Navy background, white text |
   | `button.primary`     | `btn-primary`     | Same shape |
   | `ghost-dark`         | `btn-secondary`   | Bordered navy on paper |
   | `ghost-link`         | `btn-quiet`       | Text-shaped, subtle hover |
   | `ghost`              | `btn-quiet`       | Same on dark surfaces — check per-site |

   `ghost` on the top bar (dark navy background) needs special care —
   the trio's `.btn-quiet` uses `--ink-700` colour which won't read
   on navy. For top-bar sites, either keep `ghost` as a scoped-CSS
   override under `.topbar` (leave in globals.css) OR add a
   `.btn-quiet-on-dark` variant. Prefer the scoped override: keep
   the `.topbar .btn-quiet` rule alive, don't add a fourth variant.

3. Once every JSX call site is migrated, delete the following from
   `app/globals.css`:
   - `button.primary { ... }` and `button.primary:hover` and
     `button.primary:disabled` rules
   - `.cta { ... }` and `.cta:hover`
   - `.ghost-dark { ... }` and `.ghost-dark:hover` and
     `.ghost-dark:disabled`
   - `.ghost-link { ... }` and `.ghost-link:hover`

   **Do NOT delete `.ghost { ... }`** — it's the top-bar scoped
   variant and 018-c's Step 5 of 018-b (Sign-out drawer) may still
   use it. If a grep confirms zero uses of `.ghost` anywhere, delete
   it too.

4. Also delete `.record-actions button, .record-actions .ghost-dark`
   at `app/globals.css:688` and its `:hover` sibling at line 699 —
   the whole `.record-actions` scoped block that consumes the
   deleted classes needs its selectors updated to reference the new
   ones (e.g. `.record-actions .btn-secondary`).

**Verify**:
- `grep -rn "className=[\"'].*\b(cta|ghost-dark|ghost-link)\b" app/ --include="*.tsx"`
  returns 0 matches
- `grep -rn "<button[^>]*className=[\"']primary[\"']" app/ --include="*.tsx"`
  returns 0 matches
- `grep -c "^button\.primary\|^\.cta\|^\.ghost-dark\|^\.ghost-link" app/globals.css`
  returns 0 (rules deleted)
- `grep -c "\.btn-primary\|\.btn-secondary\|\.btn-quiet" app/globals.css`
  returns >= 6 (still the trio from 018-a)
- `npm run typecheck` exits 0
- `npm run build` exits 0

**STOP if**:
- A site uses one of the old classes via a computed className
  (`` `cta ${extra}` ``) that a naive grep would miss. Search
  `grep -rn "\bcta\b\|\bghost-dark\b\|\bghost-link\b" app/` to
  catch these; migrate each.
- Deleting an old class breaks a visible rule elsewhere (e.g. a
  `.record-actions .cta` scoped rule at line 688 depended on `.cta`
  existing). Update the scoped rule, don't restore the deletion.

#### Step 5: Commit

**Do:**
1. Confirm the changed set — jargon replacements + empty-state
   buttons + compliance grouping + button-class migrations +
   old-class deletions.
2. Commit: `Plan 018-c: copy pass — user-facing labels + empty-state actions + button-trio migration`
3. Do NOT push. Do NOT commit PNGs.

### Done criteria (PR 018-c)

- [ ] `npm run typecheck` exits 0
- [ ] `npm run build` compiles (auth-page prerender errors OK)
- [ ] `npm run test:dedup` exits 0
- [ ] Grep for jargon terms in `app/**/*.tsx` returns only
      DB-facing / class-name uses; user-facing render strings all
      use friendly labels
- [ ] Every empty state on the property record has a button that
      resolves it (or an explicit note in the commit that the flow
      doesn't exist yet and Simon decides)
- [ ] Compliance page: no redundant text line under any pill; parties
      grouped by side
- [ ] All old button classes deleted from `globals.css`; all call
      sites migrated to `.btn-primary` / `.btn-secondary` / `.btn-quiet`
- [ ] Carry-over 1: `grep -A10 "@media (max-width: 480px)" app/globals.css | grep -c "max-width: calc(100% - 32px)"` returns >= 1
- [ ] Carry-over 2: `.topbar-drawer-nav` rule uses `var(--paper-0)`
      (not `var(--white)`)
- [ ] `git status` clean; commit shipped
- [ ] No PNG files in the commit

### STOP conditions (PR 018-c)

- A jargon term is DB-schema-level (enum value). Change render text
  only; do not touch schema.
- An empty state's resolving action doesn't exist in the app.
- A button-class migration would require restructuring markup
  beyond a className swap (e.g. a wrapper `<a>` around a
  `<button.primary>` that gains semantic meaning). Report and
  stop; not this PR's scope.

---

## Test plan

No new automated tests here. Manual verification is the load-bearing
check — see the per-PR "Done criteria" for what to visually confirm.

Automated visual-regression tests (Playwright screenshot diffs)
would be valuable but are plan-012's territory to establish the
harness first.

## Follow-ups explicitly deferred out of plan 018

Audit items NOT addressed in this plan (become future plans 019+):

- **#8 + #9** — retire inline styles + split `globals.css` into
  modules. Per-page cleanup; piggybacks on future page work.
- **#13** — pipeline mobile UX (tabs / stage picker instead of
  side-scroll). Own plan.
- **#14** — property record hierarchy reorder (status + deadline
  → parties → agreement → deed card → documents → compliance).
  Own plan.
- **#15** — properties list redesign (status pill, asking price,
  hide empty fields, add search/filter). Own plan.
- **#16b** — pipeline pills / stalled colour semantics. Bundled
  with #13.
- **#18** — Erf Lookup type-ahead. Own small plan (also flagged
  as walkthrough P2 #13).

## Maintenance notes

- **`next/font/google` requires network at build time.** Vercel
  has network; local dev also has network. If Simon ever moves to
  a fully-offline build (unlikely), switch to `next/font/local`
  with self-hosted font files.
- **The `--font-body` / `--font-display` / `--font-mono` variables
  are set on `<html>` by `next/font`**, not by CSS. If a component
  overrides `font-family` in JSX inline, that overrides the token.
  Per-page cleanup should migrate inline `fontFamily` to
  `var(--font-*)` as each page gets touched.
- **The `--mist` token stays defined and still used** by many
  card / pill / hover rules. This plan only stops the body from
  reaching for it. Full retirement of `--mist` would need
  per-usage review; not this plan's scope.
- **The `:focus-visible` outline uses `--gold`.** On a navy
  header surface this reads. On paper it also reads (contrast
  checked). If a future page has a gold background, the ring
  disappears — override with `:focus-visible { outline-color: var(--navy); }`
  scoped to that page.
- **The button trio (`.btn-primary` / `.btn-secondary` / `.btn-quiet`)
  does not delete the existing `.cta` / `.ghost-dark` / `.ghost-link`.**
  Migration is per-page. When migrating a page's buttons, prefer
  the trio; the old classes stay so historical markup keeps
  working during the transition.
