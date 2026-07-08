-- Dream Knysna OS — 0025 external listings
-- Repo copy of the schema Simon applied against Bon Bon's DB. Do NOT re-run.
-- Kept here so a fresh clone can rebuild the database in order.
--
-- External listings are what other portals (and Dream's own WordPress site)
-- publish for a given property. The scraper populates this table nightly per
-- source; the map merges rows into dedup_group_id buckets so one physical
-- property doesn't render as three duplicate pins when it's advertised on
-- Property24 + Private Property + Dream's site simultaneously.
--
-- matched_property_id: when set, this row is linked to a property in our DB
-- and its pin merges into the Dream-owned pin on the map. When null, it's a
-- competitor / market-only listing and gets a neutral pin.
--
-- The scraper writes via createServiceClient() (SUPABASE_SERVICE_ROLE_KEY) so
-- RLS never blocks a nightly refresh even without a user session.

create type listing_source as enum (
  'dream_website',
  'property24',
  'private_property'
);

create table external_listing (
  id                     uuid primary key default gen_random_uuid(),
  source                 listing_source not null,
  source_ref             text not null,                   -- slug / listing id per source
  url                    text,
  headline               text,
  address_raw            text,
  suburb                 text,
  price                  numeric(14,2),
  bedrooms               int,
  bathrooms              int,
  property_type          text,
  agency_name            text,
  image_url              text,
  lat                    numeric(8,6),
  lng                    numeric(9,6),
  lightstone_property_id bigint,
  matched_property_id    uuid references property(id) on delete set null,
  dedup_group_id         uuid,
  raw                    jsonb,
  first_seen             timestamptz not null default now(),
  last_seen              timestamptz not null default now(),
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (source, source_ref)
);

create trigger trg_external_listing_updated
  before update on external_listing
  for each row execute function set_updated_at();

create index idx_external_listing_source       on external_listing(source);
create index idx_external_listing_active       on external_listing(active) where active;
create index idx_external_listing_matched      on external_listing(matched_property_id) where matched_property_id is not null;
create index idx_external_listing_dedup        on external_listing(dedup_group_id)      where dedup_group_id      is not null;
create index idx_external_listing_lightstone   on external_listing(lightstone_property_id) where lightstone_property_id is not null;
create index idx_external_listing_coords       on external_listing(lng, lat)             where lng is not null and lat is not null;

-- RLS: staff (admin + agent) read; only admin writes. The scraper uses the
-- service role which bypasses RLS entirely, so a nightly refresh works even
-- if the cron runs with no user session.
alter table external_listing enable row level security;

create policy "external_listing staff read"
  on external_listing for select
  using (is_staff());

create policy "external_listing admin write"
  on external_listing for all
  using (is_admin())
  with check (is_admin());

comment on table external_listing is
  'Listings scraped or fed from external portals (dream_website, property24, private_property). Deduped into dedup_group_id groups and, where possible, matched to a property row.';
comment on column external_listing.matched_property_id is
  'When set, this external listing represents one of our properties. Never overwrite a manually-set match (a future manual-override table can protect this).';
comment on column external_listing.dedup_group_id is
  'Cluster key: same physical listing across sources shares this uuid. Recomputed on every refresh; reuses an existing group id when possible.';
