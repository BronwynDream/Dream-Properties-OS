-- ============================================================================
-- Dream Knysna OS — 0009 commit: turn reviewed extraction fields into live records
-- ----------------------------------------------------------------------------
-- commit_batch(batch_id, fields jsonb) does an atomic match-or-create write of a
-- reviewed batch into property / party / transfer / agreement / listing / mandate.
-- Generalises the 7 The Grove pilot. Admin-gated (security definer bypasses RLS).
-- ============================================================================

-- ---- safe casters (never abort the whole commit on a stray value) ----------
create or replace function safe_numeric(t text) returns numeric
language plpgsql immutable as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return (regexp_replace(t, '[^0-9.\-]', '', 'g'))::numeric;
exception when others then return null;
end; $$;

create or replace function safe_date(t text) returns date
language plpgsql immutable as $$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return t::date;
exception when others then return null;
end; $$;

create or replace function to_party_type(t text) returns party_type
language plpgsql immutable as $$
begin
  return coalesce(nullif(lower(btrim(t)), '')::party_type, 'individual');
exception when others then return 'individual';
end; $$;

create or replace function to_mandate_type(t text) returns mandate_type
language plpgsql immutable as $$
begin
  return coalesce(nullif(lower(btrim(t)), '')::mandate_type, 'open');
exception when others then return 'open';
end; $$;

create or replace function to_condition_status(t text) returns condition_status
language plpgsql immutable as $$
begin
  return coalesce(nullif(lower(btrim(t)), '')::condition_status, 'pending');
exception when others then return 'pending';
end; $$;

create or replace function map_regime(t text) returns matrimonial_regime
language plpgsql immutable as $$
declare s text;
begin
  if t is null then return 'unknown'; end if;
  s := lower(t);
  if s like '%community%' and s not like '%out%' then return 'married_in_community';
  elsif s like '%accrual%' and (s like '%out%' or s like '%excl%') then return 'married_anc_no_accrual';
  elsif s like '%accrual%' then return 'married_anc_with_accrual';
  elsif s like '%antenuptial%' or s like '%anc%' or s like '%out of community%' then return 'married_anc_no_accrual';
  elsif s like '%divorc%' then return 'divorced';
  elsif s like '%widow%' then return 'widowed';
  elsif s like '%single%' or s like '%unmarried%' then return 'single';
  else return 'unknown';
  end if;
end; $$;

-- ---- match-or-create a party from a jsonb blob ------------------------------
create or replace function upsert_party(p jsonb) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_name text := nullif(p->>'display_name', '');
  v_entity text := nullif(p->>'entity_name', '');
  v_idnum text := nullif(p->>'id_number', '');
begin
  if v_name is null and v_entity is null then return null; end if;

  if v_idnum is not null then
    select id into v_id from party where id_number = v_idnum limit 1;
  end if;
  if v_id is null and v_entity is not null then
    select id into v_id from party where lower(entity_name) = lower(v_entity) limit 1;
  end if;

  if v_id is null then
    insert into party (party_type, display_name, entity_name, id_number, matrimonial_regime)
    values (
      to_party_type(p->>'party_type'),
      coalesce(v_name, v_entity),
      v_entity,
      v_idnum,
      map_regime(p->>'matrimonial_regime')
    )
    returning id into v_id;
  end if;
  return v_id;
end; $$;

