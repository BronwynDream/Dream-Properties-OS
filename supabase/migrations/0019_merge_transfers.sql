-- ============================================================================
-- Dream Knysna OS — 0019 merge_transfers: browser-driven transfer consolidation
-- ----------------------------------------------------------------------------
-- Turns tonight's DO-block SQL (used to collapse the 3 Oupad / Plot A4 / 15
-- Eagles Way triples) into an admin-callable RPC. Same shape as
-- merge_properties from 0013: winner keeps the id + non-null values, loser
-- deletes, all children (transfer_party / fica / document_link / listing /
-- agreement / milestone / commission / offer / communication / ingest_batch)
-- get repointed, and unique-constraint clashes on transfer_party / fica /
-- document_link are handled by dropping loser-side rows before the repoint.
--
-- Guard: both transfers must belong to the same property. No cross-property
-- merges — that would silently reassign a deal to a different house.
-- ============================================================================

create or replace function merge_transfers(
  p_winner uuid,
  p_loser  uuid,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  w transfer%rowtype;
  l transfer%rowtype;
begin
  if not coalesce(is_admin(), false) then
    raise exception 'not authorised to merge';
  end if;
  if p_winner = p_loser then
    raise exception 'winner and loser must differ';
  end if;
  select * into w from transfer where id = p_winner;
  if not found then raise exception 'winner transfer % not found', p_winner; end if;
  select * into l from transfer where id = p_loser;
  if not found then raise exception 'loser transfer % not found', p_loser; end if;
  if w.property_id <> l.property_id then
    raise exception 'cannot merge transfers on different properties';
  end if;

  -- 1. Fill winner's blanks from loser (dates, agent + conveyancer refs, notes).
  update transfer set
    lead_agent_user_id     = coalesce(w.lead_agent_user_id, l.lead_agent_user_id),
    conveyancer_firm_id    = coalesce(w.conveyancer_firm_id, l.conveyancer_firm_id),
    conveyancer_contact_id = coalesce(w.conveyancer_contact_id, l.conveyancer_contact_id),
    opened_date            = coalesce(w.opened_date, l.opened_date),
    transfer_date          = coalesce(w.transfer_date, l.transfer_date),
    registered_date        = coalesce(w.registered_date, l.registered_date),
    notes = case
      when w.notes is null then l.notes
      when l.notes is null then w.notes
      when w.notes = l.notes then w.notes
      else w.notes || E'\n---\n(merged from ' || p_loser::text || ')\n' || l.notes
    end
  where id = p_winner;

  -- 2. document_link — polymorphic; unique (document_id, entity_type, entity_id).
  delete from document_link lo
    where lo.entity_type = 'transfer' and lo.entity_id = p_loser
      and exists (
        select 1 from document_link wi
        where wi.entity_type = 'transfer' and wi.entity_id = p_winner
          and wi.document_id = lo.document_id
      );
  update document_link set entity_id = p_winner
    where entity_type = 'transfer' and entity_id = p_loser;

  -- 3. Children with no unique clashes — plain repoint.
  update listing      set transfer_id = p_winner where transfer_id = p_loser;
  update agreement    set transfer_id = p_winner where transfer_id = p_loser;
  update milestone    set transfer_id = p_winner where transfer_id = p_loser;
  update commission   set transfer_id = p_winner where transfer_id = p_loser;
  update offer        set transfer_id = p_winner where transfer_id = p_loser;
  update communication set transfer_id = p_winner where transfer_id = p_loser;
  update ingest_batch set transfer_id = p_winner where transfer_id = p_loser;

  -- 4. transfer_party — unique (transfer_id, party_id, side).
  delete from transfer_party lo where lo.transfer_id = p_loser and exists (
    select 1 from transfer_party wi
    where wi.transfer_id = p_winner and wi.party_id = lo.party_id and wi.side = lo.side
  );
  update transfer_party set transfer_id = p_winner where transfer_id = p_loser;

  -- 5. fica — unique (transfer_id, party_id, role).
  delete from fica lo where lo.transfer_id = p_loser and exists (
    select 1 from fica wi
    where wi.transfer_id = p_winner and wi.party_id = lo.party_id and wi.role = lo.role
  );
  update fica set transfer_id = p_winner where transfer_id = p_loser;

  -- 6. Audit + delete loser.
  insert into audit_log (user_id, action, entity_type, entity_id, justification)
  values (auth.uid(), 'merge', 'transfer', p_loser,
          'merged into ' || p_winner::text ||
          case when p_reason is null then '' else '; ' || p_reason end);

  delete from transfer where id = p_loser;
end; $$;

grant execute on function merge_transfers(uuid, uuid, text) to authenticated;
