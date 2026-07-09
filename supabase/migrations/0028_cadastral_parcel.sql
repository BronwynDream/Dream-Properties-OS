-- Dream Knysna OS — 0028 cadastral parcel + MVT function
-- Repo copy of the schema Simon applied against Bon Bon's DB. Do NOT re-run.
-- Kept here so a fresh clone can rebuild the database in order.
--
-- cadastral_parcel is one row per South African erf, imported from the CSG
-- (Chief Surveyor General) cadastre via /api/cadastre/import. parcel_mvt(z,x,y)
-- returns the vector-tile bytes rendered by /api/tiles/parcels/[z]/[x]/[y].
--
-- Fed by /api/cadastre/import (paged), served by /api/tiles/parcels, consumed
-- by the "Erf boundaries" toggle on /map, and used by the erf-snap in
-- /api/cadastre/snap to move pins onto their real parcel centroids.

create extension if not exists postgis;

create table cadastral_parcel (
  prcl_key      text primary key,
  parcel_no     text,
  tag_value     text,               -- the "erf N" label CSG prints on the parcel
  maj_region    text,               -- uppercase town: KNYSNA, SEDGEFIELD, PLETT...
  min_region    text,               -- suburb / township within the town
  province      text,
  geom          geometry(MultiPolygon, 4326) not null,
  centroid      geography(Point, 4326),
  imported_at   timestamptz not null default now()
);

create index idx_cadastral_parcel_geom      on cadastral_parcel using gist (geom);
create index idx_cadastral_parcel_maj       on cadastral_parcel(maj_region);
create index idx_cadastral_parcel_centroid  on cadastral_parcel using gist (centroid);

comment on table cadastral_parcel is
  'One row per SA erf from the CSG cadastre. Populated by /api/cadastre/import (paged); served as vector tiles via parcel_mvt.';

-- ---------------------------------------------------------------------------
-- Vector-tile renderer. Returns a Mapbox Vector Tile as bytea for the
-- given z/x/y. Only meaningful at z ≥ 14 — the tile route returns 204
-- below that so we never scan the whole extent for a country-wide zoom.
-- ---------------------------------------------------------------------------
create or replace function parcel_mvt(z int, x int, y int)
returns bytea
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  mvt bytea;
begin
  select ST_AsMVT(q, 'parcels', 4096, 'geom')
  into mvt
  from (
    select
      prcl_key,
      tag_value,
      maj_region,
      min_region,
      ST_AsMVTGeom(
        ST_Transform(geom, 3857),
        ST_TileEnvelope(z, x, y),
        4096,
        64,
        true
      ) as geom
    from cadastral_parcel
    where geom && ST_Transform(ST_TileEnvelope(z, x, y), 4326)
  ) q
  where q.geom is not null;
  return mvt;
end;
$$;

comment on function parcel_mvt(int, int, int) is
  'MVT renderer for the Erf boundaries layer. Called by /api/tiles/parcels/[z]/[x]/[y]; the route caps requests at z ≥ 14.';

-- RLS: staff read parcels. Only the service role (bypasses RLS) writes.
alter table cadastral_parcel enable row level security;
create policy "parcel staff read" on cadastral_parcel for select using (is_staff());
