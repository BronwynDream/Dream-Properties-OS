-- ============================================================================
-- Dream Knysna OS — 0012 reconcile: merge 0010 (juristic) + 0011 (matching)
-- ----------------------------------------------------------------------------
-- 0011_matching.sql re-defined upsert_party to honour an explicit linked `id`,
-- but that version dropped the registration_no + members handling that
-- 0010_deep_commit.sql had added. Run AFTER 0011. This restores both:
--   * explicit link from the match-review UI  (0011)
--   * company registration_no + directors/members via party_member  (0010)
-- commit_batch from 0011 is unchanged and correct (adds the property.id link).
-- ============================================================================

create or replace function upsert_party(p jsonb) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_name text := nullif(p->>'display_name', '');
  v_entity text := nullif(p->>'entity_name', '');
  v_idnum text := nullif(p->>'id_number', '');
  v_reg text := nullif(p->>'registration_no', '');
  v_explicit text := nullif(p->>'id', '');
  m jsonb;
  m_id uuid;
begin
  -- 1. Explicit "link to this record" decision from the match-review UI wins.
  if v_explicit is not null then
    begin
      select id into v_id from party where id = v_explicit::uuid;
    exception when others then
      v_id := null;  -- malformed uuid → fall through to match-or-create
    end;
  end if;

  -- 2. Otherwise match by id number, then by entity name.
  if v_id is null and v_idnum is not null then
    select id into v_id from party where id_number = v_idnum limit 1;
  end if;
  if v_id is null and v_entity is not null then
    select id into v_id from party where lower(entity_name) = lower(v_entity) limit 1;
  end if;

  -- 3. Create if still unmatched; else fill in a registration number we lacked.
  if v_id is null then
    if v_name is null and v_entity is null then return null; end if;
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
  elsif v_reg is not null then
    update party set registration_no = coalesce(registration_no, v_reg) where id = v_id;
  end if;

  -- 4. Members / directors / shareholders / trustees (restored from 0010).
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
