-- Dream Knysna OS — 0023 intake router
-- Extends the property intake into a two-target router:
--   Subject: "Property: 6 Bowden Park"  → property batch
--   Subject: "Client:   John Smith"     → party    batch
--   (no prefix)                         → property batch (backwards compat)
--
-- For both paths the intake webhook fuzzy-matches the subject against existing
-- rows (pg_trgm) and, on a strong match, ties the batch to the existing row
-- instead of creating a duplicate. Combined with the commitBatch fallback that
-- honours ingest_batch.property_id, this means Bronwyn can forward mandate,
-- FICA, and photos in three separate emails and they all land on the same
-- property record.
--
-- Additive changes only:
--   ingest_batch.party_id     — nullable FK, mirrors ingest_batch.property_id
--   v_triage_queue            — surface party_id alongside property_id
--   match_property_by_address — trigram search RPC
--   match_party_by_name       — trigram search RPC

alter table ingest_batch
  add column if not exists party_id uuid references party(id);

create index if not exists idx_ingest_batch_party
  on ingest_batch(party_id)
  where party_id is not null;

comment on column ingest_batch.party_id is
  'Target party for client-intent batches. Mutually exclusive in spirit with property_id, though not constrained — the intake webhook sets exactly one.';

-- Fuzzy-match the intake subject against existing property addresses. Trigram
-- similarity threshold defaults to 0.45 — Bowden Park variants ("6 Bowden Park",
-- "6 Bowden Park, Leisure Isle") sit comfortably above 0.55.
create or replace function match_property_by_address(
  q text,
  min_sim numeric default 0.45
)
returns table(id uuid, primary_address text, sim numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id, p.primary_address,
         round(similarity(p.primary_address, q)::numeric, 3) as sim
  from property p
  where q is not null
    and length(q) >= 3
    and similarity(p.primary_address, q) >= min_sim
  order by similarity(p.primary_address, q) desc
  limit 5
$$;

-- Fuzzy-match the intake subject against existing party display names.
-- Higher default threshold (0.5) because names have less structural information
-- than addresses — "John Smith" vs "Jane Smith" would otherwise collide.
create or replace function match_party_by_name(
  q text,
  min_sim numeric default 0.5
)
returns table(id uuid, display_name text, sim numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.id, p.display_name,
         round(similarity(p.display_name, q)::numeric, 3) as sim
  from party p
  where q is not null
    and length(q) >= 3
    and similarity(p.display_name, q) >= min_sim
  order by similarity(p.display_name, q) desc
  limit 5
$$;

-- Refresh the queue view to surface party_id — the /triage list will use it
-- alongside property_id to badge "client via email" vs "property via email".
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
  b.sender_email,
  b.party_id
from ingest_batch b;
