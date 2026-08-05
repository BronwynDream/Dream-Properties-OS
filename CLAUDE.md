# Dream OS — read this first

You are working on the Dream Knysna operating system: a bespoke CRM, property
database and transaction record store for **Dream Knysna (Pty) Ltd**, replacing
PropCtrl and the scattered laptop/Outlook/WhatsApp tooling. Simon Houghton builds
it; Bronwyn Eyre and her agents use it.

## Start of every session — do this before anything else

1. **Read `project.state.md`.** It is the running log, reverse-chronological —
   the newest arc sits directly under the header. Read at minimum the top two
   sections and the `## Next (immediate)` checklist near the bottom. This is
   where you find out what was shipped last time, what broke, what was parked,
   and what Simon was unhappy about.
2. **Run `git log --oneline -15`** and `git status`. The log tells you what
   actually landed; the state file tells you why.
3. Only then start work.

Do not skip step 1 because the request looks narrow. Most of the bugs in this
codebase are second-order — a fix that looks obvious in isolation has usually
already been tried and reverted, and the state file says so.

## End of every session — do this before you sign off

Append a new section to the top of `project.state.md` (above the previous
newest one, below the header) covering:

- **Shipped** — what changed, in which files, and *why*, not just what.
- **Verification** — what you actually ran, and what you did NOT verify.
- **Loose ends** — anything parked, half-done, or applied to the database but
  not committed to the repo. Be specific enough that a session with no memory
  can pick it up cold.
- **Feedback moments** — if Simon pushed back, record it verbatim and record the
  correction. These are the most valuable lines in the file.

Also update `_Last updated:` in the header. Commit the state file with the code.

## The stack, in one breath

Next.js 14 App Router + TypeScript on Vercel (auto-deploys `main`), Supabase
Postgres in EU/Ireland for POPIA, Mapbox GL for the map, `@supabase/ssr` for auth.
Repo is `BronwynDream/Dream-Properties-OS`; Simon pushes as collaborator
`simonhoughton-source`. Database is the Supabase project "Bon Bon's Database".
Schema lives in `supabase/migrations/`, applied in numeric order. `property` is
the canonical root — everything hangs off it. See `README.md` for the spine.

## House rules

- **Map-render changes must be loaded in a browser before they merge.** Type-check
  and diff-review are not enough. A Mapbox clustering change that passed both
  shipped broken on 2026-07-31 and had to be reverted; layer stacking and install
  races fail silently. If you cannot load it yourself, say so plainly and ask
  Simon to look before he merges.
- **Simon is not frontend-native.** Don't send him into browser dev tools without
  saying where the menu is. Prefer things you can verify yourself.
- **Migrations applied to the database must also land in the repo.** Schema drift
  between Bon Bon and `main` has bitten before. If you paste SQL into Studio,
  commit the migration file in the same session.
- **Prices come from schema.org JSON-LD `priceCurrency:ZAR` only.** Never regex
  prices out of markdown — Property24 formats erf sizes like currency and an LLM
  asked for a number will happily return a listing ID.
- Ask before large refactors. This codebase is grown, not designed, and Simon has
  said more than once that sessions which build new code on top of bugs make
  things worse. When something feels structurally wrong, diagnose and report
  rather than rewrite.

## Running from Cowork (remote session, folder mounted over the device bridge)

If you are reaching this repo through `mcp__remote-devices__*` tools rather than
running locally, read `claude/dream-os-cowork-handbook.md` in the attached Claude
project. Short version:

- `next build` will not complete over the mount — tar the source, stage it into
  the cloud container, `npm ci` and build there. `tsc --noEmit` works fine locally.
- Git writes leave stale `.git/*.lock` files that block the next write; clear them
  with an in-mount `mv` before each `git add` / `git commit`.
- `git commit` needs `-c user.name` / `-c user.email` passed explicitly.
- There is no network on the device side, so **you cannot push** — commit and hand
  the push back to Simon.
- You cannot delete files on Simon's machine; move them to `_to_delete/` and tell
  him.

## Where else to look

- `README.md` — schema spine, how to apply migrations, how to run and deploy.
- `docs/` — deployment, drop-and-triage spec, WhatsApp schema brief.
- `plans/` — numbered feature plans (005 is the cadastral polygon map).
