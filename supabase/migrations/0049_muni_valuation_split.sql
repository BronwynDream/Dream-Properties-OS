-- Dream Knysna OS — 0049 muni_valuation split
--
-- Bug found 2026-07-27: the current schema keeps `muni_valuation, tariff,
-- area_sqm_valroll` as columns on muni_property with sg_number as PK. But
-- Knysna Muni's Valuation Roll (layer 58 on the ArcGIS FeatureServer) is
-- inherently 1:many per SG21 — a single erf can be rated under multiple
-- tariff categories (e.g. Erf 1453 at 9 Horizon Street The Heads has two
-- rows: "8009-RESIDENTIAL" @ R4M and "8030-Residential B&B 1-8 Rooms"
-- @ R2.1M, total R6.1M). The import's upsert-on-sg_number silently drops
-- all but one, so we were showing R4M when the real muni valuation is R6.1M.
--
-- Fix: split per-tariff valuations into a separate table. muni_property
-- stays 1-per-SG for identity + deed data. muni_valuation is N-per-SG for
-- rateable categories. Reads sum across the child rows for the headline
-- valuation, and the breakdown is visible in the Erf Lookup detail panel.
--
-- The refactor also positions us for a future switch to ingesting a
-- digital Valuation Roll file direct from Knysna Muni (would just be a
-- new import adapter targeting muni_valuation).

-- ---------------------------------------------------------------------------
-- 1. New table for per-tariff valuations
-- ---------------------------------------------------------------------------
create table muni_valuation (
  id           uuid primary key default gen_random_uuid(),
  -- FK to muni_property lets PostgREST auto-embed on read
  -- (`select ..., valuations:muni_valuation(...)`) and guarantees no orphan
  -- valuation rows if a muni_property row is ever deleted.
  sg_number    text not null references muni_property(sg_number) on delete cascade,
  -- Tariff can arrive as null from some feeds (Finance system layer doesn't
  -- carry it), so default to a sentinel so the uniqueness constraint below
  -- treats "no tariff" as a distinct slot rather than allowing arbitrary
  -- duplicates.
  tariff       text not null default '__none__',
  valuation    numeric(14,2),
  area_sqm     integer,
  refreshed_at timestamptz not null default now(),
  unique (sg_number, tariff)
);

create index idx_muni_valuation_sg on muni_valuation(sg_number);

alter table muni_valuation enable row level security;

create policy "muni_valuation staff read"
  on muni_valuation for select
  using (is_staff());

comment on table muni_valuation is
  'Per-tariff valuations from Knysna Muni Valuation Roll. A single erf (sg_number) can be rated under multiple tariff categories (main residential + granny flat, house + guest suite, sectional units, etc.). Total muni valuation for an erf is SUM(valuation) across its rows in this table. Owned by /api/muni/import (or a future roll-file adapter).';

-- ---------------------------------------------------------------------------
-- 2. Backfill from the current denormalised muni_property rows
--
-- Preserves the one valuation-per-SG we already had. The next muni import
-- run will discover the additional tariff rows we were previously losing
-- and populate them.
-- ---------------------------------------------------------------------------
insert into muni_valuation (sg_number, tariff, valuation, area_sqm)
select sg_number,
       coalesce(tariff, '__none__'),
       muni_valuation,
       area_sqm_valroll
from muni_property
where muni_valuation is not null;

-- ---------------------------------------------------------------------------
-- 3. Drop the moved columns from muni_property
-- ---------------------------------------------------------------------------
alter table muni_property drop column muni_valuation;
alter table muni_property drop column tariff;
alter table muni_property drop column area_sqm_valroll;

-- ---------------------------------------------------------------------------
-- 4. Rebuild muni_lookup_at_point to sum valuations across child rows
--
-- Function signature stays compatible: still returns a single row with a
-- muni_valuation number. Now that number is the SUM across all tariff
-- categories on the parcel, so map click-to-lookup reports the true total
-- rather than one arbitrary line item.
-- ---------------------------------------------------------------------------
create or replace function muni_lookup_at_point(p_lng float8, p_lat float8)
returns table (
  sg_number      text,
  erf_number     text,
  street_no      text,
  street_name    text,
  suburb         text,
  muni_valuation numeric,
  zoning         text,
  extent_sqm     integer,
  title_deed_no  text,
  property_type  text
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
    select m.*
    from hit
    join muni_property m
      on regexp_replace(coalesce(m.sg_number, ''), '[^0-9]', '', 'g')
         like ('%' || regexp_replace(coalesce(hit.tag_value, ''), '[^0-9]', '', 'g') || '%')
    limit 1
  ),
  valuations as (
    select sum(v.valuation) as total_valuation
    from muni_valuation v
    join matched m on m.sg_number = v.sg_number
  )
  select m.sg_number,
         m.erf_number,
         m.street_no,
         m.street_name,
         m.suburb,
         v.total_valuation as muni_valuation,
         m.zoning,
         m.extent_sqm,
         m.title_deed_no,
         m.property_type
  from matched m
  cross join valuations v
$$;
