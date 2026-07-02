-- ============================================================================
-- Dream Knysna OS — 0011 matching: fuzzy candidate proposal for pre-commit review
-- ----------------------------------------------------------------------------
-- commit_batch (0009) does exact-only matching (title_deed_no, id_number,
-- lower(entity_name)). At 500-folder scale that produces duplicates the moment
-- Bronwyn writes "3 Oupad" once and "3 Oupad Road" the next time.
--
-- This migration adds trigram fuzzy matching. propose_matches() writes rows to
-- match_candidate (defined in 0008) so the review UI can surface candidates
-- with score before the user commits. commit_batch is extended to honour
-- explicit IDs picked in that UI: if fields.property.id or a party's id is
-- set, we link to it instead of running the match-or-create path.
--
-- Scope for this ship: property + individual parties. Juristic parties
-- (companies/CCs/trusts) are deferred — commit_batch continues to match them
-- by registration_no + entity_name exact (via upsert_party in 0010).
-- ============================================================================

create extension if not exists pg_trgm;

-- Trigram GIN indexes for the fuzzy paths. These are the only text columns
-- the matcher reaches for; wide-scope indexes would slow the frequent writes.
create index if not exists idx_property_address_trgm
  on property using gin (primary_address gin_trgm_ops);
create index if not exists idx_party_display_name_trgm
  on party using gin (display_name gin_trgm_ops);

-- ---- find_property_candidates ---------------------------------------------
-- Ordered candidates for a property jsonb blob (the shape commit_batch reads).
-- Exact deed match wins with score 1.0 and short-circuits the fuzzy path.
create or replace function find_property_candidates(p_property jsonb)
returns table (candidate_id uuid, label text, score numeric)
language plpgsql stable as $$
declare
  v_deed   text := nullif(p_property->>'title_deed_no', '');
  v_addr   text := nullif(p_property->>'primary_address', '');
  v_erf    text := nullif(p_property->>'erf_number', '');
  v_suburb text := nullif(p_property->>'suburb', '');
begin
  if v_deed is not null then
    return query
      select p.id,
             coalesce(p.primary_address, p.title_deed_no, 'Unknown') ||
               case when p.title_deed_no is not null then ' — Deed ' || p.title_deed_no else '' end,
             1.0::numeric
      from property p
      where p.title_deed_no = v_deed
      limit 1;
    if found then return; end if;
  end if;

  return query
    with scored as (
      select
        p.id,
        coalesce(p.primary_address, p.title_deed_no, 'Unknown') ||
          case when p.title_deed_no is not null then ' — Deed ' || p.title_deed_no else '' end as label,
        greatest(
          coalesce(case when v_addr is not null then similarity(p.primary_address, v_addr) end, 0),
          coalesce(case
            when v_erf is not null and v_suburb is not null
              and exists (select 1 from erf e
                          join suburb s on s.id = p.suburb_id
                          where e.property_id = p.id
                            and e.erf_number = v_erf
                            and lower(s.name) = lower(v_suburb))
            then 0.85 end, 0)
        ) as score
      from property p
    )
    select scored.id, scored.label, round(scored.score, 3)
    from scored
    where scored.score >= 0.35
    order by scored.score desc
    limit 5;
end; $$;

-- ---- find_party_candidates ------------------------------------------------
-- Individual parties only. Juristic parties (party_type != individual) are
-- excluded from the fuzzy path — commit_batch matches them exactly by
-- registration_no / entity_name (see 0010) and this ship doesn't touch that.
create or replace function find_party_candidates(p_party jsonb)
returns table (candidate_id uuid, label text, score numeric)
language plpgsql stable as $$
declare
  v_id text := nullif(p_party->>'id_number', '');
  v_name text := nullif(p_party->>'display_name', '');
begin
  if v_id is not null then
    return query
      select p.id, coalesce(p.display_name, p.entity_name, 'Unknown'), 1.0::numeric
      from party p
      where p.id_number = v_id
        and coalesce(p.party_type, 'individual') = 'individual'
      limit 1;
    if found then return; end if;
  end if;

  if v_name is null then return; end if;

  return query
    select p.id,
           coalesce(p.display_name, p.entity_name, 'Unknown') ||
             case when p.id_number is not null then ' — ID ' || right(p.id_number, 4) else '' end,
           round(similarity(p.display_name, v_name)::numeric, 3) as score
    from party p
    where coalesce(p.party_type, 'individual') = 'individual'
      and p.display_name is not null
      and similarity(p.display_name, v_name) >= 0.35
    order by similarity(p.display_name, v_name) desc
    limit 5;
end; $$;

-- ---- propose_matches ------------------------------------------------------
-- Idempotent: wipes undecided rows for the batch and re-inserts. Decided rows
-- (link/create) are preserved — re-running after a decision doesn't undo it.
-- Auto-decides "link" when a target has exactly one candidate with score >= 0.95,
-- so a green batch with a perfect match still one-clicks.
create or replace function propose_matches(p_batch_id uuid, p_fields jsonb)
returns int
language plpgsql as $$
declare
  v_inserted int := 0;
  v_target text;
  v_party jsonb;
  v_i int;
  c record;
  v_count int;
