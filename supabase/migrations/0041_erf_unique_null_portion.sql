-- ============================================================================
-- Dream Knysna OS — 0041 partial unique index on erf (property_id, erf_number)
-- ----------------------------------------------------------------------------
-- The base uniqueness on erf is (property_id, erf_number, portion), which
-- Postgres treats correctly for non-null portions but SILENTLY allows
-- duplicates when portion is null (NULL ≠ NULL in unique-constraint eval).
--
-- Result seen 2026-07-25: 12 Eagles Way ended up with "ERF 2934, 2934"
-- after two attaches. The on-conflict-do-nothing in attachErfToProperty
-- didn't fire because the constraint didn't consider it a conflict.
--
-- Partial index catches the common case (no portion) explicitly.
-- ============================================================================

create unique index if not exists idx_erf_unique_null_portion
  on erf (property_id, erf_number)
  where portion is null;
