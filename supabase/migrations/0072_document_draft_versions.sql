-- ============================================================================
-- Dream Knysna OS — 0072 document_draft versions
-- ----------------------------------------------------------------------------
-- Plan 019, Arc A4. A draft can now be reopened and edited: field values
-- changed, a clause's wording switched to another library variant, a clause
-- overridden for this one document, an optional clause omitted. Every save
-- snapshots the previous state here first, so "what did this document say
-- when we printed it on the 3rd" is answerable, and so a bad edit can be
-- walked back.
--
-- The snapshot is of the four structured columns, not rendered text: the
-- rendered document is reproducible from (template, library at the time,
-- snapshot). A5 adds the frozen PDF at finalisation for the signed record.
-- ============================================================================

alter table document_draft add column if not exists version int not null default 1;

create table document_draft_version (
  id                uuid primary key default gen_random_uuid(),
  draft_id          uuid not null references document_draft(id) on delete cascade,
  version           int not null,
  field_values      jsonb not null,
  clause_selections jsonb not null,
  clause_overrides  jsonb not null,
  omitted_clauses   jsonb not null,
  note              text,
  saved_by          uuid references app_user(id) on delete set null,
  saved_at          timestamptz not null default now(),
  unique (draft_id, version)
);

create index idx_document_draft_version_draft on document_draft_version(draft_id, version desc);

comment on table document_draft_version is
  'Snapshot of a document_draft''s structured state before each save. Version n here is what the draft looked like while draft.version = n.';

alter table document_draft_version enable row level security;

-- Same visibility as the draft itself.
create policy document_draft_version_read on document_draft_version for select
  using (exists (select 1 from document_draft d where d.id = document_draft_version.draft_id));
create policy document_draft_version_write on document_draft_version for insert
  with check (exists (select 1 from document_draft d where d.id = document_draft_version.draft_id
                        and (is_admin() or d.created_by = auth.uid())));
