-- ============================================================================
-- Dream Knysna OS — 0032 invalidate market cache on transfer registration
-- ----------------------------------------------------------------------------
-- Cached Lightstone facets are marked permanent (freshness rule in
-- lib/market/service.ts) for deeds/legal, ownership, last_sale, comparables.
-- That's the right default: those facets only change at Deeds Office
-- registration events, which are rare per property.
--
-- When one of our own transfers flips to 'registered', that IS such an event
-- for the linked property. Any cached Lightstone data now shows the previous
-- owner / sale — stale. Null the four permanent facets' *_fetched_at on the
-- matching market_property row so the next getMarketFacet() call falls
-- through and re-fetches under the budget.
--
-- AVM has its own 12-month TTL and self-invalidates; leave it alone (AVM is
-- valuation, not ownership, so a registration doesn't necessarily change it).
--
-- Trigger fires on:
--   INSERT with status='registered'                        (direct new row)
--   UPDATE of status to 'registered' (from any other)      (advance path)
-- Skips:
--   UPDATE where old.status was already 'registered'       (no-op re-set)
--
-- security definer + set search_path so RLS on market_property (admin-only
-- write) doesn't block the trigger firing under an authenticated user
-- committing a batch or merging a transfer.
-- ============================================================================

create or replace function invalidate_market_cache_on_register() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_lsid bigint;
begin
  if new.status <> 'registered' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'registered' then
    return new;
  end if;

  select lightstone_property_id into v_lsid
  from property where id = new.property_id;

  if v_lsid is null then
    return new;
  end if;

  update market_property set
    legal_fetched_at       = null,
    ownership_fetched_at   = null,
    last_sale_fetched_at   = null,
    comparables_fetched_at = null
  where lightstone_property_id = v_lsid;

  return new;
end; $$;

comment on function invalidate_market_cache_on_register() is
  'AFTER-trigger body for transfer.status → registered. Nulls the permanent-cache facets (legal, ownership, last_sale, comparables) on the property''s market_property row. AVM has its own TTL.';

drop trigger if exists trg_transfer_register_invalidate on transfer;
create trigger trg_transfer_register_invalidate
  after insert or update of status on transfer
  for each row execute function invalidate_market_cache_on_register();
