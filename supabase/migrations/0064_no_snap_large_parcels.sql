-- ============================================================================
-- Dream Knysna OS — 0064 no snap-to-parcel when containing parcel > 1 ha
-- ----------------------------------------------------------------------------
-- 0063 stopped snapping SECTIONAL-TITLE listings (apartment / flat /
-- townhouse / duplex / penthouse). It didn't help the second symptom of the
-- same underlying data problem: at Pezula, eight unrelated plots from eight
-- different agencies (prices R2.1M through R29.95M) all snapped to the same
-- estate parent parcel, got the same prcl_key, and the dedup ladder
-- collapsed them into ONE pin because prcl_key equality outranks
-- price-similarity in the match order.
--
-- Root cause: individual plots at Pezula (and Belvidere, Thesen Islands,
-- Highfields, etc.) aren't in the cadastre. Only the estate parent parcel
-- is. Every "Vacant Land / Plot for Sale in Pezula" listing snapped to
-- that parcel.
--
-- Rule: don't snap when the containing parcel is > 10,000 m² (1 ha).
-- Almost every parcel that size is a parent-of-scheme, a shared farm
-- parcel, or common ground. Genuine single-family plots in Knysna are
-- 500-3,000 m².
--
-- Trade-off: a legit ≥1 ha farm listing renders as a pin instead of a
-- highlighted polygon. Still on the map, still clickable, just no erf
-- outline. Acceptable — the false-positive of painting an entire estate
-- as "for sale" is much worse than the false-negative of not outlining
-- a legitimate farm parcel.
--
-- Applied in both snap paths (the per-row trigger from 0045+0063 and the
-- bulk snap_all_to_parcels() RPC from 0029+0063). Backfill nulls
-- prcl_key on rows currently snapped to a parcel > 1 ha.
--
-- ST_Area(cp.geom::geography) returns m² regardless of the underlying CRS
-- (geom is WGS84 / SRID 4326).
--
-- Note on coord side-effect: rows already snapped had their lat/lng
-- rewritten to the parcel centroid by snap_all_to_parcels(). Nulling
-- prcl_key doesn't restore the original — the pin sits at (approximate)
-- centroid until the next regeocode-jsonld drain replaces it with a
-- fresh JSON-LD coord. Admin should trigger a drain after applying this
-- migration.
-- ============================================================================

create or replace function set_external_listing_prcl_key()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Exclusion A (from 0063): sectional-title-style listings.
  if new.property_type is not null
     and new.property_type ~* '(apartment|flat|sectional|townhouse|duplex|penthouse)' then
    return new;
  end if;

  if new.lat is not null and new.lng is not null and new.prcl_key is null then
    -- Exclusion B (new in 0064): skip if the smallest containing parcel is
    -- > 1 ha. Applied in the WHERE clause so we simply find nothing worth
    -- snapping to.
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
  'Snaps external_listing rows to their containing cadastral_parcel. Skips (a) sectional-title / apartment / flat / townhouse / duplex / penthouse property types (0063) and (b) parcels > 10,000 m² which are almost always parent-of-scheme parcels not individual plots (0064).';

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
  -- Properties (unchanged — Dream's own OS records are curated freehold).
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

  -- External listings — both exclusions apply.
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
      and ST_Area(cp.geom::geography) <= 10000
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
  'Bulk erf-snap. Respects geo_manual=true; for external_listing skips sectional-title types (0063) AND parcels > 10,000 m² (0064).';

-- Backfill: null prcl_key on rows currently snapped to a parcel > 1 ha.
-- The sectional-title backfill already ran in 0063; this catches the
-- second symptom (Pezula-style parent-parcel snaps).
update external_listing el
   set prcl_key = null
 where el.prcl_key is not null
   and exists (
     select 1
       from cadastral_parcel cp
      where cp.prcl_key = el.prcl_key
        and ST_Area(cp.geom::geography) > 10000
   );
