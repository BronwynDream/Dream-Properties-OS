-- ============================================================================
-- Dream Knysna OS — 0008 triage queue: tiering, priority, match/merge, queue view
-- ----------------------------------------------------------------------------
-- Scales the triage loop from "one folder at a time" to "bulk-ingest 500, confirm
-- from a prioritized queue". Ingestion is automated; only confirmation costs human
-- time, so batches are scored (tier) and ordered (priority), and most green batches
-- clear in one click.
-- ============================================================================

create type triage_tier    as enum ('green','amber','red');
-- green  = high confidence, key fields found, clean match, no juristic/PII gaps -> one-click
-- amber  = a few low-confidence or blank fields -> quick glance
-- red    = juristic party / duplicate-merge / missing IDs / conflict -> full review

create type batch_priority as enum ('active','recent','historical');
-- active     = in-flight deals; review carefully, few in number
-- recent     = recently closed
-- historical = back-catalogue; bulk, lighter bar (searchable record, not perfect capture)

alter table ingest_batch
  add column tier       triage_tier,
  add column priority   batch_priority not null default 'historical',
  add column confidence numeric(4,3),                 -- rollup across the batch's extractions
  add column parent_drop_id uuid;                      -- groups subfolders from one bulk drop

-- Match-or-create review (avoid duplicate property/party at 500-folder scale).
create table match_candidate (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references ingest_batch(id) on delete cascade,
  target_kind    text not null check (target_kind in ('property','party')),
  extracted_ref  text,                                 -- what we read (deed no / name / id)
  candidate_id   uuid,                                 -- the existing property.id / party.id we think it is
  candidate_label text,
  score          numeric(4,3),
  decision       text not null default 'undecided'
                 check (decision in ('undecided','link','create','merge')),
  decided_by     uuid references app_user(id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index idx_match_candidate_batch on match_candidate(batch_id);

alter table match_candidate enable row level security;
create policy match_candidate_rw on match_candidate for all
  using (is_admin() or exists (
    select 1 from ingest_batch b where b.id = match_candidate.batch_id and b.created_by = auth.uid()))
  with check (is_admin() or exists (
    select 1 from ingest_batch b where b.id = match_candidate.batch_id and b.created_by = auth.uid()));

-- The queue the confirm screen reads. security_invoker = on so the caller's RLS
-- on ingest_batch still applies (staff see their batches, admins see all).
create view v_triage_queue with (security_invoker = on) as
select
  b.id, b.label, b.status, b.tier, b.priority, b.confidence,
  b.property_id, b.transfer_id, b.parent_drop_id, b.created_by, b.created_at,
  (select count(*) from ingest_file f where f.batch_id = b.id)                                as file_count,
  (select count(*) from extraction e where e.batch_id = b.id)                                 as proposed_count,
  (select count(*) from extraction e where e.batch_id = b.id and e.status in ('accepted','edited')) as confirmed_count,
  (select count(*) from extraction e where e.batch_id = b.id and e.confidence < 0.75)         as low_confidence_count,
  (select count(*) from match_candidate mc where mc.batch_id = b.id and mc.decision = 'undecided') as open_matches
from ingest_batch b;

comment on view v_triage_queue is
  'Confirm-queue feed. App orders by priority (active→recent→historical) then tier (red→amber→green) then confidence.';
