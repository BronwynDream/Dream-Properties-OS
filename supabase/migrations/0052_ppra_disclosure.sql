-- PPRA Section 67 Mandatory Disclosure — structured capture of the form
-- Bronwyn's Master Sale bundle ships as a PDF attachment. Regulatory:
-- Section 67 of the Property Practitioners Act requires the disclosure
-- to be signed by the seller AND acknowledged by the purchaser BEFORE
-- the OTP is concluded; without it the sale is voidable.
--
-- We store the structured answers (not just the scan) so the /compliance
-- watchlist can see at a glance which live deals have unanswered questions.
-- The signed PDF still lives in the `document` table via signed_document_id.

create type ppra_disclosure_form_type as enum ('house', 'plot');
create type ppra_disclosure_answer    as enum ('yes', 'no', 'na', 'unanswered');

-- One disclosure per (transfer, form_type). A transfer for a house + a
-- separate plot in the same estate would carry two rows.
create table ppra_disclosure (
  id                  uuid primary key default gen_random_uuid(),
  transfer_id         uuid not null references transfer(id) on delete cascade,
  form_type           ppra_disclosure_form_type not null,
  signed_at           date,                                             -- when owner signed
  signed_by_party_id  uuid references party(id) on delete set null,     -- which owner (joint sellers)
  purchaser_ack_at    date,                                             -- when purchaser acknowledged receipt
  signed_document_id  uuid references document(id) on delete set null,  -- scanned/signed PDF
  additional_info     text,                                             -- "additional information" free-text section
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (transfer_id, form_type)
);

-- One row per canonical question. question_key is a stable string; the
-- verbatim question_label is snapshotted at capture time so any future
-- rewording by PPRA does not silently reinterpret historical answers.
create table ppra_disclosure_answer_row (
  id             uuid primary key default gen_random_uuid(),
  disclosure_id  uuid not null references ppra_disclosure(id) on delete cascade,
  question_key   text not null,
  question_label text not null,
  answer         ppra_disclosure_answer not null default 'unanswered',
  explanation    text,          -- required when answer = 'yes' per Section 67
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (disclosure_id, question_key)
);

create trigger trg_ppra_disclosure_updated
  before update on ppra_disclosure
  for each row execute function set_updated_at();

create trigger trg_ppra_disclosure_row_updated
  before update on ppra_disclosure_answer_row
  for each row execute function set_updated_at();

create index idx_ppra_disclosure_transfer on ppra_disclosure(transfer_id);
create index idx_ppra_disclosure_row_disclosure on ppra_disclosure_answer_row(disclosure_id);

-- RLS — same shape as neighbouring transfer-scoped tables. All staff can
-- read, admins can write. Agent-write scoping stays in the app layer for
-- now, consistent with the batch policy in 0005_rls.sql.
alter table ppra_disclosure           enable row level security;
alter table ppra_disclosure_answer_row enable row level security;

create policy ppra_disclosure_read
  on ppra_disclosure for select
  using (is_staff());
create policy ppra_disclosure_write
  on ppra_disclosure for all
  using (is_admin())
  with check (is_admin());

create policy ppra_disclosure_row_read
  on ppra_disclosure_answer_row for select
  using (is_staff());
create policy ppra_disclosure_row_write
  on ppra_disclosure_answer_row for all
  using (is_admin())
  with check (is_admin());
