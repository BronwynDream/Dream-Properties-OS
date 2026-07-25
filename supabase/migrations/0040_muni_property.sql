-- ============================================================================
-- Dream Knysna OS — 0040 muni_property (Knysna Municipality local mirror)
-- ----------------------------------------------------------------------------
-- Consolidates the useful, non-PII columns from three Knysna Muni ArcGIS
-- layers into one queryable table keyed by SG21 code:
--   - Property_Ownership_Deeds_Test/57  Finance System (street, zoning, ward)
--   - Property_Ownership_Deeds_Test/58  Valuation Roll (suburb, valuation, tariff)
--   - Property_Ownership_Deeds_Test/56  Ownership Deeds (extent, title deed, sect scheme, purchase history)
--
-- Populated by /api/muni/import — pages through each layer, upserts on
-- sg_number. Safe to re-run; new data overwrites, deleted muni records
-- would linger (we could add an active flag later).
--
-- Owner names, ID numbers, phone, email are DELIBERATELY NEVER stored.
-- The importer's outFields is an allow-list.
-- ============================================================================

create table if not exists muni_property (
  sg_number                text primary key,          -- SG21 code, joins to cadastral_parcel.tag_value via numeric parse
  erf_number               text,                      -- parsed short number (e.g. "4497")
  muni_erf_code            text,                      -- raw ErfNo from Finance (e.g. "104497000")

  -- Address (from Finance System)
  street_no                text,
  street_name              text,
  suburb_hint              text,                      -- packed suffix from PhysicalSt ("BELVIDERE HEIG")

  -- Suburb + valuation (from Valuation Roll)
  suburb                   text,                      -- structured suburb
  tariff                   text,
  area_sqm_valroll         integer,
  muni_valuation           numeric(14,2),

  -- Property attributes (from Finance)
  zoning                   text,
  ward_no                  text,
  sectional_title_flag     text,
  usage_                   text,
  prop_description         text,

  -- Deed / transaction (from Ownership Deeds)
  town_name                text,
  extent_sqm               integer,
  property_type            text,
  sect_scheme_name         text,
  sect_scheme_unit         integer,
  title_deed_no            text,
  old_title_deed_no        text,
  deeds_office             text,
  purch_date               date,
  registration_date        date,
  purch_price              numeric(14,2),
  bond_number              text,
  bond_amount              numeric(14,2),
  bond_institution         text,

  imported_at              timestamptz not null default now(),
  refreshed_at             timestamptz not null default now()
);

create index if not exists idx_muni_property_erf_number  on muni_property(erf_number);
create index if not exists idx_muni_property_suburb      on muni_property(suburb);
create index if not exists idx_muni_property_street_name on muni_property using gin (street_name gin_trgm_ops);
create index if not exists idx_muni_property_street_no   on muni_property(street_no);

-- RLS: staff read the muni mirror. Only the service role (bypasses RLS)
-- writes — driven by /api/muni/import. Same pattern as cadastral_parcel.
alter table muni_property enable row level security;
drop policy if exists "muni_property staff read" on muni_property;
create policy "muni_property staff read" on muni_property
  for select using (is_staff());

comment on table muni_property is
  'Local mirror of the Knysna Municipality public rateable-property database. Joins Finance System (57) + Valuation Roll (58) + Ownership Deeds (56) via SG21. Owner PII is deliberately excluded — importer allow-lists fields. Refreshed by /api/muni/import.';

-- ---------------------------------------------------------------------------
-- Reverse-lookup: given a lat/lng, find the muni row by joining through the
-- cadastre. Point → cadastral_parcel (ST_Contains) → muni_property (SG21).
-- Handles multi-parcel cases by returning the smallest containing parcel.
-- ---------------------------------------------------------------------------
create or replace function muni_lookup_at_point(p_lng float8, p_lat float8)
returns table (
  sg_number text, erf_number text,
  street_no text, street_name text, suburb text,
  muni_valuation numeric, zoning text, extent_sqm integer,
  title_deed_no text, property_type text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with hit as (
    select cp.tag_value, cp.prcl_key
    from cadastral_parcel cp
    where ST_Contains(cp.geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
    order by ST_Area(cp.geom) asc
    limit 1
  ),
  matched as (
    -- Join by parsing the numeric part of the muni's sg_number against the
    -- cadastre's tag_value. Both should be simple integers for a match.
    select m.*
    from hit
    join muni_property m
      on regexp_replace(coalesce(m.sg_number, ''), '[^0-9]', '', 'g') like ('%' || regexp_replace(coalesce(hit.tag_value, ''), '[^0-9]', '', 'g') || '%')
    limit 1
  )
  select sg_number, erf_number, street_no, street_name, suburb,
         muni_valuation, zoning, extent_sqm, title_deed_no, property_type
  from matched
$$;