-- ---- the commit ------------------------------------------------------------
create or replace function commit_batch(p_batch_id uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prop uuid; v_transfer uuid; v_listing uuid; v_agreement uuid;
  v_deed text; v_erf text; v_addr text; v_suburb text; v_suburb_id uuid;
  v_price numeric; v_deposit numeric; v_tdate date; v_asking numeric;
  v_mandate_type text; v_party uuid; v_seller_primary uuid; v_buyer_primary uuid;
  v_name text; seller jsonb; buyer jsonb; cond jsonb;
begin
  if not coalesce(is_admin(), false) then
    raise exception 'not authorised to commit';
  end if;

  v_deed   := nullif(p_fields->'property'->>'title_deed_no', '');
  v_erf    := nullif(p_fields->'property'->>'erf_number', '');
  v_addr   := nullif(p_fields->'property'->>'primary_address', '');
  v_suburb := nullif(p_fields->'property'->>'suburb', '');

  if v_deed is not null then
    select id into v_prop from property where title_deed_no = v_deed limit 1;
  end if;
  if v_suburb is not null then
    select id into v_suburb_id from suburb where lower(name) = lower(v_suburb) limit 1;
  end if;

  if v_prop is null then
    insert into property (primary_address, suburb_id, extent_sqm, title_deed_no)
    values (coalesce(v_addr, 'Unknown address'), v_suburb_id,
            safe_numeric(p_fields->'property'->>'extent_sqm'), v_deed)
    returning id into v_prop;
  end if;

  if v_erf is not null and not exists (
    select 1 from erf where property_id = v_prop and erf_number = v_erf
  ) then
    insert into erf (property_id, erf_number) values (v_prop, v_erf);
  end if;

  v_name := coalesce(v_addr, v_deed, 'Imported deal');
  insert into transfer (property_id, name, status)
  values (v_prop, v_name, 'preparing')
  returning id into v_transfer;

  for seller in select * from jsonb_array_elements(coalesce(p_fields->'sellers', '[]'::jsonb))
  loop
    v_party := upsert_party(seller);
    if v_party is not null then
      insert into transfer_party (transfer_id, party_id, side, is_primary)
      values (v_transfer, v_party, 'seller', v_seller_primary is null)
      on conflict do nothing;
      if v_seller_primary is null then v_seller_primary := v_party; end if;
    end if;
  end loop;

  for buyer in select * from jsonb_array_elements(coalesce(p_fields->'purchasers', '[]'::jsonb))
  loop
    v_party := upsert_party(buyer);
    if v_party is not null then
      insert into transfer_party (transfer_id, party_id, side, is_primary)
      values (v_transfer, v_party, 'purchaser', v_buyer_primary is null)
      on conflict do nothing;
      if v_buyer_primary is null then v_buyer_primary := v_party; end if;
    end if;
  end loop;

  v_price   := safe_numeric(p_fields->'agreement'->>'price');
  v_deposit := safe_numeric(p_fields->'agreement'->>'deposit');
  v_tdate   := safe_date(p_fields->'agreement'->>'transfer_date');

  if v_price is not null then
    insert into agreement (transfer_id, agreement_type, status, price, deposit, transfer_date)
    values (v_transfer, 'sale_improved', 'executed', v_price, v_deposit, v_tdate)
    returning id into v_agreement;
    update transfer set status = 'in_conveyancing', transfer_date = v_tdate where id = v_transfer;

    for cond in select * from jsonb_array_elements(coalesce(p_fields->'conditions', '[]'::jsonb))
    loop
      insert into suspensive_condition (agreement_id, type, description, status)
      values (v_agreement, 'other', nullif(cond->>'description', ''),
              to_condition_status(cond->>'status'));
    end loop;
  end if;

  v_asking := safe_numeric(p_fields->'listing'->>'asking_price');
  v_mandate_type := nullif(p_fields->'mandate'->>'type', '');
  if v_asking is not null or v_mandate_type is not null then
    insert into listing (transfer_id, property_id, status, asking_price)
    values (v_transfer, v_prop, 'live', v_asking)
    returning id into v_listing;
    if v_mandate_type is not null then
      insert into mandate (listing_id, type, evidence, expiry_date)
      values (v_listing, to_mandate_type(v_mandate_type), 'signed_pdf',
              safe_date(p_fields->'mandate'->>'expiry_date'));
    end if;
  end if;

  if safe_numeric(p_fields->'commission'->>'gross_amount') is not null then
    insert into commission (transfer_id, gross_amount, status)
    values (v_transfer, safe_numeric(p_fields->'commission'->>'gross_amount'), 'pending');
  end if;

  update ingest_batch set status = 'committed', property_id = v_prop, transfer_id = v_transfer
  where id = p_batch_id;
  update extraction set status = 'accepted' where batch_id = p_batch_id and status = 'proposed';

  return jsonb_build_object('property_id', v_prop, 'transfer_id', v_transfer);
end; $$;

-- Let authenticated callers execute it (the function itself enforces admin).
grant execute on function commit_batch(uuid, jsonb) to authenticated;
