-- ============================================================================
-- Dream Knysna OS — 0015 map coords: lng/lat cache on property
-- ----------------------------------------------------------------------------
-- The map screen needs to plot pins, but property.geom (geography(Point, 4326))
-- can't be read back through PostgREST without a helper. Rather than add an
-- RPC just to unpack the geometry, we cache lng/lat as plain numerics alongside
-- geom. The geocoder writes both so PostGIS spatial queries still work.
-- ============================================================================

alter table property
  add column if not exists lng numeric(9, 6),
  add column if not exists lat numeric(8, 6);

comment on column property.lng is 'longitude in WGS84, cached from geom for fast PostgREST read';
comment on column property.lat is 'latitude in WGS84, cached from geom for fast PostgREST read';
