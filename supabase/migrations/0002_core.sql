-- ============================================================================
-- Dream Knysna OS — 0002 core: organisations, users, parties, property spine
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Organisations (entity tables, not enums)
-- ---------------------------------------------------------------------------
create table agency (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  ffc_no      text,                        -- PPRA Fidelity Fund Certificate
  is_dream    boolean not null default false,
  phone       text,
  email       citext,
  address     text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table conveyancer_firm (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  email       citext,
  address     text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- gap: a firm has many contacts (Foley-Nel = Colleen + Sandra)
create table conveyancer_contact (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references conveyancer_firm(id) on delete cascade,
  full_name   text not null,
  email       citext,
  phone       text,
  role        text,                        -- e.g. 'Conveyancer', 'Transfer secretary'
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- App users map 1:1 to Supabase auth.users; RLS keys off this table.
create table app_user (
  id          uuid primary key,            -- = auth.users.id
  full_name   text not null,
  email       citext unique,
  role        app_role not null default 'agent',
  ppra_ffc    text,
  agency_id   uuid references agency(id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Estates / schemes (gap #3: Pezula, Thesen, Leisure Isle carry design rules,
-- architectural approvals and levies that attach to every property inside them)
-- ---------------------------------------------------------------------------
create table estate (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          estate_kind not null default 'estate',
  suburb_id     uuid references suburb(id),
  hoa_name      text,
  hoa_contact   text,
  levy_notes    text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Party = unified person OR juristic entity (gap #1)
-- Natural person  -> first_names/surname/id_number/passport_no
-- Juristic entity -> entity_name/registration_no (+ members via party_member)
-- ---------------------------------------------------------------------------
create table party (
  id                 uuid primary key default gen_random_uuid(),
  party_type         party_type not null default 'individual',
  display_name       text not null,                 -- always populated for search/UI
  -- natural person
  first_names        text,
  surname            text,
  id_number          text,                          -- SA ID (store encrypted / masked in app layer)
  passport_no        text,
  date_of_birth      date,
  nationality_id     uuid references country(id),
  matrimonial_regime matrimonial_regime not null default 'unknown',
  spouse_party_id    uuid references party(id),     -- self-reference for spouse
  -- juristic entity
  entity_name        text,                          -- 'The Leisure Partnership', 'B Sanday CC'
  registration_no    text,                          -- CIPC reg / trust number / partnership ref
  -- shared
  tax_residency      tax_residency not null default 'unknown',
  is_vat_registered  boolean not null default false,
  vat_number         text,
  email              citext,
  phone              text,
  whatsapp           text,
  postal_address     text,
  domicilium_address text,
  physical_address   text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Members / directors / trustees / partners / beneficial owners of a juristic party.
-- Also carries share-register data and who may sign (gap #1: authorising docs).
create table party_member (
  id                  uuid primary key default gen_random_uuid(),
  entity_party_id     uuid not null references party(id) on delete cascade,   -- the company/CC/trust/partnership
  member_party_id     uuid not null references party(id) on delete restrict,  -- the natural person (or nested entity)
  role                fica_role not null,            -- director | member | trustee | partner | ubo
  share_pct           numeric(5,2),
  is_authorised_signatory boolean not null default false,
  notes               text,
  created_at          timestamptz not null default now(),
  unique (entity_party_id, member_party_id, role)
);

-- ---------------------------------------------------------------------------
-- Property spine
-- ---------------------------------------------------------------------------
create table property (
  id                 uuid primary key default gen_random_uuid(),
  primary_address    text not null,
  suburb_id          uuid references suburb(id),
  estate_id          uuid references estate(id),
  ownership_type_id  uuid references ownership_type(id),
  property_type_id   uuid references property_type(id),
  extent_sqm         numeric(12,2),
  title_deed_no      text,
  deeds_office       text default 'Cape Town',
  deeds_description  text,
  municipal_value    numeric(14,2),
  lightstone_ref     text,
  geom               geography(Point, 4326),        -- map pin
  cadastre           geometry(MultiPolygon, 4326),  -- erf polygon(s)
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- A property can hold multiple erven (169 Links = Erf 1602 + 1603).
create table erf (
  id                 uuid primary key default gen_random_uuid(),
  property_id        uuid not null references property(id) on delete cascade,
  erf_number         text not null,
  portion            text,
  scheme_name        text,
  deeds_description   text,
  created_at         timestamptz not null default now(),
  unique (property_id, erf_number, portion)
);

-- Owner timeline (Lightstone-fed; the same party recurs across transfers over time).
create table property_ownership_history (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references property(id) on delete cascade,
  owner_party_id uuid references party(id),
  owner_name_raw text,                      -- raw name if not yet linked to a party
  from_date     date,
  to_date       date,
  source        text not null default 'lightstone',   -- lightstone | dream | deeds
  created_at    timestamptz not null default now()
);

create trigger trg_agency_updated       before update on agency           for each row execute function set_updated_at();
create trigger trg_conveyancer_updated  before update on conveyancer_firm  for each row execute function set_updated_at();
create trigger trg_app_user_updated     before update on app_user          for each row execute function set_updated_at();
create trigger trg_estate_updated       before update on estate            for each row execute function set_updated_at();
create trigger trg_party_updated        before update on party             for each row execute function set_updated_at();
create trigger trg_property_updated     before update on property          for each row execute function set_updated_at();

create index idx_property_suburb   on property(suburb_id);
create index idx_property_estate   on property(estate_id);
create index idx_property_geom     on property using gist(geom);
create index idx_erf_property      on erf(property_id);
create index idx_party_display     on party using gin (to_tsvector('simple', display_name));
create index idx_party_member_ent  on party_member(entity_party_id);
