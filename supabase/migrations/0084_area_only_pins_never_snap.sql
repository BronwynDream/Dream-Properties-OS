-- Dream Knysna OS — 0084 area-only pins never snap to an erf (2026-10-17)
--
-- A listing we can only place by suburb or estate (geocode_source =
-- 'centroid') sits on the area's centre point. The erf-snap trigger then
-- bound it to whatever erf happened to contain that point, so the map
-- highlighted a stranger's erf on hover and the dedup clusterer could
-- merge unrelated listings that "shared" it.
--
-- Third exclusion added to the trigger and to the bulk snap; existing
-- snaps on area-only rows are cleared (hand-placed rows are left alone).

create or replace function set_external_listing_prcl_key()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Exclusion A (0063): sectional-title-style listings.
  if new.property_type is not null
     and new.property_type ~* '(apartment|flat|sectional|townhouse|duplex|penthouse)' then
    return new;
  end if;

  -- Exclusion C (0084): area-only pins are not on any particular erf.
  if new.geocode_source = 'centroid' then
    return new;
  end if;

  if new.lat is not null and new.lng is not null and new.prcl_key is null then
    -- Exclusion B (0064): skip parcels > 1 ha (parent-of-scheme parcels).
    select cp.prcl_key
      into new.prcl_key
      from cadastral_parcel cp
     where ST_Contains(cp.geom, ST_SetSRID(ST_MakePoint(new.lng::float8, new.lat::float8), 4326))
       and ST_Area(cp.geom::geography) <= 10000
     order by ST_Area(cp.geom) asc
     limit 1;
  end if;
  return new;
end;
$$;

comment on function set_external_listing_prcl_key is
  'Snaps external_listing rows to their containing cadastral_parcel. Skips (a) sectional-title / apartment / flat / townhouse / duplex / penthouse property types (0063), (b) parcels > 10,000 m² (0064) and (c) area-only pins, geocode_source = centroid (0084).';

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
  with candidate as (
    select
      p.id                                              as pid,
      cp.prcl_key,
      ST_X(ST_Centroid(cp.geom))::float8                as clng,
      ST_Y(ST_Centroid(cp.geom))::float8                as clat,
      row_number() over (partition by p.id order by ST_Area(cp.geom) asc) as rn
    from property p
    join cadastral_parcel cp
      on ST_Contains(cp.geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326))
    where p.lng is not null
      and p.lat is not null
      and p.geo_manual = false
  ),
  picked as (select * from candidate where rn = 1)
  update property p set
    lng      = picked.clng,
    lat      = picked.clat,
    prcl_key = picked.prcl_key
  from picked
  where p.id = picked.pid;
  get diagnostics props_n = row_count;

  with candidate as (
    select
      el.id                                             as eid,
      cp.prcl_key,
      ST_X(ST_Centroid(cp.geom))::float8                as clng,
      ST_Y(ST_Centroid(cp.geom))::float8                as clat,
      row_number() over (partition by el.id order by ST_Area(cp.geom) asc) as rn
    from external_listing el
    join cadastral_parcel cp
      on ST_Contains(cp.geom, ST_SetSRID(ST_MakePoint(el.lng, el.lat), 4326))
    where el.lng is not null
      and el.lat is not null
      and el.active
      and el.geo_manual = false
      and el.geocode_source <> 'centroid'
      and (
        el.property_type is null
        or el.property_type !~* '(apartment|flat|sectional|townhouse|duplex|penthouse)'
      )
      and ST_Area(cp.geom::geography) <= 10000
  ),
  picked as (select * from candidate where rn = 1)
  update external_listing el set
    lng      = picked.clng,
    lat      = picked.clat,
    prcl_key = picked.prcl_key
  from picked
  where el.id = picked.eid;
  get diagnostics list_n = row_count;

  return query select props_n, list_n;
end;
$$;

comment on function snap_all_to_parcels() is
  'Bulk erf-snap. Respects geo_manual=true; for external_listing skips sectional-title types (0063), parcels > 10,000 m² (0064) and area-only pins (0084).';

update external_listing
   set prcl_key = null
 where geocode_source = 'centroid'
   and prcl_key is not null
   and geo_manual = false;
