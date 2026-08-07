-- Contact CRM v2: agent contact books, interest matching, compliant outreach.
--
-- Plan 008. Read plans/008-contact-crm-v2.md before changing anything here —
-- several of these choices are legal requirements, not preferences.
--
-- The short version of why this is shaped the way it is:
--
--   POPIA s69 requires opt-in consent for electronic direct marketing, with a
--   soft opt-in (s69(3)) for existing customers marketing similar services,
--   and a hard "one approach only" rule (s69(2)) for asking someone who has
--   not consented. The CPA Amendment Regulations 2026 (in force 15 April 2026)
--   add a national opt-out registry that every direct marketer must register
--   with and cleanse against MONTHLY. Where the two overlap, the more
--   protective wins. Penalties reach R10m / 10 years (POPIA) and R1m or 10%
--   of turnover (CPA).
--
-- So consent is the spine of this schema, not an attribute hanging off it.

-- ---------------------------------------------------------------------------
-- CONTACT OWNERSHIP + PROVENANCE
-- ---------------------------------------------------------------------------

-- Where a contact came from. Drives the DEFAULT lawful basis, and is the first
-- thing anyone will ask when a complaint arrives. 'unknown' exists so an
-- honest import can say so rather than being forced into a flattering lie.
create type contact_source as enum (
  'past_client',        -- transacted with Dream — s69(3) soft opt-in territory
  'show_house',         -- signed a register; basis depends on what it said
  'referral',
  'personal_network',   -- agent's own contacts; NO consent yet, one ask only
  'website_enquiry',
  'portal_lead',        -- P24 / Private Property enquiry
  'imported',           -- bulk import, provenance not established at import
  'unknown'
);

-- Contacts belong to the agent who built the relationship, and are visible to
-- admin. Simon's call, 2026-08-06, and the right one: Dream is the RESPONSIBLE
-- PARTY under POPIA, so it cannot lawfully control data it cannot see.
alter table party add column if not exists owner_user_id uuid references app_user(id) on delete set null;
alter table party add column if not exists source        contact_source not null default 'unknown';
alter table party add column if not exists source_notes  text;

create index if not exists idx_party_owner  on party(owner_user_id);
create index if not exists idx_party_source on party(source);

comment on column party.owner_user_id is
  'Agent whose contact this is. Null for parties created by the deal pipeline rather than by an agent''s contact book.';

-- ---------------------------------------------------------------------------
-- INTERESTS — the honest version of "group them by area"
-- ---------------------------------------------------------------------------
-- Simon asked for groups by area. Static groups go stale and cannot express
-- "Simola or Pezula, R4-6m, freehold". An interest records what the agent
-- actually knows, and the group is derived at send time — which also means a
-- R5.2m Simola listing can skip the people whose ceiling is R3m instead of
-- mailing them anyway.

create type interest_type as enum ('buy', 'sell', 'rent', 'watch');

