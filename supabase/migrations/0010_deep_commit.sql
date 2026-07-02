-- ============================================================================
-- Dream Knysna OS — 0010 deep commit: juristic parties (registration + members)
-- ----------------------------------------------------------------------------
-- Extends the commit so a company/CC/trust/partnership party also stores its
-- registration number and its directors / members / shareholders (party_member).
-- Uses create-or-replace, so it cleanly supersedes 0009's upsert_party.
-- ============================================================================

create or replace function to_fica_role(t text) returns fica_role
language plpgsql immutable as $$
begin
  return coalesce(nullif(lower(btrim(t)), '')::fica_role, 'member');
exception when others then return 'member';
end; $$;

-- Match-or-create a natural person by id number, else by name.
create or replace function upsert_individual(v_name text, v_idnum text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  if nullif(btrim(coalesce(v_name, '')), '') is null and nullif(btrim(coalesce(v_idnum, '')), '') is null then
    return null;
  end if;
  if v_idnum is not null and btrim(v_idnum) <> '' then
    select id into v_id from party where id_number = v_idnum limit 1;
  end if;
  if v_id is null and v_name is not null then
    select id into v_id from party where lower(display_name) = lower(v_name) limit 1;
  end if;
  if v_id is null then
    insert into party (party_type, display_name, id_number)
    values ('individual', coalesce(nullif(btrim(v_name), ''), 'Unknown'), nullif(btrim(v_idnum), ''))
    returning id into v_id;
  end if;
  return v_id;
end; $$;

-- Replaces 0009's upsert_party: now also stores registration_no and members.
create or replace function upsert_party(p jsonb) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_name text := nullif(p->>'display_name', '');
  v_entity text := nullif(p->>'entity_name', '');
  v_idnum text := nullif(p->>'id_number', '');
  v_reg text := nullif(p->>'registration_no', '');
  m jsonb; m_id uuid;
begin
  if v_name is null and v_entity is null then return null; end if;

  if v_idnum is not null then
    select id into v_id from party where id_number = v_idnum limit 1;
  end if;
  if v_id is null and v_entity is not null then
    select id into v_id from party where lower(entity_name) = lower(v_entity) limit 1;
  end if;

  if v_id is null then
    insert into party (party_type, display_name, entity_name, id_number, registration_no, matrimonial_regime)
    values (
      to_party_type(p->>'party_type'),
      coalesce(v_name, v_entity),
      v_entity,
      v_idnum,
      v_reg,
      map_regime(p->>'matrimonial_regime')
    )
    returning id into v_id;
  else
    -- fill in a registration number we didn't have before
    update party set registration_no = coalesce(registration_no, v_reg) where id = v_id;
  end if;

  -- members / directors / shareholders / trustees
  for m in select * from jsonb_array_elements(coalesce(p->'members', '[]'::jsonb))
  loop
    m_id := upsert_individual(nullif(m->>'name', ''), nullif(m->>'id_number', ''));
    if m_id is not null and m_id <> v_id then
      insert into party_member (entity_party_id, member_party_id, role, share_pct)
      values (v_id, m_id, to_fica_role(m->>'role'), safe_numeric(m->>'share_pct'))
      on conflict (entity_party_id, member_party_id, role) do nothing;
    end if;
  end loop;

  return v_id;
end; $$;
