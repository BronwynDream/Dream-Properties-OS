-- ============================================================================
-- Dream Knysna OS — 0063 no snap-to-parcel for sectional-title + big parcels
-- ----------------------------------------------------------------------------
-- Two bugs spotted 2026-07-31 with the for-sale polygon overlay on /map, both
-- rooted in over-eager snap-to-parcel:
--
-- 1. A 3-bed apartment at Mount Joy, Knysna Central lit up the ENTIRE
--    Highfields estate parcel as "for sale". The unit's coord fell inside
--    the estate's single parent parcel; the snap trigger from 0045 grabbed
--    that parcel; the for-sale layer painted the whole ~5-hectare estate.
--
-- 2. Eight unrelated Pezula plots from eight different agencies (prices
--    R2.1M through R29.95M) merged into ONE pin covering the entire Pezula
--    Private Estate parcel. Same root cause: individual plots aren't in the
--    cadastre; only the estate parent parcel is. Every plot snapped to it,
--    got the same prcl_key, and the dedup ladder collapsed them because
--    prcl_key equality outranks price-similarity.
--
-- Rule: snap to a parcel only when the parcel plausibly represents a single
-- property. Two exclusions:
--   A. Property type is sectional-title (apartment / flat / townhouse /
--      duplex / penthouse) — the row is one unit of a scheme sharing a
--      parcel with many others.
--   B. Containing parcel is > 10,000 m² (1 ha) — almost certainly a parent
--      estate parcel (Pezula, Belvidere, Thesen Islands, Highfields), a
--      farm shared by many listings, or an undivided common ground. In
--      Knysna a genuine single-family plot is typically 500-3,000 m². We
--      trade off: a legit ≥1 ha farm listing renders as a pin instead of
--      a polygon (still on the map, still clickable, just no highlighted
--      erf outline).
--
-- Both exclusions are applied in both snap paths (the per-row trigger from
-- 0045 and the bulk snap_all_to_parcels() RPC from 0029). Backfill nulls
-- prcl_key on any existing row hit by either exclusion.
--
-- Note on coord side-effect: snap_all_to_parcels() ALSO rewrites lat/lng
-- to the containing parcel's centroid. Rows snapped before this migration
-- have their coord at the estate centroid, not the JSON-LD point. Nulling
-- prcl_key doesn't restore the original — the pin sits at (approximate)
-- centroid until the next regeocode-jsonld drain replaces it with a fresh
-- JSON-LD coord. Admin should trigger a drain after applying this
-- migration.
-- ============================================================================

create or replace function set_external_listing_prcl_key()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Exclusion A: sectional-title-style listings.
  if new.property_type is not null
     and new.property_type ~* '(apartment|flat|sectional|townhouse|duplex|penthouse)' then
    return new;
  end if;

  if new.lat is not null and new.lng is not null and new.prcl_key is null then
    -- Exclusion B: skip if the smallest containing parcel is > 1 ha. Applied
    -- in the WHERE clause so we simply find nothing worth snapping to (the
    -- parcel_area cast to geography returns m² on WGS84 geometries).
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
  'Snaps external_listing rows to their containing cadastral_parcel. Skips (a) sectional-title / apartment / flat / townhouse / duplex / penthouse property types and (b) parcels > 10,000 m² (1 ha) which are almost always parent-of-scheme parcels not individual plots. 2026-07-31.';

-- Rewrite snap_all_to_parcels() to apply both exclusions in its
-- external_listing bulk branch. Properties (Dream's own OS records) are
-- always freehold in Bronwyn's model so the property branch keeps snapping
-- to whatever contains it — those records are hand-curated and won't
-- accidentally land inside an estate parcel.
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

  -- External listings — apply both exclusions.
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
  'Bulk erf-snap. Called by /api/cadastre/snap after an import completes; also safe to run any time. Respects geo_manual=true; for external_listing skips sectional-title types AND parcels > 10,000 m² (2026-07-31).';

-- Backfill: null prcl_key on rows hit by either exclusion.
-- Exclusion A (property_type regex) and Exclusion B (parcel > 1 ha).
update external_listing el
   set prcl_key = null
 where el.prcl_key is not null
   and (
     (el.property_type is not null
        and el.property_type ~* '(apartment|flat|sectional|townhouse|duplex|penthouse)')
     or exists (
       select 1
         from cadastral_parcel cp
        where cp.prcl_key = el.prcl_key
          and ST_Area(cp.geom::geography) > 10000
     )
   );
