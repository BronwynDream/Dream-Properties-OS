-- ============================================================================
-- Dream Knysna OS — 0037 commit_batch multi-erf support
-- ----------------------------------------------------------------------------
-- The `erf` table is 1-to-many with `property` (169 Links = 1602 + 1603 was
-- the canonical example from take-on) but commit_batch only ever inserted
-- ONE erf per commit — pulled from p_fields->'property'->>'erf_number'.
-- Multi-erf properties needed manual SQL for the extras.
--
-- Extraction now returns erf as an array of rows routed into fields.erfs[]
-- (each item shaped like {"erf_number": "1602"}). Update commit_batch to
-- iterate that array. Backwards-compat: still read the legacy singular
-- `property.erf_number` when no fields.erfs is present (older cached
-- extractions may still flow through this path).
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
  v_erf_item jsonb;
  v_erf_val text;
  seller jsonb; buyer jsonb; cond jsonb;
begin
  if not (
    coalesce(is_admin(), false)
    or coalesce(auth.role() = 'service_role', false)
  ) then
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
    begin v_prop := v_prop_explicit::uuid; exception when others then v_prop := null; end;
  end if;
  if v_prop is null and v_deed is not null then
    select id into v_prop from property where title_deed_no = v_deed limit 1;
  end if;
  if v_prop is null and v_erf is not null then
    select p.id into v_prop from property p join erf e on e.property_id = p.id where e.erf_number = v_erf limit 1;
  end if;
  if v_prop is null then
    for v_erf_item in select * from jsonb_array_elements(coalesce(p_fields->'erfs', '[]'::jsonb))
    loop
      v_erf_val := nullif(v_erf_item->>'erf_number', '');
      if v_erf_val is not null then
        select p.id into v_prop from property p join erf e on e.property_id = p.id where e.erf_number = v_erf_val limit 1;
        exit when v_prop is not null;
      end if;
    end loop;
  end if;
  if v_prop is null and v_addr is not null then
    select id into v_prop from property where primary_address ilike v_addr order by created_at limit 1;
  end if;

  if v_prop is null then
    if v_suburb is not null then select id into v_suburb_id from suburb where name ilike v_suburb limit 1; end if;
    if v_prop_type is not null then select id into v_prop_type_id from property_type where code = v_prop_type limit 1; end if;
    if v_own_type is not null then select id into v_own_type_id from ownership_type where code = v_own_type limit 1; end if;
    insert into property (primary_address, title_deed_no, extent_sqm, suburb_id, property_type_id, ownership_type_id)
    values (coalesce(v_addr, 'Unknown address'), v_deed, v_extent, v_suburb_id, v_prop_type_id, v_own_type_id)
    returning id into v_prop;
  else
    update property set primary_address = coalesce(v_addr, primary_address), title_deed_no = coalesce(v_deed, title_deed_no), extent_sqm = coalesce(v_extent, extent_sqm) where id = v_prop;
    if v_suburb is not null then select id into v_suburb_id from suburb where name ilike v_suburb limit 1; update property set suburb_id = coalesce(suburb_id, v_suburb_id) where id = v_prop; end if;
    if v_prop_type is not null then select id into v_prop_type_id from property_type where code = v_prop_type limit 1; update property set property_type_id = coalesce(property_type_id, v_prop_type_id) where id = v_prop; end if;
    if v_own_type is not null then select id into v_own_type_id from ownership_type where code = v_own_type limit 1; update property set ownership_type_id = coalesce(ownership_type_id, v_own_type_id) where id = v_prop; end if;
  end if;

  -- Insert every erf from fields.erfs[] (new multi-erf shape).
  for v_erf_item in select * from jsonb_array_elements(coalesce(p_fields->'erfs', '[]'::jsonb))
  loop
    v_erf_val := nullif(v_erf_item->>'erf_number', '');
    if v_erf_val is not null then
      insert into erf (property_id, erf_number) values (v_prop, v_erf_val) on conflict do nothing;
    end if;
  end loop;

  -- Backwards-compat: legacy singular `property.erf_number` still respected.
  if v_erf is not null then
    insert into erf (property_id, erf_number) values (v_prop, v_erf) on conflict do nothing;
  end if;

  if v_transfer_explicit is not null then
    begin v_transfer := v_transfer_explicit::uuid; exception when others then v_transfer := null; end;
    if v_transfer is not null then perform 1 from transfer where id = v_transfer and property_id = v_prop; if not found then v_transfer := null; end if; end if;
  end if;
  if v_transfer is null then
    v_name := coalesce(v_addr, v_deed, 'Imported deal');
    insert into transfer (property_id, name, status) values (v_prop, v_name, 'preparing') returning id into v_transfer;
  end if;

  for seller in select * from jsonb_array_elements(coalesce(p_fields->'sellers', '[]'::jsonb)) loop
    v_party := upsert_party(seller);
    if v_party is not null then
      insert into transfer_party (transfer_id, party_id, side, is_primary) values (v_transfer, v_party, 'seller', v_seller_primary is null) on conflict do nothing;
      if v_seller_primary is null then v_seller_primary := v_party; end if;
    end if;
  end loop;
  for buyer in select * from jsonb_array_elements(coalesce(p_fields->'purchasers', '[]'::jsonb)) loop
    v_party := upsert_party(buyer);
    if v_party is not null then
      insert into transfer_party (transfer_id, party_id, side, is_primary) values (v_transfer, v_party, 'purchaser', v_buyer_primary is null) on conflict do nothing;
      if v_buyer_primary is null then v_buyer_primary := v_party; end if;
    end if;
  end loop;

  v_price := safe_numeric(p_fields->'agreement'->>'price');
  v_deposit := safe_numeric(p_fields->'agreement'->>'deposit');
  v_tdate := safe_date(p_fields->'agreement'->>'transfer_date');
  if v_price is not null then
    insert into agreement (transfer_id, agreement_type, status, price, deposit, transfer_date) values (v_transfer, 'sale_improved', 'executed', v_price, v_deposit, v_tdate) returning id into v_agreement;
    update transfer set status = 'in_conveyancing', transfer_date = v_tdate where id = v_transfer;
    for cond in select * from jsonb_array_elements(coalesce(p_fields->'conditions', '[]'::jsonb)) loop
      insert into suspensive_condition (agreement_id, type, description, status) values (v_agreement, 'other', nullif(cond->>'description', ''), to_condition_status(cond->>'status'));
    end loop;
  end if;

  v_asking := safe_numeric(p_fields->'listing'->>'asking_price');
  v_mandate_type := nullif(p_fields->'mandate'->>'type', '');
  if v_asking is not null or v_mandate_type is not null then
    insert into listing (transfer_id, property_id, status, asking_price) values (v_transfer, v_prop, 'live', v_asking) returning id into v_listing;
    if v_mandate_type is not null then
      insert into mandate (listing_id, type, evidence, expiry_date) values (v_listing, to_mandate_type(v_mandate_type), 'signed_pdf', safe_date(p_fields->'mandate'->>'expiry_date'));
    end if;
  end if;

  if safe_numeric(p_fields->'commission'->>'gross_amount') is not null then
    insert into commission (transfer_id, gross_amount, status) values (v_transfer, safe_numeric(p_fields->'commission'->>'gross_amount'), 'pending');
  end if;

  select exists (select 1 from ingest_file f join document_type dt on dt.id = f.detected_doc_type_id where f.batch_id = p_batch_id and dt.code = 'title_deed') into v_has_title_deed;
  if v_has_title_deed and v_price is not null then
    update transfer set status = 'registered', registered_date = coalesce(registered_date, transfer_date, current_date) where id = v_transfer;
  end if;

  update ingest_batch set status = 'committed', property_id = v_prop, transfer_id = v_transfer where id = p_batch_id;
  update extraction set status = 'accepted' where batch_id = p_batch_id and status = 'proposed';

  return jsonb_build_object('property_id', v_prop, 'transfer_id', v_transfer);
end; $$;

grant execute on function commit_batch(uuid, jsonb) to authenticated;
grant execute on function commit_batch(uuid, jsonb) to service_role;
