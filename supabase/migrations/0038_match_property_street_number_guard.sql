-- ============================================================================
-- Dream Knysna OS — 0038 street-number guard on property matcher
-- ----------------------------------------------------------------------------
-- Real-world misfire (25 Jul 2026): intake batches for 15 Eagles Way and
-- 19 Eagles Way both auto-attached to the existing 12 Eagles Way property.
-- Trigram similarity between "15 Eagles Way, The Heads, Knysna" and
-- "12 Eagles Way, The Heads, Knysna" is ~0.85 (90% of the string matches),
-- comfortably above the 0.55 threshold. But the street NUMBER is the whole
-- point of the address — "12", "15", "19" are three different properties.
--
-- New rule: extract the leading numeric token from the incoming query. If
-- present, only return candidates whose primary_address starts with the same
-- number. Non-numeric queries ("St James Hotel", "House E105 Pezula")
-- keep the pure-trigram behaviour.
--
-- Example:
--   q = "15 Eagles Way The Heads"     → filtered to properties starting "15 "
--   q = "House E105 Pezula Estate"    → no leading number, pure trigram
--   q = "6 Bowden Park Leisure Isle"  → filtered to properties starting "6 "
-- ============================================================================

create or replace function match_property_by_address(
  q text,
  min_sim numeric default 0.45
)
returns table(id uuid, primary_address text, sim numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with parsed as (
    select (regexp_match(q, '^\s*(\d+)\b'))[1] as street_num
  )
  select p.id, p.primary_address,
         round(similarity(p.primary_address, q)::numeric, 3) as sim
  from property p, parsed
  where q is not null
    and length(q) >= 3
    and similarity(p.primary_address, q) >= min_sim
    -- Street-number guard: if q starts with a number, only match addresses
    -- that also start with the SAME number. Numberless queries pass through.
    and (
      parsed.street_num is null
      or p.primary_address ~ ('^\s*' || parsed.street_num || '\M')
    )
  order by similarity(p.primary_address, q) desc
  limit 5
$$;
