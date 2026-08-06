-- Document engine: template library, clause library, editable drafts.
--
-- Bronwyn sent thirteen master templates on 2026-08-04. Phase 1 rendered
-- exactly one of them (Sole/Joint mandate) as HTML the browser printed, and
-- stored nothing. This migration is the data layer for Plan 007.
--
-- The design splits a document into three layers, each in the place that
-- suits it (see plans/007-document-engine.md for the full reasoning):
--
--   skeleton   → code   (app/documents/templates/*.tsx — clause order, layout)
--   clause text→ HERE   (clause / clause_variant — versioned, AI-extractable)
--   field values→HERE   (document_draft.field_values — per document instance)
--
-- The clause library is data rather than code because Simon intends to feed
-- past contracts through AI to extract wording variants, and because Bronwyn
-- already keeps suspensive-condition variants by entity type (natural person /
-- company / trust). Dozens of variants per slot is a database, not a deploy.

-- ---------------------------------------------------------------------------
-- CLAUSE LIBRARY
-- ---------------------------------------------------------------------------

create type clause_category as enum (
  'mandate_terms',      -- marketing price, commission, term, sole/exclusive rights
  'popia',              -- personal information consent
  'warranty',           -- seller warranties, defect disclosure
  'juristic',           -- company/CC/trust signatory capacity
  'suspensive',         -- conditions precedent (the variant-heavy one)
  'compliance',         -- electrical CoC, beetle, gas, electric fence, SPLUMA
  'recordal',           -- estate rules, Thesen entry fee
  'financial',          -- purchase price, deposit, bond, guarantees
  'general',            -- voetstoots, entire agreement, notices, arbitration
  'signature'           -- signature blocks, FFC warrant
);

-- A clause is a *slot* with a stable key. Its wording lives in the variants.
create table clause (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,   -- 'mandate.popia_consent', 'suspensive.bond'
  label       text not null,
  category    clause_category not null,
  description text,                   -- what this clause is for, in plain words
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One wording of a clause. Multiple variants per clause is the normal case:
-- the same suspensive condition reads differently for a trust than for a
-- natural person.
--
-- `body` carries {{token}} placeholders resolved against the document context
-- (see lib/documents/resolve.ts). `applies_when` is a jsonb predicate the
-- resolver evaluates to auto-select a variant — e.g. {"seller_type":"trust"}.
-- Null means "always eligible, agent chooses".
--
-- Provenance matters here. A variant extracted by AI from a past contract is
-- NOT the same trust level as one Bronwyn typed, and the UI must be able to
-- say so before an agent puts it in a binding document.
create type clause_source as enum (
  'master_template',    -- verbatim from Bronwyn's master documents
  'agent_edit',         -- promoted from a document_draft override
  'ai_extracted',       -- pulled out of a past contract by AI — REVIEW REQUIRED
  'manual'              -- typed directly into the library by an admin
);

create table clause_variant (
  id             uuid primary key default gen_random_uuid(),
  clause_id      uuid not null references clause(id) on delete cascade,
  label          text not null,           -- 'Standard', 'Trust purchaser', 'Sale of own property'
  body           text not null,           -- clause text with {{tokens}}
  applies_when   jsonb,                   -- auto-select predicate; null = manual choice
  is_default     boolean not null default false,
  source         clause_source not null default 'manual',
  source_document_id uuid references document(id) on delete set null,
  -- AI-extracted variants start unapproved and must not be offered to an
  -- agent until a human has read them.
  approved       boolean not null default false,
  approved_by    uuid references app_user(id) on delete set null,
  approved_at    timestamptz,
  version        int not null default 1,
  supersedes_id  uuid references clause_variant(id) on delete set null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- At most one default per clause.
create unique index uq_clause_variant_default
  on clause_variant(clause_id) where is_default;

create index idx_clause_variant_clause   on clause_variant(clause_id);
create index idx_clause_variant_approved on clause_variant(approved) where approved;

-- ---------------------------------------------------------------------------
-- TEMPLATE REGISTRY
-- ---------------------------------------------------------------------------

-- The skeleton lives in code; this table is the registry the UI lists from and
-- the join point for slots. `component` names the React template that renders
-- it (e.g. 'MandateSole') so adding a template is a row plus a file.
create table doc_template (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,    -- 'mandate_exclusive', 'agreement_sale_house'
  label          text not null,
  component      text not null,           -- React component in app/documents/templates
  doc_type_id    uuid references document_type(id) on delete set null,
  -- What this template needs in order to be worth opening. Used by the
  -- /documents hub to decide whether to demand a property first.
  requires_property boolean not null default true,
  requires_purchaser boolean not null default false,
  description    text,
  sort_order     int not null default 100,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Which clauses appear in a template, in what order, and when.
--
-- `condition` is a jsonb predicate evaluated against the document context:
-- {"price_gt": 2000000} for the non-resident seller clause, {"in_estate": true}
-- for the estate recordal. Null means always included.
--
-- `is_optional` marks the clauses Bronwyn's masters annotate with
-- "DELETE or state whichever is NOT APPLICABLE" — the agent is asked.
create table doc_template_slot (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references doc_template(id) on delete cascade,
  clause_id    uuid not null references clause(id) on delete restrict,
  ordinal      int not null,
  heading      text,                    -- '15.1 ELECTRICAL COMPLIANCE CERTIFICATE'
  numbering    text,                    -- '15.1' — masters are hand-numbered
  condition    jsonb,
  is_optional  boolean not null default false,
  default_on   boolean not null default true,   -- for optional slots
  created_at   timestamptz not null default now(),
  unique (template_id, ordinal)
);

create index idx_doc_template_slot_template on doc_template_slot(template_id);

-- ---------------------------------------------------------------------------
-- DOCUMENT DRAFTS
-- ---------------------------------------------------------------------------

-- Simon, 2026-08-05: "Once the agent is happy, then it comes out as a PDF. But
-- they must be able to edit the document within the OS system."
--
-- So the draft stays structured — field values, chosen variants, and any
-- inline edits — and stays editable. The PDF is a one-way snapshot taken at
-- finalisation, not a document format we round-trip through. That prevents
-- the worst case: someone editing a Word file offline and silently bypassing
-- the clause logic.
create type document_draft_status as enum ('draft', 'final', 'superseded');

create table document_draft (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references doc_template(id) on delete restrict,
  status        document_draft_status not null default 'draft',

  -- Context anchors. Which of these are set records how the agent arrived,
  -- which is exactly what decides how much was prefilled vs interviewed.
  property_id   uuid references property(id) on delete cascade,
  listing_id    uuid references listing(id) on delete cascade,
  transfer_id   uuid references transfer(id) on delete cascade,
  agreement_id  uuid references agreement(id) on delete set null,
  mandate_id    uuid references mandate(id) on delete set null,

  title         text,
  -- Resolved + answered field values, keyed by field name.
  field_values  jsonb not null default '{}'::jsonb,
  -- clause_id → clause_variant_id for every slot where a choice was made.
  clause_selections jsonb not null default '{}'::jsonb,
  -- clause_id → edited body. The learning loop: these are human corrections
  -- on real deals and the best candidate variants the library will ever get.
  clause_overrides  jsonb not null default '{}'::jsonb,
  -- Slots the agent switched off (the "DELETE if not applicable" ones).
  omitted_clauses   jsonb not null default '[]'::jsonb,

  -- Set once finalised: the PDF snapshot in the documents bucket.
  rendered_document_id uuid references document(id) on delete set null,
  finalised_at  timestamptz,
  finalised_by  uuid references app_user(id) on delete set null,

  created_by    uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_document_draft_property on document_draft(property_id);
create index idx_document_draft_listing  on document_draft(listing_id);
create index idx_document_draft_transfer on document_draft(transfer_id);
create index idx_document_draft_status   on document_draft(status);
create index idx_document_draft_created_by on document_draft(created_by);

-- ---------------------------------------------------------------------------
-- MANDATE: typed financial columns
-- ---------------------------------------------------------------------------
-- Phase 1's saveMandate concatenated asking price and commission into
-- mandate.notes as free text, which its own comment flagged as temporary.
-- A mandate document can't be regenerated from a string, so type them.
alter table mandate add column if not exists asking_price        numeric(14,2);
alter table mandate add column if not exists commission_pct      numeric(5,2);
alter table mandate add column if not exists commission_incl_vat boolean;
alter table mandate add column if not exists term_months         int;

comment on column mandate.asking_price is
  'Marketing price agreed in the mandate. Distinct from listing.asking_price, which can move without a new mandate.';
comment on column mandate.term_months is
  'Mandate period. Exclusive master fixes 12; Open and Joint leave it blank for the agent.';

-- ---------------------------------------------------------------------------
-- TRIGGERS + RLS
-- ---------------------------------------------------------------------------

create trigger trg_clause_updated
  before update on clause
  for each row execute function set_updated_at();
create trigger trg_clause_variant_updated
  before update on clause_variant
  for each row execute function set_updated_at();
create trigger trg_doc_template_updated
  before update on doc_template
  for each row execute function set_updated_at();
create trigger trg_document_draft_updated
  before update on document_draft
  for each row execute function set_updated_at();

alter table clause            enable row level security;
alter table clause_variant    enable row level security;
alter table doc_template      enable row level security;
alter table doc_template_slot enable row level security;
alter table document_draft    enable row level security;

-- The library is readable by all staff (agents need to pick clauses) but only
-- admins may change it. Bronwyn's wording is not something an agent edits
-- globally — they can override on their own draft, which is captured
-- separately and reviewed.
create policy clause_read on clause for select using (is_staff());
create policy clause_write on clause for all using (is_admin()) with check (is_admin());

create policy clause_variant_read on clause_variant for select using (is_staff());
create policy clause_variant_write on clause_variant for all using (is_admin()) with check (is_admin());

create policy doc_template_read on doc_template for select using (is_staff());
create policy doc_template_write on doc_template for all using (is_admin()) with check (is_admin());

create policy doc_template_slot_read on doc_template_slot for select using (is_staff());
create policy doc_template_slot_write on doc_template_slot for all using (is_admin()) with check (is_admin());

-- Drafts: agents see and edit their own plus anything on a transfer they lead;
-- admins see everything. Mirrors the existing agent-scoping baseline.
create policy document_draft_read on document_draft for select
  using (
    is_admin()
    or created_by = auth.uid()
    or exists (
      select 1 from transfer t
      where t.id = document_draft.transfer_id
        and t.lead_agent_user_id = auth.uid()
    )
  );

create policy document_draft_write on document_draft for all
  using (is_admin() or created_by = auth.uid())
  with check (is_admin() or created_by = auth.uid());
