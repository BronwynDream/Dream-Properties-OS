-- ============================================================================
-- Dream Knysna OS — 0067 consolidate mandate.type: sole → exclusive
-- ----------------------------------------------------------------------------
-- Consolidate mandate.type: 'sole' and 'exclusive' are the same
-- mandate at Dream (Simon, 2026-08-06). The enum carried both since
-- 0001_init.sql, and a mandate stored under either was invisible to
-- a filter on the other, so /mandates counts and the expiry
-- watchlist both undercounted.
--
-- Data-only migration: rewrite existing 'sole' rows to 'exclusive'.
-- The mandate_type enum keeps both values (Postgres does not support
-- dropping enum values without a rebuild, and 'sole' being tolerated
-- on read is defensively fine). Code stops writing 'sole' in the same
-- change set — see app/mandates/page.tsx, app/mandates/TypeFilterChips.tsx
-- and lib/extract.ts.
--
-- One-time effect. Safe to re-run — the update is idempotent (no
-- 'sole' rows after the first run).
-- ============================================================================

update mandate
   set type = 'exclusive'
 where type = 'sole';

-- Downgrade note (kept in comments, not executed): to reverse this
-- data change, the caller would need a record of which rows were
-- originally 'sole' — which we do not retain here. If revert is
-- ever required, restore from a Bon Bon point-in-time snapshot
-- prior to this migration.

comment on type mandate_type is
  'Kept literal values sole/joint/open/exclusive. sole is DEPRECATED as of migration 0067 and is treated as an alias for exclusive; no code writes it. Do not add new usage.';
