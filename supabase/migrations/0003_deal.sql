-- ============================================================================
-- Dream Knysna OS — 0003 deal: transfer, listing, mandate, offer, agreement,
--                    conditions, milestones, commission, compliance
-- ============================================================================

-- One ownership-change cycle on a property (Bronwyn's "3 Oupad Morris to Wilson").
create table transfer (
  id                    uuid primary key default gen_random_uuid(),
  property_id           uuid not null references property(id) on delete restrict,
  name                  text not null,                       -- "{address} {seller} to {buyer}"
  status                transfer_status not null default 'preparing',
  lead_agent_user_id    uuid references app_user(id),
  conveyancer_firm_id   uuid references conveyancer_firm(id),
  conveyancer_contact_id uuid references conveyancer_contact(id),
  opened_date           date default current_date,
  transfer_date         date,
  registered_date       date,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Many-to-many parties on a transfer, split by side (joint buyers/sellers supported).
create table transfer_party (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid not null references transfer(id) on delete cascade,
  party_id      uuid not null references party(id) on delete restrict,
  side          text not null check (side in ('seller','purchaser')),
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (transfer_id, party_id, side)
);

-- Listing = first-class entity within the seller file.
create table listing (
  id                uuid primary key default gen_random_uuid(),
  transfer_id       uuid references transfer(id) on delete set null,
  property_id       uuid not null references property(id) on delete restrict,
  status            listing_status not null default 'draft',
  asking_price      numeric(14,2),
  agent_user_id     uuid references app_user(id),
  headline          text,
  marketing_copy    text,                                 -- Bronwyn's voice — preserve verbatim
  listed_date       date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table listing_price_history (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references listing(id) on delete cascade,
  price         numeric(14,2) not null,
  effective_date date not null default current_date,
  created_at    timestamptz not null default now()
);

-- Mandate — 1:many on a listing (12 Eagles carried Open + Joint over time).
-- Evidence may be signed PDF, email thread, or verbal note (all valid; soft prompt only).
create table mandate (
  id                     uuid primary key default gen_random_uuid(),
  listing_id             uuid not null references listing(id) on delete cascade,
  type                   mandate_type not null,
  evidence               mandate_evidence not null default 'signed_pdf',
  counterparty_agency_id uuid references agency(id),        -- set where joint (e.g. Pam Golding)
  file_ref               text,
  signed_date            date,
  expiry_date            date,
  occupation             text,
  mls_flag               boolean not null default false,
  document_id            uuid,                              -- FK added in 0004 (document)
  notes                  text,
  created_at             timestamptz not null default now()
);

create table cma (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references listing(id) on delete cascade,
  document_id   uuid,                                       -- FK added in 0004
  narrative     text,
  prepared_date date,
  created_at    timestamptz not null default now()
);

-- Offers / OTPs — distinct from the executed agreement (offer history).
create table offer (
  id                 uuid primary key default gen_random_uuid(),
  transfer_id        uuid not null references transfer(id) on delete cascade,
  purchaser_party_id uuid references party(id),
  amount             numeric(14,2),
  deposit            numeric(14,2),
  offer_date         date default current_date,
  status             offer_status not null default 'submitted',
  conditions_summary text,
  document_id        uuid,                                  -- FK added in 0004
  notes              text,
  created_at         timestamptz not null default now()
);

-- Agreements — AOS / land-freehold / movables, WITH version + execution status
-- (gap #2: the Plot A4 land agreement existed as template → draft → clean_final → executed).
create table agreement (
  id             uuid primary key default gen_random_uuid(),
  transfer_id    uuid not null references transfer(id) on delete cascade,
  agreement_type agreement_type not null default 'sale_improved',
  status         agreement_status not null default 'draft',
  version        int not null default 1,
  supersedes_id  uuid references agreement(id),
  price          numeric(14,2),
  deposit        numeric(14,2),
  signature_date date,
  transfer_date  date,
  document_id    uuid,                                      -- FK added in 0004
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Suspensive conditions with a lifecycle + evidence link
-- (Grove: condition waived on WhatsApp — evidence_document_id points at the screenshot).
create table suspensive_condition (
  id                   uuid primary key default gen_random_uuid(),
  agreement_id         uuid not null references agreement(id) on delete cascade,
  type                 suspensive_condition_type not null,
  description          text,
  due_date             date,
  status               condition_status not null default 'pending',
  fulfilled_date       date,
  evidence_document_id uuid,                                -- FK added in 0004
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Milestones / dated obligations (deposit 7 days, guarantee 30 days, transfer date...).
create table milestone (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid not null references transfer(id) on delete cascade,
  type          milestone_type not null,
  due_date      date,
  status        milestone_status not null default 'pending',
  met_date      date,
  source        text not null default 'contract',           -- contract | manual
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Commission ledger — nullable amounts (Grove agreement left commission blank).
create table commission (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid not null references transfer(id) on delete cascade,
  payee_agency_id uuid references agency(id),
  gross_amount  numeric(14,2),
  vat_amount    numeric(14,2),
  total_amount  numeric(14,2),
  is_first_draw boolean not null default true,
  status        commission_status not null default 'pending',
  invoice_date  date,
  paid_date     date,
  split_notes   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Compliance certificates (gas / electrical / beetle / plumbing / electric fence).
create table compliance_cert (
  id                 uuid primary key default gen_random_uuid(),
  property_id        uuid not null references property(id) on delete cascade,
  transfer_id        uuid references transfer(id) on delete set null,
  compliance_type_id uuid not null references compliance_type(id),
  issued_date        date,
  expiry_date        date,
  issuer             text,
  document_id        uuid,                                  -- FK added in 0004
  notes              text,
  created_at         timestamptz not null default now()
);

create trigger trg_transfer_updated  before update on transfer  for each row execute function set_updated_at();
create trigger trg_listing_updated   before update on listing   for each row execute function set_updated_at();
create trigger trg_agreement_updated before update on agreement for each row execute function set_updated_at();
create trigger trg_condition_updated before update on suspensive_condition for each row execute function set_updated_at();
create trigger trg_milestone_updated before update on milestone for each row execute function set_updated_at();
create trigger trg_commission_updated before update on commission for each row execute function set_updated_at();

create index idx_transfer_property on transfer(property_id);
create index idx_transfer_agent    on transfer(lead_agent_user_id);
create index idx_tparty_transfer   on transfer_party(transfer_id);
create index idx_tparty_party      on transfer_party(party_id);
create index idx_listing_property  on listing(property_id);
create index idx_listing_transfer  on listing(transfer_id);
create index idx_mandate_listing   on mandate(listing_id);
create index idx_offer_transfer    on offer(transfer_id);
create index idx_agreement_transfer on agreement(transfer_id);
create index idx_condition_agreement on suspensive_condition(agreement_id);
create index idx_milestone_transfer on milestone(transfer_id);
create index idx_compliance_property on compliance_cert(property_id);
