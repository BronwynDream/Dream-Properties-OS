-- ============================================================================
-- Dream Knysna OS — 0083 listing facts for the map search (garden, pool, sizes)
-- ----------------------------------------------------------------------------
-- The map's search bar (2026-10-17 redesign) filters on garden / pool and
-- shows erf and floor size on the hover card. Property24 publishes all of
-- these on every listing page ("External Features: Gardens 2 · Pools 1",
-- "Erf Size 1 043 m²", "Floor Size 300 m²"), and every scrape already keeps
-- the page in external_listing.raw (Firecrawl's response: markdown + HTML).
--
-- This reads them out of that saved page, so nothing is re-scraped:
--   * features       text[]  — 'garden', 'pool', 'garage', 'pets'
--   * erf_size_sqm   numeric
--   * floor_size_sqm numeric
--   * bedrooms / bathrooms are filled where the scraper left them empty
--
-- A trigger keeps them current: whenever a scrape writes raw, the facts are
-- re-read. Garden / pool / garage are only read inside the page's
-- "External Features" block, so "Garden Route" or "Forest Gardens" in a
-- description can never count as a garden.
--
-- Safe to run more than once.
-- ============================================================================

alter table external_listing
  add column if not exists features       text[] not null default '{}',
  add column if not exists erf_size_sqm   numeric(12,2),
  add column if not exists floor_size_sqm numeric(12,2);

create or replace function listing_page_text(raw jsonb)
returns text
language sql
immutable
as $$
  -- Firecrawl keeps markdown, and the full HTML. Prefer markdown; fall back
  -- to the HTML with its tags stripped.
  select coalesce(
    nullif(raw->>'markdown', ''),
    regexp_replace(coalesce(raw->>'rawHtml', raw->>'html', ''), '<[^>]+>', ' ', 'g')
  );
$$;

create or replace function listing_size_sqm(t text, label text)
returns numeric
language sql
immutable
as $$
  -- "Erf Size | 1 043 m²" / "Floor Size\n\n300 m²" → 1043 / 300
  select nullif(
    regexp_replace(
      substring(t from label || '[\s|:*]*([0-9][0-9  ,.]*)\s*m'),
      '[^0-9.]', '', 'g'),
    '')::numeric;
$$;

create or replace function external_listing_set_facts()
returns trigger
language plpgsql
as $$
declare
  t   text;
  ext text;
  f   text[] := '{}';
begin
  if new.raw is null then
    return new;
  end if;
  t := listing_page_text(new.raw);
  if t is null or t = '' then
    return new;
  end if;

  -- Only the "External Features" block counts for garden / pool / garage.
  ext := substring(t from 'External Features(.*?)(Building|Other Features|Points of Interest|Bond Calculator|$)');
  if ext is not null then
    if ext ~* '\mgardens?\M[\s|:*]*[0-9]' then f := array_append(f, 'garden'); end if;
    if ext ~* '\mpools?\M[\s|:*]*[0-9]'   then f := array_append(f, 'pool');   end if;
    if ext ~* '\mgarages?\M[\s|:*]*[0-9]' then f := array_append(f, 'garage'); end if;
  end if;
  if t ~* 'Pets Allowed[\s|:*]*Yes' then f := array_append(f, 'pets'); end if;
  new.features := f;

  new.erf_size_sqm   := coalesce(listing_size_sqm(t, 'Erf Size'),   new.erf_size_sqm);
  new.floor_size_sqm := coalesce(listing_size_sqm(t, 'Floor Size'), new.floor_size_sqm);

  if new.bedrooms is null then
    new.bedrooms := nullif(substring(t from 'Bedrooms[\s|:*]*([0-9]+)'), '')::int;
  end if;
  if new.bathrooms is null then
    new.bathrooms := nullif(substring(t from 'Bathrooms[\s|:*]*([0-9]+)'), '')::int;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_external_listing_facts on external_listing;
create trigger trg_external_listing_facts
  before insert or update of raw on external_listing
  for each row execute function external_listing_set_facts();

-- Backfill: touching raw fires the trigger for every saved page.
update external_listing set raw = raw where raw is not null;
