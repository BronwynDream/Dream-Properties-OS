-- Dream Knysna OS — 0021 lightstone_property_id
-- Captured at take-on via Property Search (lspsearch/v1/address). It's the
-- numeric key the Lightstone Data API takes as {id} on every facet endpoint
-- (/property/{id}/address, /owners, /legal, /land, /avm, /comparables), so
-- storing it here lets subsequent Fetch-from-Lightstone calls hit the Data
-- API directly instead of re-resolving from address text.
--
-- Nullable: properties taken on before this column existed have none, and
-- properties committed from the migration triage may not have gone through
-- an address-search step. The live adapter falls back to erf/deed/address
-- when this is null.
--
-- lng/lat already exist (0015_map_coords). No further column changes needed
-- for the address-search / structured-field coalesce path.

alter table property
  add column if not exists lightstone_property_id bigint;

comment on column property.lightstone_property_id is
  'Lightstone Defined Property Layer id — captured at take-on via Property Search, used as the join key for Property Data facet calls.';

create index if not exists idx_property_lightstone_pid
  on property(lightstone_property_id)
  where lightstone_property_id is not null;
