-- Dream Knysna OS — 0022 intake email
-- Property intake by email: agents forward a mandate to intake@dreamproperties.app,
-- Postmark POSTs an inbound webhook to /api/intake/email, which creates a
-- property + ingest_batch tied to it with attachments + body as ingest_files.
--
-- Two additive columns and one view refresh:
--   sender_email          — the From address, for audit + future reply chains
--   postmark_message_id   — unique per Postmark message, for retry idempotency
--   v_triage_queue        — surface source + sender_email so the queue can
--                           badge inbound-email batches
--
-- ingest_batch.source already exists (0007_staging.sql, default 'drag_drop').
-- The webhook writes 'email' into it; the view now exposes it.

alter table ingest_batch
  add column if not exists sender_email        text,
  add column if not exists postmark_message_id text;

-- Idempotent replay: if Postmark retries a webhook, the second call finds the
-- existing batch and returns its triage URL instead of creating a duplicate.
create unique index if not exists idx_ingest_batch_postmark_msgid
  on ingest_batch(postmark_message_id)
  where postmark_message_id is not null;

comment on column ingest_batch.sender_email is
  'Email address the batch was received from (source=email). Cross-referenced against app_user at intake.';
comment on column ingest_batch.postmark_message_id is
  'Postmark MessageID — unique per inbound message, used to make webhook retries idempotent.';

-- Refresh the queue view so the /triage list can show source + sender_email.
-- New columns appended at the end so create-or-replace stays additive.
create or replace view v_triage_queue with (security_invoker = on) as
select
  b.id, b.label, b.status, b.tier, b.priority, b.confidence,
  b.property_id, b.transfer_id, b.parent_drop_id, b.created_by, b.created_at,
  (select count(*) from ingest_file f where f.batch_id = b.id)                                as file_count,
  (select count(*) from extraction e where e.batch_id = b.id)                                 as proposed_count,
  (select count(*) from extraction e where e.batch_id = b.id and e.status in ('accepted','edited')) as confirmed_count,
  (select count(*) from extraction e where e.batch_id = b.id and e.confidence < 0.75)         as low_confidence_count,
  (select count(*) from match_candidate mc where mc.batch_id = b.id and mc.decision = 'undecided') as open_matches,
  b.source,
  b.sender_email
from ingest_batch b;
