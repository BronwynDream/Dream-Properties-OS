-- Dream Knysna OS — 0029 cadastre import + erf snap
-- Everything the /api/cadastre/import + /api/cadastre/snap routes need on
-- top of 0028's table + parcel_mvt function.
--
--   cadastral_import_cursor   singleton progress state (town cursor + offset)
--   upsert_parcel(...)        RPC to insert/refresh one erf from GeoJSON
--   snap_all_to_parcels()     bulk ST_Contains + ST_Centroid update
--   property.parcel_prcl_key       FK to cadastral_parcel — the parcel we snapped to
--   external_listing.parcel_prcl_key + geo_manual   same, plus the manual-override flag

-- ---------------------------------------------------------------------------
-- Import cursor — one row, tracks progress through the Garden Route towns.
-- ---------------------------------------------------------------------------
create table cadastral_import_cursor (
  id                boolean primary key default true check (id),
  town_labels       text[] not null default '{}',
  town_index        int    not null default 0,
  offset_in_town    int    not null default 0,
  total_imported    int    not null default 0,
  last_ran_at       timestamptz,
  updated_at        timestamptz not null default now()
);
insert into cadastral_import_cursor (id) values (true) on conflict (id) do nothing;

create trigger trg_cadastral_cursor_updated
  before update on cadastral_import_cursor
  for each row execute function set_updated_at();

alter table cadastral_import_cursor enable row level security;
create policy "cursor admin all" on cadastral_import_cursor
  for all using (is_admin()) with check (is_admin());

comment on table cadastral_import_cursor is
  'Singleton progress state for /api/cadastre/import. Each invocation reads/advances the cursor so the import is resumable across many short runs on the Hobby 60s cap.';

-- ---------------------------------------------------------------------------
-- upsert_parcel — insert or refresh one erf. Takes GeoJSON so the API route
-- doesn't have to construct raw WKT. Converts Polygon → MultiPolygon so the
-- geom column type stays consistent. Centroid is derived server-side.
-- ---------------------------------------------------------------------------
create or replace function upsert_parcel(
  p_prcl_key    text,
  p_parcel_no   text,
  p_tag_value   text,
  p_maj_region  text,
  p_min_region  text,
  p_province    text,
  p_geom_json   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g geometry;
begin
  g := ST_SetSRID(ST_GeomFromGeoJSON(p_geom_json), 4326);
  if g is null then return; end if;
  if GeometryType(g) not in ('POLYGON', 'MULTIPOLYGON') then return; end if;

  insert into cadastral_parcel (
    prcl_key, parcel_no, tag_value, maj_region, min_region, province, geom, centroid, imported_at
  ) values (
    p_prcl_key, p_parcel_no, p_tag_value, p_maj_region, p_min_region, p_province,
    ST_Multi(g),
    ST_Centroid(g)::geography,
    now()
  )
  on conflict (prcl_key) do update set
    parcel_no   = excluded.parcel_no,
    tag_value   = excluded.tag_value,
    maj_region  = excluded.maj_region,
    min_region  = excluded.min_region,
    province    = excluded.province,
    geom        = excluded.geom,
    centroid    = excluded.centroid,
    imported_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- FK columns — remember which parcel a property / listing was snapped to.
-- ---------------------------------------------------------------------------
alter table property
  add column if not exists parcel_prcl_key text references cadastral_parcel(prcl_key);

-- external_listing needs both the FK and its own geo_manual flag, so the
-- future Lightstone re-geocode / a manual override on a market listing
-- can be respected the same way property.geo_manual is.
alter table external_listing
  add column if not exists parcel_prcl_key text references cadastral_parcel(prcl_key),
  add column if not exists geo_manual      boolean not null default false;

create index if not exists idx_property_parcel_key
  on property(parcel_prcl_key) where parcel_prcl_key is not null;
create index if not exists idx_external_listing_parcel_key
  on external_listing(parcel_prcl_key) where parcel_prcl_key is not null;

-- ---------------------------------------------------------------------------
-- Bulk snap: for every property + external_listing that has coords AND is
-- not geo_manual, find the smallest containing parcel and update coords to
-- its centroid + remember the prcl_key. One call replaces N per-row queries;
-- the ST_Contains lookup uses the GIST index on cadastral_parcel.geom.
-- ---------------------------------------------------------------------------
create or replace function snap_all_to_parcels()
returns table(properties_snapped int, listings_snapped int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  props_n int := 0;
  list_n  int := 0;
begin
  -- Properties
  with candidate as (
    select
      p.id                                              as pid,
      cp.prcl_key,
      ST_X(ST_Centroid(cp.geom))::float8                as clng,
      ST_Y(ST_Centroid(cp.geom))::float8                as clat,
      row_number() over (
        partition by p.id
        order by ST_Area(cp.geom) asc                   -- smallest containing parcel wins
      ) as rn
    from property p
    join cadastral_parcel cp
      on ST_Contains(cp.geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326))
    where p.lng is not null
      and p.lat is not null
      and p.geo_manual = false
  ),
  picked as (select * from candidate where rn = 1)
  update property p set
    lng             = picked.clng,
    lat             = picked.clat,
    parcel_prcl_key = picked.prcl_key
  from picked
  where p.id = picked.pid;
  get diagnostics props_n = row_count;

  -- External listings
  with candidate as (
    select
      el.id                                             as eid,
      cp.prcl_key,
      ST_X(ST_Centroid(cp.geom))::float8                as clng,
      ST_Y(ST_Centroid(cp.geom))::float8                as clat,
      row_number() over (
        partition by el.id
        order by ST_Area(cp.geom) asc
      ) as rn
    from external_listing el
    join cadastral_parcel cp
      on ST_Contains(cp.geom, ST_SetSRID(ST_MakePoint(el.lng, el.lat), 4326))
    where el.lng is not null
      and el.lat is not null
      and el.active
      and el.geo_manual = false
  ),
  picked as (select * from candidate where rn = 1)
  update external_listing el set
    lng             = picked.clng,
    lat             = picked.clat,
    parcel_prcl_key = picked.prcl_key
  from picked
  where el.id = picked.eid;
  get diagnostics list_n = row_count;

  return query select props_n, list_n;
end;
$$;

comment on function snap_all_to_parcels() is
  'Bulk erf-snap. Called by /api/cadastre/snap after an import completes; also safe to run any time. Respects geo_manual=true on both property and external_listing.';
