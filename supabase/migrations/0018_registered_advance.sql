-- ============================================================================
-- Dream Knysna OS — 0018 registered advance: title-deed evidence → status=registered
-- ----------------------------------------------------------------------------
-- Registration at the Deeds Office produces a title deed. When a batch commits
-- and contains a file classified as `title_deed`, that's evidence the transfer
-- has registered. Advance transfer.status to 'registered' and stamp
-- registered_date (prefer any existing value, then the agreement's transfer_date,
-- then today).
--
-- Also includes a one-shot backfill for transfers where a title_deed doc is
-- already linked but the status is still 'in_conveyancing'. That fixes records
-- like 3 Oupad where the deed came in through the pipeline but nothing
-- advanced the status.
-- ============================================================================

create or replace function commit_batch(p_batch_id uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prop uuid; v_transfer uuid; v_listing uuid; v_agreement uuid;
  v_deed text; v_erf text; v_addr text; v_suburb text; v_suburb_id uuid;
  v_extent numeric;
  v_prop_type text; v_own_type text;
  v_prop_type_id uuid; v_own_type_id uuid;
  v_price numeric; v_deposit numeric; v_tdate date; v_asking numeric;
  v_mandate_type text; v_party uuid; v_seller_primary uuid; v_buyer_primary uuid;
  v_name text; v_prop_explicit text; v_transfer_explicit text;
  v_has_title_deed boolean;
  seller jsonb; buyer jsonb; cond jsonb;
begin
  if not coalesce(is_admin(), false) then
    raise exception 'not authorised to commit';
  end if;

  v_prop_explicit     := nullif(p_fields->'property'->>'id', '');
  v_transfer_explicit := nullif(p_fields->'transfer'->>'id', '');
  v_deed      := nullif(p_fields->'property'->>'title_deed_no', '');
  v_erf       := nullif(p_fields->'property'->>'erf_number', '');
  v_addr      := nullif(p_fields->'property'->>'primary_address', '');
  v_suburb    := nullif(p_fields->'property'->>'suburb', '');
  v_extent    := safe_numeric(p_fields->'property'->>'extent_sqm');
  v_prop_type := nullif(p_fields->'property'->>'property_type', '');
  v_own_type  := nullif(p_fields->'property'->>'ownership_type', '');

  if v_prop_explicit is not null then
    begin
      select id into v_prop from property where id = v_prop_explicit::uuid;
    exception when others then null;
    end;
  end if;

  if v_prop is null and v_deed is not null then
    select id into v_prop from property where title_deed_no = v_deed limit 1;
  end if;
  if v_suburb is not null then
    select id into v_suburb_id from suburb where lower(name) = lower(v_suburb) limit 1;
  end if;

  if v_prop_type is not null then
    select id into v_prop_type_id from property_type
      where lower(code) = lower(v_prop_type) or lower(label) = lower(v_prop_type)
      limit 1;
  end if;
  if v_own_type is not null then
    select id into v_own_type_id from ownership_type
      where lower(code) = lower(v_own_type) or lower(label) = lower(v_own_type)
      limit 1;
  end if;

  if v_prop is null then
    insert into property (primary_address, suburb_id, extent_sqm, title_deed_no,
                          property_type_id, ownership_type_id)
    values (coalesce(v_addr, 'Unknown address'), v_suburb_id,
            v_extent, v_deed,
            v_prop_type_id, v_own_type_id)
    returning id into v_prop;
  else
    update property set
      suburb_id         = coalesce(suburb_id, v_suburb_id),
      extent_sqm        = coalesce(extent_sqm, v_extent),
      title_deed_no     = coalesce(nullif(title_deed_no, ''), v_deed),
      property_type_id  = coalesce(property_type_id, v_prop_type_id),
      ownership_type_id = coalesce(ownership_type_id, v_own_type_id)
    where id = v_prop;
  end if;

  if v_erf is not null and not exists (
    select 1 from erf where property_id = v_prop and erf_number = v_erf
  ) then
    insert into erf (property_id, erf_number) values (v_prop, v_erf);
  end if;

  if v_transfer_explicit is not null then
    begin
      select id into v_transfer
      from transfer
      where id = v_transfer_explicit::uuid and property_id = v_prop;
    exception when others then v_transfer := null;
    end;
  end if;

  if v_transfer is null then
    v_name := coalesce(v_addr, v_deed, 'Imported deal');
    insert into transfer (property_id, name, status)
    values (v_prop, v_name, 'preparing')
    returning id into v_transfer;
  end if;

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

  -- Title-deed evidence → deal has registered at the Deeds Office. Fires after
  -- any 'in_conveyancing' assignment above so the final status wins.
  select exists (
    select 1 from ingest_file f
    join document_type dt on dt.id = f.detected_doc_type_id
    where f.batch_id = p_batch_id and dt.code = 'title_deed'
  ) into v_has_title_deed;

  if v_has_title_deed then
    update transfer
      set status = 'registered',
          registered_date = coalesce(registered_date, transfer_date, current_date)
      where id = v_transfer;
  end if;

  update ingest_batch set status = 'committed', property_id = v_prop, transfer_id = v_transfer
  where id = p_batch_id;
  update extraction set status = 'accepted' where batch_id = p_batch_id and status = 'proposed';

  return jsonb_build_object('property_id', v_prop, 'transfer_id', v_transfer);
end; $$;

grant execute on function commit_batch(uuid, jsonb) to authenticated;

-- ---- One-shot backfill --------------------------------------------------
-- Transfers that already have a title_deed doc linked (either to the transfer
-- itself or to its parent property) but were never advanced past
-- 'in_conveyancing' or 'preparing'. Set them to 'registered' and stamp
-- registered_date using the earliest signal available.
update transfer t
set status = 'registered',
    registered_date = coalesce(t.registered_date, t.transfer_date, current_date)
where t.status in ('in_conveyancing', 'preparing')
  and exists (
    select 1 from document_link dl
    join document d on d.id = dl.document_id
    join document_type dt on dt.id = d.doc_type_id
    where dt.code = 'title_deed'
      and (
        (dl.entity_type = 'transfer' and dl.entity_id = t.id)
        or (dl.entity_type = 'property' and dl.entity_id = t.property_id)
      )
  );
