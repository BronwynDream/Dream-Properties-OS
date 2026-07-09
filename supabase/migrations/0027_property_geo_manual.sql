-- Dream Knysna OS — 0027 property.geo_manual
-- One boolean column that marks a pin as "moved by an admin". The map's
-- Adjust-pin control sets this to true; every automated geocoder must
-- SKIP rows where it is true so the admin's placement is never clobbered.
--
-- Affected paths:
--   - app/map/actions.ts geocodeMissingProperties() adds .eq("geo_manual", false)
--   - future Lightstone re-geocode + any batch cleanup pass MUST do the same
--
-- Additive change only. Defaulting to false means existing rows behave
-- exactly as before until an admin drags a pin.

alter table property
  add column if not exists geo_manual boolean not null default false;

comment on column property.geo_manual is
  'True when an admin has hand-placed the pin on /map. Automated geocoders (Mapbox forward-geocode, future Lightstone re-geocode) must skip rows where this is true.';
