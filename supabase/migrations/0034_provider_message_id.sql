-- ============================================================================
-- Dream Knysna OS — 0034 provider_message_id rename
-- ----------------------------------------------------------------------------
-- The intake email flow was originally designed around Postmark, whose
-- "MessageID" field was stored in ingest_batch.postmark_message_id and used
-- for webhook idempotency (same MessageID → return existing batch).
--
-- We're switching to Resend for inbound email. Resend's identifier is called
-- "email_id" and is used the same way. Rather than adding a second column
-- (bloating the schema for one field per provider), rename to a
-- provider-neutral name.
--
-- Storage convention: prefix the id with the provider name so a single column
-- can safely hold IDs from different providers without collision. e.g.
--   resend:56761188-7520-42d8-8898-ff6fc54ce618
--   postmark:AAMkADU5MmM4NmY0LTdlY...
-- ============================================================================

alter table ingest_batch
  rename column postmark_message_id to provider_message_id;

alter index if exists idx_ingest_batch_postmark_msgid
  rename to idx_ingest_batch_provider_msgid;

comment on column ingest_batch.provider_message_id is
  'Email-provider MessageID (Resend email_id, or Postmark MessageID) — unique per inbound message, used to make webhook retries idempotent. Prefix with provider name (e.g. "resend:<id>") when writing.';
