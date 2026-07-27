-- ============================================================================
-- Dream Knysna OS — 0045 external_listing prcl_key auto-snap
-- ----------------------------------------------------------------------------
-- external_listing.prcl_key was added in 0029 but never populated for scraped
-- rows. Plan 005 uses prcl_key to render for-sale properties as coloured
-- cadastre polygons on /map. This migration:
--   1. Adds a BEFORE INSERT OR UPDATE trigger that snaps each row's lat/lng
--      into the smallest containing cadastral_parcel via ST_Contains, and
--      sets prcl_key. Only runs when lat/lng change AND prcl_key is currently
--      null (respects manual assignments).
--   2. Backfills existing rows in one pass.
-- ============================================================================

create or replace function set_external_listing_prcl_key()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
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

drop trigger if exists trg_external_listing_set_prcl_key on external_listing;
create trigger trg_external_listing_set_prcl_key
  before insert or update of lat, lng on external_listing
  for each row execute function set_external_listing_prcl_key();

comment on function set_external_listing_prcl_key is
  'Snaps external_listing rows to their containing cadastral_parcel via ST_Contains(centroid). Runs on insert/update of lat|lng when prcl_key is null. Idempotent; a manually-assigned prcl_key is never overwritten.';

-- One-shot backfill for rows already in the table with coords but no prcl_key.
-- Safe to re-run; the where-clause skips already-assigned rows.
update external_listing el
   set prcl_key = (
     select cp.prcl_key
       from cadastral_parcel cp
      where ST_Contains(cp.geom, ST_SetSRID(ST_MakePoint(el.lng::float8, el.lat::float8), 4326))
      order by ST_Area(cp.geom) asc
      limit 1
   )
 where el.prcl_key is null
   and el.lat is not null
   and el.lng is not null;
