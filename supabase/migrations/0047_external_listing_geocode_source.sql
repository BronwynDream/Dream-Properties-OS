-- Dream Knysna OS — 0047 external_listing.geocode_source
--
-- Adds a discriminator so the dedup clusterer can tell an exact Mapbox
-- geocode apart from a suburb/estate centroid fallback. Without it, every
-- listing whose specific address failed to geocode gets pinned at (say)
-- Leisure Isle's centroid, and the 20m proximity rule then unions them
-- all into one dedup_group so the "also listed on" panel shows R895k,
-- R60M, and R19.9M as if they were the same property.
--
-- Values:
--   exact    — Mapbox forward-geocode succeeded inside the Garden Route bbox
--   centroid — Mapbox failed / drifted out-of-bbox; centroidForArea() landed
--              the pin at a shared area centroid (see geocode.ts)
--
-- The dedup logic (lib/external-listings/dedup.ts) excludes 'centroid' rows
-- from the geo-proximity cluster rule. They still cluster on lightstone id /
-- prcl_key / normalised address, which are all address-level signals rather
-- than coordinate-level.
--
-- Applied as separate ALTERs so each step parses independently — an inline
-- NOT NULL + DEFAULT + CHECK on ADD COLUMN tripped Supabase's SQL Editor
-- with a "syntax error at or near add" on first run. Broken up here so it
-- stays reliably re-runnable.

alter table external_listing
  add column geocode_source text default 'exact';

alter table external_listing
  alter column geocode_source set not null;

alter table external_listing
  add constraint external_listing_geocode_source_check
  check (geocode_source in ('exact', 'centroid'));

comment on column external_listing.geocode_source is
  'How lat/lng was derived: exact (Mapbox forward geocode + bbox-guarded) or centroid (fell back to a suburb/estate centroid because the specific address could not be resolved). Centroid rows are excluded from the geo-proximity dedup rule to prevent unrelated listings colliding on the same fallback pixel.';

-- Backfill existing rows. The centroids below are copied verbatim from
-- lib/external-listings/geocode.ts (GARDEN_ROUTE_CENTROIDS). Any external
-- listing whose (lng, lat) currently equals one of these was set by the
-- centroid fallback path; mark it accordingly so the clusterer stops
-- over-matching on next dedup run.
update external_listing set geocode_source = 'centroid' where
  (lng, lat) in (
    (23.0479, -34.0363),  -- Knysna
    (23.0725, -34.049),   -- Leisure Isle
    (23.081,  -34.081),   -- The Heads
    (22.976,  -34.030),   -- Belvidere
    (23.0227, -34.080),   -- Brenton on Sea / Brenton
    (23.108,  -34.070),   -- Pezula / Pezula Private Estate
    (23.040,  -33.982),   -- Simola
    (23.043,  -34.048),   -- Thesen Islands / Thesen
    (22.986,  -34.008),   -- Eastford Glen / Eastford
    (22.995,  -34.018),   -- Centreville
    (22.810,  -34.025),   -- Sedgefield
    (23.376,  -34.053),   -- Plettenberg Bay / Plett
    (22.460,  -33.963),   -- George
    (22.580,  -33.990)    -- Wilderness
  );