create table party_interest (
  id             uuid primary key default gen_random_uuid(),
  party_id       uuid not null references party(id) on delete cascade,
  interest_type  interest_type not null default 'buy',
  suburb_id      uuid references suburb(id) on delete set null,
  estate_id      uuid references estate(id) on delete set null,
  property_type_id uuid references property_type(id) on delete set null,
  price_min      numeric(14,2),
  price_max      numeric(14,2),
  notes          text,
  active         boolean not null default true,
  created_by     uuid references app_user(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- An interest that names no area, type or price band matches everything,
  -- which is how an agent accidentally mails their whole book.
  check (
    suburb_id is not null
    or estate_id is not null
    or property_type_id is not null
    or price_min is not null
    or price_max is not null
  ),
  check (price_min is null or price_max is null or price_min <= price_max)
);

create index idx_party_interest_party  on party_interest(party_id);
create index idx_party_interest_suburb on party_interest(suburb_id) where active;
create index idx_party_interest_estate on party_interest(estate_id) where active;

-- Free-form labels for everything that isn't geography or money.
create table contact_tag (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique,
  colour     text,
  created_at timestamptz not null default now()
);

create table party_tag (
  party_id   uuid not null references party(id) on delete cascade,
  tag_id     uuid not null references contact_tag(id) on delete cascade,
  created_by uuid references app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (party_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- CONSENT — existing table, finally given the columns to do real work
-- ---------------------------------------------------------------------------
-- `consent` has existed since 0004_docs.sql and nothing has ever written to it.

-- Consent is PER CHANNEL. The Information Regulator's guidance is explicit
-- that consent for one channel does not carry to another, so an email opt-in
-- is not permission to WhatsApp someone.
alter table consent add column if not exists channel       comm_channel;
alter table consent add column if not exists evidence      text;
alter table consent add column if not exists evidence_ref  text;
alter table consent add column if not exists captured_by   uuid references app_user(id) on delete set null;

-- s69(2): a responsible party may approach a data subject ONCE to request
-- consent, and not again. This must be a database guard rather than a UI
-- convention — an agent under pressure will not remember, and the penalty for
-- forgetting is not a bug report.
alter table consent add column if not exists requested_at  timestamptz;
alter table consent add column if not exists request_count int not null default 0;

comment on column consent.request_count is
  'POPIA s69(2) allows ONE approach to request consent. The uq_consent_one_request index makes a second attempt a database error.';

-- One outstanding consent REQUEST per party per channel, ever.
create unique index if not exists uq_consent_one_request
  on consent(party_id, channel)
  where requested_at is not null;

create index if not exists idx_consent_party   on consent(party_id);
create index if not exists idx_consent_granted on consent(party_id, channel) where granted_at is not null and withdrawn_at is null;

-- ---------------------------------------------------------------------------
-- SUPPRESSION — keyed to the contact point, never to the person
-- ---------------------------------------------------------------------------
-- A party row and an email address are not the same thing. The same address
-- can sit on two party rows after a bad merge, so suppressing the PERSON would
-- let an unsubscribed address get mailed again through their duplicate.
-- Suppress the address.

create type suppression_reason as enum (
  'unsubscribed',   -- they clicked the opt-out in one of our messages
  'complained',     -- marked as spam
  'bounced_hard',
  'ncc_registry',   -- pre-emptive block on the National Consumer Commission registry
  'manual'          -- an admin added them
);

create table contact_point_suppression (
  id               uuid primary key default gen_random_uuid(),
  channel          comm_channel not null,
  -- Lowercased email, or phone in E.164. Normalise on write; matching a raw
  -- string is how a suppressed contact slips back into an audience.
  value_normalised text not null,
  reason           suppression_reason not null,
  source           text,
  party_id         uuid references party(id) on delete set null,  -- best-effort link, not the key
  created_at       timestamptz not null default now(),
  unique (channel, value_normalised)
);

create index idx_suppression_value on contact_point_suppression(value_normalised);

-- ---------------------------------------------------------------------------
-- CAMPAIGNS
-- ---------------------------------------------------------------------------

create type campaign_status as enum ('draft', 'preview', 'sending', 'sent', 'cancelled', 'failed');

create table campaign (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  channel        comm_channel not null default 'email',
  status         campaign_status not null default 'draft',
  -- What listing prompted this. Null for a general newsletter.
  listing_id     uuid references listing(id) on delete set null,
  property_id    uuid references property(id) on delete set null,
  -- The interest filter that produced the audience, kept so we can answer
  -- "who did this go to and why" a year later.
  audience_filter jsonb not null default '{}'::jsonb,
  subject        text,
  body_template  text,
  sent_at        timestamptz,
  created_by     uuid references app_user(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create type campaign_recipient_status as enum (
  'queued', 'sent', 'delivered', 'bounced', 'opened', 'unsubscribed',
  'suppressed',   -- excluded before send, with a reason
  'no_consent'    -- excluded because no lawful basis
);

create table campaign_recipient (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references campaign(id) on delete cascade,
  party_id       uuid not null references party(id) on delete cascade,
  channel_value  text not null,              -- the address/number actually used
  status         campaign_recipient_status not null default 'queued',
  -- Why someone was left out. The audience preview shows this to the agent so
  -- exclusions are visible rather than silent.
  exclusion_reason text,
  -- Per-recipient unsubscribe token. Every message must carry an objection
  -- route (POPIA s69(3)) and be identifiable as to sender (CPA regs 2026).
  unsubscribe_token uuid not null default gen_random_uuid(),
  provider_message_id text,
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (campaign_id, party_id, channel_value)
);

create unique index uq_campaign_recipient_token on campaign_recipient(unsubscribe_token);
create index idx_campaign_recipient_campaign on campaign_recipient(campaign_id);
create index idx_campaign_recipient_party    on campaign_recipient(party_id);

-- ---------------------------------------------------------------------------
-- CONTACT IMPORT — same drop → review → commit shape as document triage
-- ---------------------------------------------------------------------------

create type contact_import_status as enum ('uploaded', 'parsed', 'reviewing', 'committed', 'cancelled');

create table contact_import_batch (
  id            uuid primary key default gen_random_uuid(),
  label         text,
  status        contact_import_status not null default 'uploaded',
  -- Applied to every row unless a row overrides it. An import that cannot
  -- attribute a lawful basis must say 'unknown', not guess 'past_client'.
  default_source contact_source not null default 'unknown',
  owner_user_id uuid references app_user(id) on delete set null,
  row_count     int not null default 0,
  created_by    uuid references app_user(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table contact_import_row (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references contact_import_batch(id) on delete cascade,
  raw             jsonb not null,
  full_name       text,
  email           text,
  phone           text,
  source          contact_source,
  -- Fuzzy match against existing parties (propose_matches, migration 0011) so
  -- an import doesn't create a second Angie Bevan.
  matched_party_id uuid references party(id) on delete set null,
  match_score      numeric(5,2),
  action           text not null default 'create',   -- create | merge | skip
  committed_party_id uuid references party(id) on delete set null,
  error            text,
  created_at       timestamptz not null default now()
);

create index idx_contact_import_row_batch on contact_import_row(batch_id);

-- ---------------------------------------------------------------------------
-- TRIGGERS + RLS
-- ---------------------------------------------------------------------------

create trigger trg_party_interest_updated      before update on party_interest      for each row execute function set_updated_at();
create trigger trg_campaign_updated            before update on campaign            for each row execute function set_updated_at();
create trigger trg_campaign_recipient_updated  before update on campaign_recipient  for each row execute function set_updated_at();
create trigger trg_contact_import_batch_updated before update on contact_import_batch for each row execute function set_updated_at();

alter table party_interest            enable row level security;
alter table contact_tag               enable row level security;
alter table party_tag                 enable row level security;
alter table contact_point_suppression enable row level security;
alter table campaign                  enable row level security;
alter table campaign_recipient        enable row level security;
alter table contact_import_batch      enable row level security;
alter table contact_import_row        enable row level security;

-- Interests and tags: any staff member can read (an agent taking a call about
-- a Simola listing needs to see who wants Simola), but only the owning agent
-- or an admin can change them.
create policy party_interest_read on party_interest for select using (is_staff());
create policy party_interest_write on party_interest for all
  using (
    is_admin()
    or exists (select 1 from party p where p.id = party_interest.party_id and p.owner_user_id = auth.uid())
  )
  with check (
    is_admin()
    or exists (select 1 from party p where p.id = party_interest.party_id and p.owner_user_id = auth.uid())
  );

create policy contact_tag_read on contact_tag for select using (is_staff());
create policy contact_tag_write on contact_tag for all using (is_staff()) with check (is_staff());

create policy party_tag_read on party_tag for select using (is_staff());
create policy party_tag_write on party_tag for all using (is_staff()) with check (is_staff());

-- Suppression is readable by all staff and writable by admin or the system.
-- An agent must never be able to remove someone from the suppression list to
-- get a send through.
create policy suppression_read on contact_point_suppression for select using (is_staff());
create policy suppression_write on contact_point_suppression for all
  using (is_admin()) with check (is_admin());

create policy campaign_read on campaign for select
  using (is_admin() or created_by = auth.uid());
create policy campaign_write on campaign for all
  using (is_admin() or created_by = auth.uid())
  with check (is_admin() or created_by = auth.uid());

create policy campaign_recipient_read on campaign_recipient for select
  using (
    is_admin()
    or exists (select 1 from campaign c where c.id = campaign_recipient.campaign_id and c.created_by = auth.uid())
  );
create policy campaign_recipient_write on campaign_recipient for all
  using (is_admin()) with check (is_admin());

create policy contact_import_batch_read on contact_import_batch for select
  using (is_admin() or created_by = auth.uid());
create policy contact_import_batch_write on contact_import_batch for all
  using (is_admin() or created_by = auth.uid())
  with check (is_admin() or created_by = auth.uid());

create policy contact_import_row_read on contact_import_row for select
  using (
    is_admin()
    or exists (select 1 from contact_import_batch b where b.id = contact_import_row.batch_id and b.created_by = auth.uid())
  );
create policy contact_import_row_write on contact_import_row for all
  using (
    is_admin()
    or exists (select 1 from contact_import_batch b where b.id = contact_import_row.batch_id and b.created_by = auth.uid())
  )
  with check (
    is_admin()
    or exists (select 1 from contact_import_batch b where b.id = contact_import_row.batch_id and b.created_by = auth.uid())
  );
