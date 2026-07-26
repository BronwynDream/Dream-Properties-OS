-- ============================================================================
-- Dream Knysna OS — 0043 ingest_batch.auto_commit_allowed flag
-- ----------------------------------------------------------------------------
-- Defence-in-depth against a compromised RESEND_WEBHOOK_SECRET or a bug in
-- the auto-commit heuristic. Only batches explicitly flagged by the intake
-- webhook (which sets this on insert) may be auto-committed by the service-
-- role path. Legacy batches, and any batch created by other flows, require
-- manual review via /triage before commit_batch is allowed to run.
--
-- Nullable so pre-existing batches don't need a data migration; treat NULL
-- and false identically at the app layer.
-- ============================================================================

alter table ingest_batch add column if not exists auto_commit_allowed boolean;

comment on column ingest_batch.auto_commit_allowed is
  'Nullable opt-in flag. Only set to true by the /api/intake/email webhook when the batch was ingested by the trusted allow-listed sender flow. Read by the webhook auto-commit gate; the manual /triage commit path ignores this flag and requires an admin session instead.';
