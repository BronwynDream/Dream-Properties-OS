-- ============================================================================
-- Dream Knysna OS — 0013 dupe finder: post-hoc duplicate scan + admin merge
-- ----------------------------------------------------------------------------
-- 0011 introduced pre-commit fuzzy matching, but duplicates that predate
-- matching (or that slipped through the batch flow) still land in property
-- and party. The 2026-07-02 manual dedupe (15 Eagles Way × 2, 7 The Grove
-- pair) proved the pattern: winner keeps id, gaps filled from loser, all FK
-- references repointed, loser deleted. This migration turns that pattern
-- into scan functions + admin-gated merge RPCs, and adds a dismissal table
-- so "not a dupe" decisions persist between scans.
--
-- Uses pg_trgm indexes from 0011 (property.primary_address, party.display_name).
-- ============================================================================

-- ---- dupe_dismissal ------------------------------------------------------
-- Normalise the pair so we only ever store one row regardless of the order
-- the UI submits (a_id < b_id enforced by check).
create table if not exists dupe_dismissal (
  id            uuid primary key default gen_random_uuid(),
  target_kind   text not null check (target_kind in ('property','party')),
  a_id          uuid not null,
  b_id          uuid not null,
  dismissed_by  uuid references app_user(id),
  dismissed_at  timestamptz not null default now(),
  reason        text,
  constraint dupe_dismissal_ordered check (a_id < b_id),
  unique (target_kind, a_id, b_id)
);

alter table dupe_dismissal enable row level security;
create policy dupe_dismissal_admin on dupe_dismissal for all
  using (is_admin()) with check (is_admin());

-- ---- find_property_dupes -------------------------------------------------
-- Pairwise scan across property. Score is max of trigram similarity on
-- primary_address and exact title_deed_no match (=1.0). Returns pair
-- summaries with counts of attached records so the admin can pick which
-- side is the winner. Excludes dismissed pairs.
create or replace function find_property_dupes(
  p_threshold numeric default 0.5,
  p_limit     int     default 50
)
returns table (
  a_id uuid, a_label text, a_deed text, a_suburb text, a_extent numeric,
  a_transfer_count int, a_listing_count int, a_erf_count int,
  b_id uuid, b_label text, b_deed text, b_suburb text, b_extent numeric,
  b_transfer_count int, b_listing_count int, b_erf_count int,
  score numeric
)
language sql stable as $$
  with pairs as (
    select
      a.id as a_id,
      a.primary_address as a_addr, a.title_deed_no as a_deed,
      a.suburb_id as a_suburb_id, a.extent_sqm as a_extent,
      b.id as b_id,
      b.primary_address as b_addr, b.title_deed_no as b_deed,
      b.suburb_id as b_suburb_id, b.extent_sqm as b_extent,
      greatest(
        case when a.primary_address is not null and b.primary_address is not null
             then similarity(a.primary_address, b.primary_address) else 0 end,
        case when nullif(a.title_deed_no, '') is not null
                  and a.title_deed_no = b.title_deed_no
             then 1.0 else 0 end
      ) as score
    from property a
    join property b on a.id < b.id
    where (
      (a.primary_address is not null and b.primary_address is not null
        and similarity(a.primary_address, b.primary_address) >= p_threshold)
      or (nullif(a.title_deed_no, '') is not null and a.title_deed_no = b.title_deed_no)
    )
    and not exists (
      select 1 from dupe_dismissal d
      where d.target_kind = 'property' and d.a_id = a.id and d.b_id = b.id
    )
  )
  select
    p.a_id,
    coalesce(p.a_addr, p.a_deed, 'Unknown'),
    p.a_deed,
    (select name from suburb where id = p.a_suburb_id),
    p.a_extent,
    (select count(*)::int from transfer t where t.property_id = p.a_id),
    (select count(*)::int from listing l where l.property_id = p.a_id),
    (select count(*)::int from erf e where e.property_id = p.a_id),
    p.b_id,
    coalesce(p.b_addr, p.b_deed, 'Unknown'),
    p.b_deed,
    (select name from suburb where id = p.b_suburb_id),
    p.b_extent,
    (select count(*)::int from transfer t where t.property_id = p.b_id),
    (select count(*)::int from listing l where l.property_id = p.b_id),
    (select count(*)::int from erf e where e.property_id = p.b_id),
    round(p.score::numeric, 3)
  from pairs p
  order by p.score desc, p.a_id, p.b_id
  limit p_limit;
