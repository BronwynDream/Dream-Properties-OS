-- ============================================================================
-- Dream Knysna OS — 0007 staging: the drop-and-triage pipeline tables
-- ----------------------------------------------------------------------------
-- A dropped folder lands here FIRST and never touches the clean relational
-- tables until Bronwyn confirms. This is the "always reversible" guarantee:
-- discard a batch and the live data is untouched.
--
--   ingest_batch  — one dropped folder (≈ one deal)
--   ingest_file   — each file in it, classified to a document_type
--   extraction    — each proposed field value (target table.column) for review
-- ============================================================================

create type ingest_status      as enum ('uploaded','parsing','extracted','in_review','committed','discarded');
create type ingest_file_status as enum ('uploaded','parsed','classified','mapped','committed','skipped');
create type extraction_status  as enum ('proposed','accepted','edited','rejected');

-- One dropped folder / deal being triaged.
create table ingest_batch (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,                     -- usually the folder name, e.g. "7 The Grove"
  source        text not null default 'drag_drop', -- drag_drop | email | bulk_import
  status        ingest_status not null default 'uploaded',
  property_id   uuid references property(id),      -- matched/created on commit
  transfer_id   uuid references transfer(id),      -- target created on commit
  created_by    uuid references app_user(id),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Each raw file in the batch. Binary sits in the private 'staging' bucket until
-- promoted to a real document (then committed_document_id is filled).
create table ingest_file (
  id                      uuid primary key default gen_random_uuid(),
  batch_id                uuid not null references ingest_batch(id) on delete cascade,
  original_filename       text not null,
  storage_bucket          text not null default 'staging',
  storage_path            text not null,
  mime_type               text,
  byte_size               bigint,
  detected_doc_type_id    uuid references document_type(id),   -- AI classification
  classification_confidence numeric(4,3),                      -- 0.000–1.000
  is_pii                  boolean not null default false,       -- from doc_type default
  ocr_text                text,                                 -- parsed / OCR'd text
  status                  ingest_file_status not null default 'uploaded',
  committed_document_id   uuid references document(id),         -- set when promoted
  notes                   text,
  created_at              timestamptz not null default now()
);

-- Proposed structured values awaiting human confirm. target_table/target_field
-- name where the value will land (e.g. party.id_number, agreement.price).
create table extraction (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references ingest_batch(id) on delete cascade,
  source_file_id uuid references ingest_file(id) on delete set null,
  target_table   text not null,                    -- 'party' | 'property' | 'agreement' | 'milestone' | ...
  target_field   text not null,                    -- column name
  entity_hint    text,                             -- disambiguator when many of a kind (e.g. 'seller_1','purchaser_2')
  proposed_value text,
  confidence     numeric(4,3),
  status         extraction_status not null default 'proposed',
  final_value    text,                             -- what Bronwyn confirmed (may differ)
  reviewed_by    uuid references app_user(id),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create trigger trg_ingest_batch_updated before update on ingest_batch for each row execute function set_updated_at();

create index idx_ingest_file_batch on ingest_file(batch_id);
create index idx_extraction_batch  on extraction(batch_id);
create index idx_extraction_status on extraction(status);

-- ---------------------------------------------------------------------------
-- RLS: staff work their own batches; admins see all. (Staging is a working
-- area, so staff get full CRUD on their rows.)
-- ---------------------------------------------------------------------------
alter table ingest_batch enable row level security;
alter table ingest_file  enable row level security;
alter table extraction   enable row level security;

create policy ingest_batch_rw on ingest_batch for all
  using (is_admin() or created_by = auth.uid())
  with check (is_admin() or created_by = auth.uid());

create policy ingest_file_rw on ingest_file for all
  using (is_admin() or exists (
    select 1 from ingest_batch b where b.id = ingest_file.batch_id
      and (b.created_by = auth.uid())))
  with check (is_admin() or exists (
    select 1 from ingest_batch b where b.id = ingest_file.batch_id
      and (b.created_by = auth.uid())));

create policy extraction_rw on extraction for all
  using (is_admin() or exists (
    select 1 from ingest_batch b where b.id = extraction.batch_id
      and (b.created_by = auth.uid())))
  with check (is_admin() or exists (
    select 1 from ingest_batch b where b.id = extraction.batch_id
      and (b.created_by = auth.uid())));

-- Private staging bucket for raw dropped files (pre-commit).
insert into storage.buckets (id, name, public)
values ('staging','staging', false)
on conflict (id) do nothing;

create policy "staff read staging"   on storage.objects for select using (bucket_id = 'staging' and is_staff());
create policy "staff write staging"  on storage.objects for insert with check (bucket_id = 'staging' and is_staff());
create policy "staff delete staging" on storage.objects for delete using (bucket_id = 'staging' and is_staff());
