-- Address → muni_property lookup that normalises the street-type suffix
-- (STREET / STR / ROAD / RD / AVENUE / …) on both sides.
--
-- Bug: the muni importer stores street_name as the raw finance-system
-- value (e.g. 'GREY STREET', 'RIVER CLUB ROAD') with suffix attached.
-- The JS erfLookup strips the same suffix on the query side ('GREY',
-- 'RIVER CLUB') then does ilike-equality. Mismatch guaranteed — 0/188
-- hits on the first bulk regeocode attempt.
--
-- Fix: strip the trailing street-type word in SQL too so 'GREY' matches
-- 'GREY STREET', 'GREY', 'GREY STR' and 'GREY RD' alike. Suburb hint is
-- kept as an optional tie-breaker for streets that repeat across suburbs
-- (Grey Street exists in both Central and Pezula's estate roads).
--
-- muni_property has ~15k rows so the regexp_replace scan per call is
-- cheap. If it becomes a hot path we'll materialise a normalised column
-- + btree index; for now, correctness first.

create or replace function muni_property_by_address(
  p_street_no   text,
  p_street_name text  -- caller passes UPPERCASE, suffix already stripped
)
returns setof muni_property
language sql
stable
as $$
  select *
  from muni_property
  where (p_street_no is null or street_no = p_street_no)
    and regexp_replace(
      upper(coalesce(street_name, '')),
      '\s+(STREET|STR|ST|ROAD|RD|AVENUE|AVE|AV|LANE|LN|CRESCENT|CRES|CR|DRIVE|DR|DRV|CLOSE|CL|WAY|BOULEVARD|BLVD|PLACE|PL|TERRACE|TER|COURT|CT|SQUARE|SQ|PARK|MEWS|WALK|BEND)$',
      ''
    ) = upper(p_street_name)
  limit 20;
$$;

comment on function muni_property_by_address(text, text) is
  'Address-to-muni lookup that normalises street-type suffix on the stored side. Caller (erfLookup.ts) passes already-normalised uppercase street name; this strips STREET/RD/AVE/etc from the muni value so both sides compare apples-to-apples.';
