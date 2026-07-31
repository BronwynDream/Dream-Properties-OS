-- ============================================================================
-- Dream Knysna OS — 0063 no snap-to-parcel for sectional-title listings
-- ----------------------------------------------------------------------------
-- Bug spotted 2026-07-31: a 3-bed apartment at Mount Joy, Knysna Central lit
-- up the ENTIRE Highfields estate parcel as "for sale" on the map. Cause:
-- the sectional-title unit's JSON-LD coord fell inside the estate's single
-- parent parcel; the snap trigger from 0045 grabbed that parcel; the for-sale
-- polygon layer then painted the whole ~5-hectare estate as if the apartment
-- were the whole thing.
--
-- Freehold houses have a 1:1 relationship with a cadastral parcel and snap
-- correctly. Sectional-title schemes (apartments, flats, townhouses, duplexes)
-- have many units per parcel and should NOT snap — they stay as HTML pin
-- markers, a small point instead of a large highlighted polygon.
--
-- Two code paths update prcl_key on external_listing:
--   1. The BEFORE-INSERT-OR-UPDATE trigger from 0045 (per-row on lat/lng
--      change).
--   2. The snap_all_to_parcels() RPC from 0029 (bulk backfill).
-- Both are patched. Detection is on property_type via case-insensitive regex.
--
-- Note on coord side-effect: snap_all_to_parcels() ALSO rewrites lat/lng to
-- the containing parcel's centroid. For sectional-title rows already snapped
-- before this migration, that means the historical coord is now the estate
-- centroid, not the JSON-LD point. Nulling prcl_key here doesn't restore
-- the original — the pin will sit at the (approximate) centroid until the
-- next regeocode-jsonld drain replaces it with a fresh JSON-LD coord. Admin
-- should trigger a drain after applying this migration.
-- ============================================================================

create or replace function set_external_listing_prcl_key()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Sectional-title-style listings share a parent parcel with the whole
  -- scheme; snapping them highlights the whole estate. Keep as pins.
  if new.property_type is not null
     and new.property_type ~* '(apartment|flat|sectional|townhouse|duplex|penthouse)' then
    return new;
  end if;

  if new.lat is not null and new.lng is not null and new.prcl_key is null then
    select cp.prcl_key
      into new.prcl_key
      from cadastral_parcel cp
     where ST_Contains(cp.geom, ST_SetSRID(ST_MakePoint(new.lng::float8, new.lat::float8), 4326))
     order by ST_Area(cp.geom) asc
     limit 1;
  end if;
  return new;
end;
$$;

comment on function set_external_listing_prcl_key is
  'Snaps external_listing rows to their containing cadastral_parcel. Skips sectional-title / apartment / flat / townhouse / duplex property types (2026-07-31): those units share a parent parcel with the whole scheme, so highlighting the parent parcel as "for sale" misleads. Freehold snaps as before.';

-- Rewrite snap_all_to_parcels() to apply the same exclusion in its
-- external_listing bulk branch. Properties (Dream's own OS records) are
-- always freehold in Bronwyn's model so no change to that branch.
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
  -- Properties (unchanged)
  with candidate as (
    select
      p.id                                              as pid,
      cp.prcl_key,
      ST_X(ST_Centroid(cp.geom))::float8                as clng,
      ST_Y(ST_Centroid(cp.geom))::float8                as clat,
      row_number() over (
        partition by p.id
        order by ST_Area(cp.geom) asc
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
    prcl_key = picked.prcl_key
  from picked
  where p.id = picked.pid;
  get diagnostics props_n = row_count;

  -- External listings — skip sectional-title-style types.
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
      and (
        el.property_type is null
        or el.property_type !~* '(apartment|flat|sectional|townhouse|duplex|penthouse)'
      )
  ),
  picked as (select * from candidate where rn = 1)
  update external_listing el set
    lng             = picked.clng,
    lat             = picked.clat,
    prcl_key = picked.prcl_key
  from picked
  where el.id = picked.eid;
  get diagnostics list_n = row_count;

  return query select props_n, list_n;
end;
$$;

comment on function snap_all_to_parcels() is
  'Bulk erf-snap. Called by /api/cadastre/snap after an import completes; also safe to run any time. Respects geo_manual=true; skips sectional-title external_listing types (2026-07-31).';

-- Backfill: null prcl_key on existing sectional-title rows so they stop
-- painting parent-parcel polygons. Coords remain as they are (may be the
-- estate centroid from the earlier snap — a drain of the regeocode-jsonld
-- queue will replace with precise JSON-LD coords).
update external_listing
   set prcl_key = null
 where prcl_key is not null
   and property_type is not null
   and property_type ~* '(apartment|flat|sectional|townhouse|duplex|penthouse)';
