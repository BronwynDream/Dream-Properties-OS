-- Show houses + private viewings + valuation visits.
--
-- SA property practice: Sunday afternoon show houses are the primary
-- weekly rhythm at Dream. Private viewings run on demand through the
-- week. Agents also do valuation visits (a viewing where the seller
-- is the audience, not the buyer). All three fit the same data shape.
--
-- Attendees are captured for follow-up. Some are known parties
-- (returning buyers, already-KYC'd contacts); most are walk-ins the
-- agent meets for the first time — capture as text so we can chase
-- with a call/WhatsApp without forcing a party record up-front.

create type viewing_kind as enum (
  'show_house',       -- publicly advertised, walk-ins
  'private_viewing',  -- scheduled with a specific buyer
  'valuation_visit'   -- agent visiting to price a potential mandate
);

create type viewing_status as enum ('scheduled', 'completed', 'cancelled');

create table viewing (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid references listing(id) on delete cascade,
  transfer_id      uuid references transfer(id) on delete cascade,
  property_id      uuid references property(id) on delete cascade,
  agent_user_id    uuid references app_user(id) on delete set null,
  kind             viewing_kind not null default 'show_house',
  status           viewing_status not null default 'scheduled',
  scheduled_at     timestamptz not null,
  duration_minutes int not null default 60,
  address_override text,                              -- meet at gate, etc.
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- at least one of the three property-ish anchors must be set so a
  -- viewing is always attributable to something clickable.
  check (property_id is not null or listing_id is not null or transfer_id is not null)
);

create table viewing_attendee (
  id            uuid primary key default gen_random_uuid(),
  viewing_id    uuid not null references viewing(id) on delete cascade,
  party_id      uuid references party(id) on delete set null,
  name          text,          -- walk-in name if no party record yet
  email         text,
  phone         text,
  followed_up   boolean not null default false,
  is_interested boolean,       -- null = unknown, true = keen, false = pass
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- either we know the party or we captured a walk-in name
  check (party_id is not null or (name is not null and length(trim(name)) > 0))
);

create trigger trg_viewing_updated
  before update on viewing
  for each row execute function set_updated_at();

create trigger trg_viewing_attendee_updated
  before update on viewing_attendee
  for each row execute function set_updated_at();

create index idx_viewing_scheduled_at    on viewing(scheduled_at);
create index idx_viewing_agent           on viewing(agent_user_id);
create index idx_viewing_property        on viewing(property_id);
create index idx_viewing_listing         on viewing(listing_id);
create index idx_viewing_transfer        on viewing(transfer_id);
create index idx_viewing_attendee_viewing on viewing_attendee(viewing_id);

alter table viewing          enable row level security;
alter table viewing_attendee enable row level security;

create policy viewing_read
  on viewing for select
  using (is_staff());
create policy viewing_write
  on viewing for all
  using (is_admin())
  with check (is_admin());

create policy viewing_attendee_read
  on viewing_attendee for select
  using (is_staff());
create policy viewing_attendee_write
  on viewing_attendee for all
  using (is_admin())
  with check (is_admin());
