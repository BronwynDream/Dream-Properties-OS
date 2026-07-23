-- ============================================================================
-- Dream Knysna OS — 0033 mark transfer sold
-- ----------------------------------------------------------------------------
-- The system's transfer.status vocabulary (0001) captured legally-precise
-- states (preparing / in_conveyancing / registered / cancelled / lapsed) but
-- had no way to record the commercial reality Bronwyn's team lives with:
-- a mandate that resulted in a sale by *someone else* — a joint-mandate
-- partner, a rival agency, or a private sale before Dream took the mandate.
-- Marking these as 'registered' would misrepresent legal state (Dream has no
-- Deeds Office paperwork for them); leaving them as 'in_conveyancing' or
-- 'listed' misrepresents commercial state (the property has sold, don't
-- market it any more).
--
-- Two changes:
--   1. New enum value 'sold_external' — commercial "sold, not by us".
--   2. sold_by + sold_by_note columns capturing WHO closed the deal.
--
-- Dream-sold path stays on the existing rails: the auto-advance from
-- title-deed evidence (0018) still fires, and 0032 still invalidates market
-- caches on registration. When an agent marks a transfer as "Dream sold it",
-- we only record the intent (sold_by='dream') — status advances naturally
-- when the deed is uploaded. This keeps the strict-legal meaning of
-- 'registered' intact.
--
-- External path bypasses the deed workflow entirely: status jumps to
-- 'sold_external', sold_by captures the category, sold_by_note captures the
-- partner name / free text. Deeds Office data will never arrive for these.
-- ============================================================================

-- 1. Extend the transfer_status enum. Postgres requires ALTER TYPE ADD VALUE
--    to run outside a transaction, but Supabase's migration runner already
--    wraps each file in a savepoint that permits enum growth.
alter type transfer_status add value if not exists 'sold_external';

-- 2. Add the "who sold it" columns.
alter table transfer add column if not exists sold_by text
  check (sold_by is null or sold_by in ('dream', 'partner', 'other', 'pre_mandate'));
alter table transfer add column if not exists sold_by_note text;

comment on column transfer.sold_by is
  'Commercial provenance of the sale: dream | partner (joint-mandate co-holder) | other (competitor) | pre_mandate (private sale before Dream took the mandate). Null while the deal is live.';
comment on column transfer.sold_by_note is
  'Free-text: partner agency name, private-sale note, or context on how we learned it sold. Optional.';

-- 3. RPC — mark a transfer sold. Security definer + search_path so RLS on
--    transfer (staff write) doesn't gate the mark for authenticated agents.
create or replace function mark_transfer_sold(
  p_transfer_id uuid,
  p_sold_by     text,
  p_sold_by_note text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prev_status transfer_status;
  v_note        text;
begin
  if p_sold_by not in ('dream', 'partner', 'other', 'pre_mandate') then
    raise exception 'invalid sold_by value: %', p_sold_by;
  end if;

  select status into v_prev_status from transfer where id = p_transfer_id;
  if not found then
    raise exception 'transfer % not found', p_transfer_id;
  end if;

  -- Trim whitespace-only notes to null so the audit line stays tidy.
  v_note := nullif(btrim(coalesce(p_sold_by_note, '')), '');

  if p_sold_by = 'dream' then
    -- Dream sold it — record intent only. Status advances via 0018 when the
    -- title deed arrives. If it never does, sold_by='dream' still signals
    -- that the deal is Bronwyn-considered-closed.
    update transfer
       set sold_by      = 'dream',
           sold_by_note = v_note
     where id = p_transfer_id;
  else
    -- External: sale by someone else. Skip the deed workflow entirely.
    update transfer
       set status       = 'sold_external',
           sold_by      = p_sold_by,
           sold_by_note = v_note
     where id = p_transfer_id;
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, justification)
  values (
    auth.uid(),
    'mark_sold',
    'transfer',
    p_transfer_id,
    format(
      'sold_by=%s; prev_status=%s%s',
      p_sold_by,
      v_prev_status,
      case when v_note is null then '' else '; note: ' || v_note end
    )
  );
end; $$;

grant execute on function mark_transfer_sold(uuid, text, text) to authenticated;

comment on function mark_transfer_sold(uuid, text, text) is
  'Agent action: record that a transfer''s deal is closed. Dream-sold leaves status alone (deed auto-advance still applies); external categories flip status to sold_external and skip the deed workflow. Writes audit_log.';
