-- ============================================================================
-- Dream Knysna OS — 0039 erf-centroid auto-positioning
-- ----------------------------------------------------------------------------
-- Mapbox falls back to street-level when geocoding small-town SA addresses.
-- Two neighbours ("12 Eagles Way" and "15 Eagles Way") often collapse onto
-- the same coordinate, making map pins overlap.
--
-- The existing snap_all_to_parcels() only helps if a coord already sits
-- INSIDE the correct parcel (ST_Contains); when both neighbours share the
-- same wrong coord, they snap to the same centroid. No improvement.
--
-- New approach: snap by the property's assigned erf number, joining
-- cadastral_parcel by numeric-only comparison of tag_value ↔ erf_number.
-- For multi-erf properties (169 Links = 1602 + 1603), take the centroid
-- of the union of all matching parcels. Restrict to Knysna area (all of
-- Dream's stock) so the same erf number in a different town doesn't
-- silently pull a pin off to Cape Town.
--
-- Also adds a trigger on the erf table so newly extracted erf numbers
-- auto-position their parent property the moment they're committed.
-- ============================================================================

-- Utility: strip everything but digits. "Erf 1602" → "1602", "1602/A" → "1602".
create or replace function _digits_only(t text)
returns text
language sql
immutable
strict
as $$
  select nullif(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '')
$$;

-- Snap ONE property. Called from the after-insert trigger on erf so a new
-- erf number auto-positions its property. Respects geo_manual — a hand-placed
-- pin is authoritative and this never overwrites it.
create or replace function snap_property_by_erf(p_property_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_manual boolean;
  v_geom_center geography(Point, 4326);
  v_first_prcl_key text;
begin
  select geo_manual into v_manual from property where id = p_property_id;
  if v_manual then return false; end if;

  -- Union all cadastral parcels whose tag_value matches ANY of this
  -- property's erf numbers (digits-only comparison). Restrict to Knysna.
  select
    ST_Centroid(ST_Union(cp.geom))::geography,
    -- Pick the smallest-area matching parcel to store as the prcl_key
    -- foreign-key reference; the centroid is still the union centroid.
    (
      select cp2.prcl_key
      from cadastral_parcel cp2
      join erf e2 on _digits_only(e2.erf_number) = _digits_only(cp2.tag_value)
      where e2.property_id = p_property_id
        and cp2.maj_region ilike '%KNYSNA%'
      order by ST_Area(cp2.geom) asc
      limit 1
    )
  into v_geom_center, v_first_prcl_key
  from cadastral_parcel cp
  join erf e on _digits_only(e.erf_number) = _digits_only(cp.tag_value)
  where e.property_id = p_property_id
    and cp.maj_region ilike '%KNYSNA%';

  if v_geom_center is null then
    return false;
  end if;

  update property set
    lng      = ST_X(v_geom_center::geometry),
    lat      = ST_Y(v_geom_center::geometry),
    prcl_key = coalesce(v_first_prcl_key, prcl_key)
  where id = p_property_id
    and geo_manual = false;

  return true;
end;
$$;

grant execute on function snap_property_by_erf(uuid) to authenticated;
grant execute on function snap_property_by_erf(uuid) to service_role;

-- Bulk equivalent — for admin-triggered "snap everything now" reruns.
create or replace function snap_all_properties_by_erf()
returns table(snapped int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int := 0;
  r record;
begin
  for r in
    select distinct p.id
    from property p
    join erf e on e.property_id = p.id
    where p.geo_manual = false
  loop
    if snap_property_by_erf(r.id) then
      n := n + 1;
    end if;
  end loop;
  return query select n;
end;
$$;

grant execute on function snap_all_properties_by_erf() to authenticated;
grant execute on function snap_all_properties_by_erf() to service_role;

-- Trigger: whenever a new erf row is inserted, snap its parent property.
-- Fires from commit_batch's `insert into erf` calls, so pins land at the
-- right spot as soon as an extracted erf number hits the DB.
create or replace function _trigger_snap_erf_property()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform snap_property_by_erf(new.property_id);
  return new;
end;
$$;

drop trigger if exists trg_erf_snap_property on erf;
create trigger trg_erf_snap_property
  after insert on erf
  for each row execute function _trigger_snap_erf_property();