$$;

grant execute on function find_property_dupes(numeric, int) to authenticated;

-- ---- find_party_dupes ----------------------------------------------------
-- Same shape for party. Score is max of trigram on display_name, exact
-- id_number match, and exact registration_no match. Only compares within
-- the same party_type (don't cross individuals with juristics).
create or replace function find_party_dupes(
  p_threshold numeric default 0.5,
  p_limit     int     default 50
)
returns table (
  a_id uuid, a_label text, a_type text, a_id_number text, a_reg text,
  a_transfer_count int, a_fica_count int, a_member_count int,
  b_id uuid, b_label text, b_type text, b_id_number text, b_reg text,
  b_transfer_count int, b_fica_count int, b_member_count int,
  score numeric
)
language sql stable as $$
  with pairs as (
    select
      a.id as a_id,
      a.display_name as a_name, a.entity_name as a_entity,
      a.party_type as a_type, a.id_number as a_idnum, a.registration_no as a_reg,
      b.id as b_id,
      b.display_name as b_name, b.entity_name as b_entity,
      b.party_type as b_type, b.id_number as b_idnum, b.registration_no as b_reg,
      greatest(
        case when a.display_name is not null and b.display_name is not null
             then similarity(a.display_name, b.display_name) else 0 end,
        case when nullif(a.id_number, '') is not null and a.id_number = b.id_number
             then 1.0 else 0 end,
        case when nullif(a.registration_no, '') is not null
                  and a.registration_no = b.registration_no
             then 1.0 else 0 end
      ) as score
    from party a
    join party b on a.id < b.id
    where a.party_type = b.party_type
      and (
        (a.display_name is not null and b.display_name is not null
          and similarity(a.display_name, b.display_name) >= p_threshold)
        or (nullif(a.id_number, '') is not null and a.id_number = b.id_number)
        or (nullif(a.registration_no, '') is not null and a.registration_no = b.registration_no)
      )
      and not exists (
        select 1 from dupe_dismissal d
        where d.target_kind = 'party' and d.a_id = a.id and d.b_id = b.id
      )
  )
  select
    p.a_id,
    coalesce(p.a_name, p.a_entity, 'Unknown'),
    p.a_type::text,
    p.a_idnum,
    p.a_reg,
    (select count(*)::int from transfer_party tp where tp.party_id = p.a_id),
    (select count(*)::int from fica f where f.party_id = p.a_id),
    (select count(*)::int from party_member m
      where m.entity_party_id = p.a_id or m.member_party_id = p.a_id),
    p.b_id,
    coalesce(p.b_name, p.b_entity, 'Unknown'),
    p.b_type::text,
    p.b_idnum,
    p.b_reg,
    (select count(*)::int from transfer_party tp where tp.party_id = p.b_id),
    (select count(*)::int from fica f where f.party_id = p.b_id),
    (select count(*)::int from party_member m
      where m.entity_party_id = p.b_id or m.member_party_id = p.b_id),
    round(p.score::numeric, 3)
  from pairs p
  order by p.score desc, p.a_id, p.b_id
  limit p_limit;
$$;

grant execute on function find_party_dupes(numeric, int) to authenticated;

-- ---- dismiss_dupe --------------------------------------------------------
-- Normalises the pair order (a_id < b_id) so the same pair can't be dismissed
-- twice in opposite orders.
create or replace function dismiss_dupe(
  p_target_kind text,
  p_a_id        uuid,
  p_b_id        uuid,
  p_reason      text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lo uuid;
  v_hi uuid;
begin
  if not coalesce(is_admin(), false) then
    raise exception 'not authorised to dismiss';
  end if;
  if p_a_id = p_b_id then
    raise exception 'cannot dismiss a pair with itself';
  end if;
  if p_a_id < p_b_id then
    v_lo := p_a_id; v_hi := p_b_id;
  else
    v_lo := p_b_id; v_hi := p_a_id;
  end if;
  insert into dupe_dismissal (target_kind, a_id, b_id, dismissed_by, reason)
  values (p_target_kind, v_lo, v_hi, auth.uid(), p_reason)
  on conflict (target_kind, a_id, b_id) do nothing;
end; $$;

grant execute on function dismiss_dupe(text, uuid, uuid, text) to authenticated;

-- ---- merge_properties ----------------------------------------------------
-- Winner keeps id + non-null values. Loser's non-null values fill winner's
-- gaps. All FKs repointed; unique-constraint conflicts on the target are
-- resolved by dropping the loser's conflicting row before repointing.
-- Audit row logged; loser deleted. Admin only.
create or replace function merge_properties(
  p_winner uuid,
  p_loser  uuid,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  w property%rowtype;
  l property%rowtype;
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
end; $$;

grant execute on function merge_properties(uuid, uuid, text) to authenticated;

-- ---- merge_parties -------------------------------------------------------
-- Same pattern for party. transfer_party / fica / party_member have unique
-- constraints on (transfer|entity|role, party) shapes that require dropping
-- loser-side clashes before the repoint.
create or replace function merge_parties(
  p_winner uuid,
  p_loser  uuid,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  w party%rowtype;
  l party%rowtype;
begin
  if not coalesce(is_admin(), false) then
    raise exception 'not authorised to merge';
  end if;
  if p_winner = p_loser then
    raise exception 'winner and loser must differ';
  end if;
  select * into w from party where id = p_winner;
  if not found then raise exception 'winner party % not found', p_winner; end if;
  select * into l from party where id = p_loser;
  if not found then raise exception 'loser party % not found', p_loser; end if;
  if w.party_type <> l.party_type then
    raise exception 'cannot merge parties of different types (% vs %)', w.party_type, l.party_type;
  end if;

  -- 1. Fill winner's blanks from loser.
  update party set
    display_name       = coalesce(nullif(w.display_name, ''), nullif(l.display_name, ''), w.display_name),
    first_names        = coalesce(nullif(w.first_names, ''), nullif(l.first_names, '')),
    surname            = coalesce(nullif(w.surname, ''), nullif(l.surname, '')),
    id_number          = coalesce(nullif(w.id_number, ''), nullif(l.id_number, '')),
    passport_no        = coalesce(nullif(w.passport_no, ''), nullif(l.passport_no, '')),
    date_of_birth      = coalesce(w.date_of_birth, l.date_of_birth),
    nationality_id     = coalesce(w.nationality_id, l.nationality_id),
    matrimonial_regime = case when w.matrimonial_regime = 'unknown' then l.matrimonial_regime else w.matrimonial_regime end,
    spouse_party_id    = coalesce(w.spouse_party_id, l.spouse_party_id),
    entity_name        = coalesce(nullif(w.entity_name, ''), nullif(l.entity_name, '')),
    registration_no    = coalesce(nullif(w.registration_no, ''), nullif(l.registration_no, '')),
    tax_residency      = case when w.tax_residency = 'unknown' then l.tax_residency else w.tax_residency end,
    is_vat_registered  = w.is_vat_registered or l.is_vat_registered,
    vat_number         = coalesce(nullif(w.vat_number, ''), nullif(l.vat_number, '')),
    email              = coalesce(w.email, l.email),
    phone              = coalesce(nullif(w.phone, ''), nullif(l.phone, '')),
    whatsapp           = coalesce(nullif(w.whatsapp, ''), nullif(l.whatsapp, '')),
    postal_address     = coalesce(nullif(w.postal_address, ''), nullif(l.postal_address, '')),
    domicilium_address = coalesce(nullif(w.domicilium_address, ''), nullif(l.domicilium_address, '')),
    physical_address   = coalesce(nullif(w.physical_address, ''), nullif(l.physical_address, '')),
    notes = case
      when w.notes is null then l.notes
      when l.notes is null then w.notes
      when w.notes = l.notes then w.notes
      else w.notes || E'\n---\n(merged from ' || p_loser::text || ')\n' || l.notes
    end
  where id = p_winner;

  -- 2. Break any self-marriage that would form (winner married to loser).
  update party set spouse_party_id = null
    where id = p_winner and spouse_party_id = p_loser;
  update party set spouse_party_id = p_winner where spouse_party_id = p_loser;

  -- 3. transfer_party — unique (transfer_id, party_id, side).
  delete from transfer_party lo where lo.party_id = p_loser and exists (
    select 1 from transfer_party wi
    where wi.party_id = p_winner and wi.transfer_id = lo.transfer_id and wi.side = lo.side
  );
  update transfer_party set party_id = p_winner where party_id = p_loser;

  -- 4. fica — unique (transfer_id, party_id, role).
  delete from fica lo where lo.party_id = p_loser and exists (
    select 1 from fica wi
    where wi.party_id = p_winner and wi.transfer_id = lo.transfer_id and wi.role = lo.role
  );
  update fica set party_id = p_winner where party_id = p_loser;

  -- 5. party_member — unique (entity_party_id, member_party_id, role); two sides.
  --    First break any self-membership the merge would create.
  delete from party_member
    where (entity_party_id = p_winner and member_party_id = p_loser)
       or (entity_party_id = p_loser  and member_party_id = p_winner);
  delete from party_member lo where lo.entity_party_id = p_loser and exists (
    select 1 from party_member wi where wi.entity_party_id = p_winner
      and wi.member_party_id = lo.member_party_id and wi.role = lo.role
  );
  update party_member set entity_party_id = p_winner where entity_party_id = p_loser;
  delete from party_member lo where lo.member_party_id = p_loser and exists (
    select 1 from party_member wi where wi.member_party_id = p_winner
      and wi.entity_party_id = lo.entity_party_id and wi.role = lo.role
  );
  update party_member set member_party_id = p_winner where member_party_id = p_loser;

  -- 6. Remaining party references — no unique clashes.
  update property_ownership_history set owner_party_id = p_winner where owner_party_id = p_loser;
  update offer                      set purchaser_party_id = p_winner where purchaser_party_id = p_loser;
  update communication              set party_id = p_winner where party_id = p_loser;
  update consent                    set party_id = p_winner where party_id = p_loser;

  -- 7. document_link — polymorphic; unique (document_id, entity_type, entity_id).
  delete from document_link lo
    where lo.entity_type = 'party' and lo.entity_id = p_loser
      and exists (
        select 1 from document_link wi
        where wi.entity_type = 'party' and wi.entity_id = p_winner
          and wi.document_id = lo.document_id
      );
  update document_link set entity_id = p_winner
    where entity_type = 'party' and entity_id = p_loser;

  -- 8. Clean up dismissals + audit + delete loser.
  delete from dupe_dismissal where target_kind = 'party'
    and (a_id = p_loser or b_id = p_loser);
  insert into audit_log (user_id, action, entity_type, entity_id, justification)
  values (auth.uid(), 'merge', 'party', p_loser,
          'merged into ' || p_winner::text ||
          case when p_reason is null then '' else '; ' || p_reason end);
  delete from party where id = p_loser;
end; $$;

grant execute on function merge_parties(uuid, uuid, text) to authenticated;