begin
  delete from match_candidate
   where batch_id = p_batch_id and decision = 'undecided';

  -- property target
  v_target := 'property';
  if p_fields ? 'property' and not exists (
    select 1 from match_candidate where batch_id = p_batch_id and extracted_ref = v_target
  ) then
    for c in select * from find_property_candidates(p_fields->'property') loop
      insert into match_candidate
        (batch_id, target_kind, extracted_ref, candidate_id, candidate_label, score)
      values (p_batch_id, 'property', v_target, c.candidate_id, c.label, c.score);
      v_inserted := v_inserted + 1;
    end loop;
  end if;

  -- sellers
  v_i := 0;
  for v_party in select value from jsonb_array_elements(coalesce(p_fields->'sellers', '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_target := 'seller_' || v_i;
    -- only individuals — skip juristic parties for this ship
    if coalesce(v_party->>'party_type', 'individual') <> 'individual' then
      continue;
    end if;
    if exists (select 1 from match_candidate where batch_id = p_batch_id and extracted_ref = v_target) then
      continue;
    end if;
    for c in select * from find_party_candidates(v_party) loop
      insert into match_candidate
        (batch_id, target_kind, extracted_ref, candidate_id, candidate_label, score)
      values (p_batch_id, 'party', v_target, c.candidate_id, c.label, c.score);
      v_inserted := v_inserted + 1;
    end loop;
  end loop;

  -- purchasers
  v_i := 0;
  for v_party in select value from jsonb_array_elements(coalesce(p_fields->'purchasers', '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_target := 'purchaser_' || v_i;
    if coalesce(v_party->>'party_type', 'individual') <> 'individual' then
      continue;
    end if;
    if exists (select 1 from match_candidate where batch_id = p_batch_id and extracted_ref = v_target) then
      continue;
    end if;
    for c in select * from find_party_candidates(v_party) loop
      insert into match_candidate
        (batch_id, target_kind, extracted_ref, candidate_id, candidate_label, score)
      values (p_batch_id, 'party', v_target, c.candidate_id, c.label, c.score);
      v_inserted := v_inserted + 1;
    end loop;
  end loop;

  -- auto-decide unambiguous high-confidence hits: single candidate, score >= 0.95
  for c in
    select extracted_ref, min(id) as only_id, count(*) as n, max(score) as best
    from match_candidate
    where batch_id = p_batch_id and decision = 'undecided'
    group by extracted_ref
  loop
    if c.n = 1 and c.best >= 0.95 then
      update match_candidate set decision = 'link', decided_at = now()
        where id = c.only_id;
    end if;
  end loop;

  return v_inserted;
end; $$;

grant execute on function propose_matches(uuid, jsonb) to authenticated;

-- ---- commit_batch: honour explicit IDs from decided matches ---------------
-- If fields.property.id is set (from a "link" decision), use it instead of
-- match-or-create. Same per-party via upsert_party: an id in the party jsonb
-- short-circuits the existing lookup path.

create or replace function upsert_party(p jsonb) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_name text := nullif(p->>'display_name', '');
  v_entity text := nullif(p->>'entity_name', '');
  v_idnum text := nullif(p->>'id_number', '');
  v_explicit text := nullif(p->>'id', '');
begin
  -- Explicit link from match-review UI wins.
  if v_explicit is not null then
    begin
      select id into v_id from party where id = v_explicit::uuid;
      if v_id is not null then return v_id; end if;
    exception when others then
      -- fall through to normal match-or-create on a malformed uuid
      null;
    end;
  end if;

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

create or replace function commit_batch(p_batch_id uuid, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prop uuid; v_transfer uuid; v_listing uuid; v_agreement uuid;
  v_deed text; v_erf text; v_addr text; v_suburb text; v_suburb_id uuid;
  v_price numeric; v_deposit numeric; v_tdate date; v_asking numeric;
  v_mandate_type text; v_party uuid; v_seller_primary uuid; v_buyer_primary uuid;
  v_name text; v_prop_explicit text; seller jsonb; buyer jsonb; cond jsonb;
begin
  if not coalesce(is_admin(), false) then
    raise exception 'not authorised to commit';
  end if;

  v_prop_explicit := nullif(p_fields->'property'->>'id', '');
  v_deed   := nullif(p_fields->'property'->>'title_deed_no', '');
  v_erf    := nullif(p_fields->'property'->>'erf_number', '');
  v_addr   := nullif(p_fields->'property'->>'primary_address', '');
  v_suburb := nullif(p_fields->'property'->>'suburb', '');

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

grant execute on function commit_batch(uuid, jsonb) to authenticated;
