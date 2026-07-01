-- ============================================================================
-- Dream Knysna OS — 0004 docs: documents, media, FICA, communications,
--                    audit + consent (POPIA), and deferred FK wiring
-- ============================================================================

-- Documents — every file, with version + execution status (gap #2) and retention.
create table document (
  id               uuid primary key default gen_random_uuid(),
  doc_type_id      uuid references document_type(id),
  title            text not null,
  storage_bucket   text not null default 'documents',
  storage_path     text not null,                    -- path within the Supabase Storage bucket
  mime_type        text,
  byte_size        bigint,
  status           document_status not null default 'final',
  version          int not null default 1,
  supersedes_id    uuid references document(id),
  is_pii           boolean not null default false,
  ocr_text         text,                             -- populated for scanned/image PDFs
  retention_until  date,                             -- FIC Act: 5y from end of relationship
  uploaded_by      uuid references app_user(id),
  uploaded_at      timestamptz not null default now()
);

-- Polymorphic link: one document can attach to property / transfer / party / listing /
-- agreement / estate / compliance etc. (entity_type + entity_id).
create table document_link (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references document(id) on delete cascade,
  entity_type   text not null,                       -- 'property'|'transfer'|'party'|'listing'|'agreement'|'estate'|'mandate'|'fica'|...
  entity_id     uuid not null,
  role          text,                                -- optional: 'signed'|'draft'|'evidence'|'id'|'proof_of_address'...
  created_at    timestamptz not null default now(),
  unique (document_id, entity_type, entity_id)
);

-- Media / drawings (gap #3): photos AND elevations / sections / floor & concept plans.
create table media (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid references property(id) on delete cascade,
  listing_id    uuid references listing(id) on delete set null,
  estate_id     uuid references estate(id) on delete set null,
  kind          media_kind not null default 'photo',
  storage_bucket text not null default 'media',
  storage_path  text not null,
  caption       text,
  ai_tags       jsonb,                               -- AI photo tagging on upload
  sort_order    int not null default 100,
  created_at    timestamptz not null default now()
);

-- FICA record: one per party per transfer per role.
create table fica (
  id                uuid primary key default gen_random_uuid(),
  transfer_id       uuid not null references transfer(id) on delete cascade,
  party_id          uuid not null references party(id) on delete restrict,
  role              fica_role not null,
  status            fica_status not null default 'outstanding',
  risk              fica_risk not null default 'low',
  source_of_funds   text,
  verified_by       uuid references app_user(id),
  verified_at       timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (transfer_id, party_id, role)
);

-- Communications log (gap #4): the email threads + the Grove WhatsApp waiver.
create table communication (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid references transfer(id) on delete cascade,
  property_id   uuid references property(id) on delete set null,
  party_id      uuid references party(id) on delete set null,
  channel       comm_channel not null,
  direction     comm_direction not null,
  subject       text,
  body_text     text,
  occurred_at   timestamptz not null default now(),
  source_ref    text,                                -- email Message-ID / WhatsApp ref
  document_id   uuid references document(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- POPIA consent ledger (per party).
create table consent (
  id            uuid primary key default gen_random_uuid(),
  party_id      uuid not null references party(id) on delete cascade,
  basis         text not null,                       -- 'mandate'|'legitimate_interest'|'explicit'...
  purpose       text,
  granted_at    timestamptz,
  withdrawn_at  timestamptz,
  notes         text,
  created_at    timestamptz not null default now()
);

-- FICA/POPIA audit log: every sensitive view/download/change, with justification.
create table audit_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references app_user(id),
  action        text not null,                       -- 'view'|'download'|'upload'|'update'|'delete'
  entity_type   text not null,
  entity_id     uuid,
  justification text,
  ip_address    inet,
  created_at    timestamptz not null default now()
);

create trigger trg_document_updated  before update on document for each row execute function set_updated_at();
create trigger trg_fica_updated      before update on fica     for each row execute function set_updated_at();

-- Deferred FKs from 0003 now that document exists ---------------------------
alter table mandate             add constraint fk_mandate_doc    foreign key (document_id)          references document(id) on delete set null;
alter table cma                 add constraint fk_cma_doc        foreign key (document_id)          references document(id) on delete set null;
alter table offer               add constraint fk_offer_doc      foreign key (document_id)          references document(id) on delete set null;
alter table agreement           add constraint fk_agreement_doc  foreign key (document_id)          references document(id) on delete set null;
alter table suspensive_condition add constraint fk_cond_doc      foreign key (evidence_document_id) references document(id) on delete set null;
alter table compliance_cert     add constraint fk_compliance_doc foreign key (document_id)          references document(id) on delete set null;
alter table estate              add column design_manual_doc_id uuid references document(id) on delete set null;

create index idx_doc_type          on document(doc_type_id);
create index idx_doc_link_entity   on document_link(entity_type, entity_id);
create index idx_media_property    on media(property_id);
create index idx_media_listing     on media(listing_id);
create index idx_fica_transfer     on fica(transfer_id);
create index idx_fica_party        on fica(party_id);
create index idx_comm_transfer     on communication(transfer_id);
create index idx_audit_entity      on audit_log(entity_type, entity_id);
