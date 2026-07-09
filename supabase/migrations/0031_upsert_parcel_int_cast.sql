-- Dream Knysna OS — 0031 upsert_parcel int cast for parcel_no
--
-- cadastral_parcel.parcel_no is declared as `integer` in the applied
-- schema, but upsert_parcel(...) declares p_parcel_no as text and inserts
-- it without a cast. Every row rejects with:
--   ERROR: column "parcel_no" is of type integer but expression is of
--          type text
--
-- Rewrite the function so the parameter type is unchanged (keeps the
-- PostgREST signature stable; the caller keeps passing null / a numeric
-- string) but the insert casts explicitly. nullif('', ...) treats the
-- empty string as null so a callers passing "" doesn't hit
-- "invalid input syntax for integer".

create or replace function upsert_parcel(
  p_prcl_key    text,
  p_parcel_no   text,
  p_tag_value   text,
  p_maj_region  text,
  p_min_region  text,
  p_province    text,
  p_geom_json   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g geometry;
begin
  g := ST_SetSRID(ST_GeomFromGeoJSON(p_geom_json), 4326);
  if g is null then return; end if;
  if GeometryType(g) not in ('POLYGON', 'MULTIPOLYGON') then return; end if;

  insert into cadastral_parcel (
    prcl_key, parcel_no, tag_value, maj_region, min_region, province, geom, centroid, imported_at
  ) values (
    p_prcl_key,
    nullif(p_parcel_no, '')::int,   -- text → int; null / '' both become null
    p_tag_value,
    p_maj_region,
    p_min_region,
    p_province,
    ST_Multi(g),
    ST_Centroid(g)::geography,
    now()
  )
  on conflict (prcl_key) do update set
    parcel_no   = excluded.parcel_no,
    tag_value   = excluded.tag_value,
    maj_region  = excluded.maj_region,
    min_region  = excluded.min_region,
    province    = excluded.province,
    geom        = excluded.geom,
    centroid    = excluded.centroid,
    imported_at = now();
end;
$$;
