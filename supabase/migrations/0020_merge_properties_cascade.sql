-- ============================================================================
-- Dream Knysna OS — 0020 merge_properties cascade
-- ----------------------------------------------------------------------------
-- After 15 Eagles Way's real-data test (2026-07-07 evening): merging two
-- property rows leaves the survivor with the transfers and listings from BOTH
-- sides — appearing as duplicates on the dashboard even after the property
-- merge "succeeded". Root fix: after the standard property-merge steps,
-- cascade a transfer merge and a listing dedupe on the survivor.
--
-- Conservative heuristic (never merge legitimate separate deals):
--   * Transfers cascade only when they share the same `status` AND the same
--     `transfer_date` (both null counts as same). Keep the oldest as keeper,
--     fold others in via merge_transfers.
--   * Live listings dedupe only when they share the same asking_price and
--     status (both live). Keep the newest by listed_date, delete the rest.
-- Anything with different states or prices survives untouched.
-- ============================================================================

create or replace function merge_properties(
  p_winner uuid,
  p_loser  uuid,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  w property%rowtype;
  l property%rowtype;
  cascade_ids uuid[];
  keeper_id uuid;
  i int;
begin
  if not coalesce(is_admin(), false) then
    raise exception 'not authorised to merge';
  end if;
  if p_winner = p_loser then
    raise exception 'winner and loser must differ';
  end if;
  select * into w from property where id = p_winner;
  if not found then raise exception 'winner property % not found', p_winner; end if;
  select * into l from property where id = p_loser;
  if not found then raise exception 'loser property % not found', p_loser; end if;

  -- 1. Fill winner's null/blank fields from loser.
  update property set
    primary_address    = coalesce(nullif(w.primary_address, ''), nullif(l.primary_address, ''), w.primary_address),
    suburb_id          = coalesce(w.suburb_id, l.suburb_id),
    estate_id          = coalesce(w.estate_id, l.estate_id),
    ownership_type_id  = coalesce(w.ownership_type_id, l.ownership_type_id),
    property_type_id   = coalesce(w.property_type_id, l.property_type_id),
    extent_sqm         = coalesce(w.extent_sqm, l.extent_sqm),
    title_deed_no      = coalesce(nullif(w.title_deed_no, ''), nullif(l.title_deed_no, '')),
    deeds_description  = coalesce(nullif(w.deeds_description, ''), nullif(l.deeds_description, '')),
    municipal_value    = coalesce(w.municipal_value, l.municipal_value),
    lightstone_ref     = coalesce(nullif(w.lightstone_ref, ''), nullif(l.lightstone_ref, '')),
    geom               = coalesce(w.geom, l.geom),
    cadastre           = coalesce(w.cadastre, l.cadastre),
    notes = case
      when w.notes is null then l.notes
      when l.notes is null then w.notes
      when w.notes = l.notes then w.notes
      else w.notes || E'\n---\n(merged from ' || p_loser::text || ')\n' || l.notes
    end
  where id = p_winner;

  -- 2. erf — unique (property_id, erf_number, portion). Drop loser's clashes.
  delete from erf lo where lo.property_id = p_loser and exists (
    select 1 from erf wi where wi.property_id = p_winner
      and coalesce(wi.erf_number, '') = coalesce(lo.erf_number, '')
      and coalesce(wi.portion, '')    = coalesce(lo.portion, '')
  );
  update erf set property_id = p_winner where property_id = p_loser;

  -- 3. transfer, listing, compliance_cert, media, communication,
  --    property_ownership_history, ingest_batch — no unique clashes.
  update transfer                    set property_id = p_winner where property_id = p_loser;
  update listing                     set property_id = p_winner where property_id = p_loser;
  update compliance_cert             set property_id = p_winner where property_id = p_loser;
  update media                       set property_id = p_winner where property_id = p_loser;
  update communication               set property_id = p_winner where property_id = p_loser;
  update property_ownership_history  set property_id = p_winner where property_id = p_loser;
  update ingest_batch                set property_id = p_winner where property_id = p_loser;

  -- 4. document_link — polymorphic; unique (document_id, entity_type, entity_id).
  delete from document_link lo
    where lo.entity_type = 'property' and lo.entity_id = p_loser
      and exists (
        select 1 from document_link wi
        where wi.entity_type = 'property' and wi.entity_id = p_winner
          and wi.document_id = lo.document_id
      );
  update document_link set entity_id = p_winner
    where entity_type = 'property' and entity_id = p_loser;

  -- 5. Clean up dismissals + audit + delete loser.
  delete from dupe_dismissal where target_kind = 'property'
    and (a_id = p_loser or b_id = p_loser);
  insert into audit_log (user_id, action, entity_type, entity_id, justification)
  values (auth.uid(), 'merge', 'property', p_loser,
          'merged into ' || p_winner::text ||
          case when p_reason is null then '' else '; ' || p_reason end);
  delete from property where id = p_loser;

  -- 6. Cascade: transfer dedupe on the survivor.
  --    Group by (status, transfer_date) — both same means same deal state at
  --    the same point in time, safe to merge. Keep the oldest per group.
  for cascade_ids in
    select array_agg(t.id order by t.created_at asc)
    from transfer t
    where t.property_id = p_winner
    group by coalesce(t.status::text, ''), coalesce(t.transfer_date::text, '')
    having count(*) > 1
  loop
    keeper_id := cascade_ids[1];
    for i in 2 .. array_length(cascade_ids, 1) loop
      perform merge_transfers(keeper_id, cascade_ids[i], 'auto-cascade from property merge');
    end loop;
  end loop;

  -- 7. Cascade: live listing dedupe on the survivor.
  --    Same asking_price + status → duplicate. Keep newest by listed_date /
  --    created_at, delete the rest.
  delete from listing
  where id in (
    select id from (
      select id, row_number() over (
        partition by property_id, coalesce(asking_price, -1), status
        order by coalesce(listed_date, created_at::date) desc, created_at desc
      ) as rn
      from listing
      where property_id = p_winner and status = 'live'
    ) sub
    where rn > 1
  );
end; $$;

grant execute on function merge_properties(uuid, uuid, text) to authenticated;
