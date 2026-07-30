-- ERF centroid lookup — small RPC used by the market-listing intake to
-- resolve "erf 4497" → (lng, lat). Extracts via ST_X/ST_Y so we don't
-- have to worry about Supabase JS's inconsistent geography deserialisation
-- (sometimes GeoJSON, sometimes WKB hex).
--
-- Restricted to KNYSNA maj_region — the cadastre also has Sedgefield /
-- Plett rows and we don't want a cross-town collision on a shared erf
-- number (which happens more than you'd think).

create or replace function erf_centroid_lookup(p_erf_number text)
returns table (prcl_key text, lng double precision, lat double precision)
language sql
stable
as $$
  select
    cp.prcl_key,
    st_x(cp.centroid::geometry)::double precision as lng,
    st_y(cp.centroid::geometry)::double precision as lat
  from cadastral_parcel cp
  where cp.tag_value = 'erf ' || p_erf_number
    and cp.maj_region = 'KNYSNA'
  limit 1;
$$;

comment on function erf_centroid_lookup(text) is
  'Address-to-ERF pipeline: given a short erf number ("4497"), return the parcel key + centroid coords for map pinning. Knysna-scoped.';
