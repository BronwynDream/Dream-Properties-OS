-- ============================================================================
-- Dream Knysna OS — 0046 party search indexes
-- ----------------------------------------------------------------------------
-- The Contact CRM (/contacts) needs fast fuzzy search across party name,
-- email, phone, id_number. pg_trgm is already installed (used by muni_property
-- + property matcher). Add gin_trgm indexes to the party fields we search.
--
-- Idempotent: `create index if not exists`. Safe to re-apply.
-- ============================================================================

create extension if not exists pg_trgm;

create index if not exists idx_party_display_name_trgm
  on party using gin (display_name gin_trgm_ops);

create index if not exists idx_party_entity_name_trgm
  on party using gin (entity_name gin_trgm_ops)
  where entity_name is not null;

create index if not exists idx_party_id_number
  on party (id_number)
  where id_number is not null;

create index if not exists idx_party_email
  on party (email)
  where email is not null;

create index if not exists idx_party_phone
  on party (phone)
  where phone is not null;
