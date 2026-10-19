-- Access check for migration 0086 (agent access rules). Paste into Supabase
-- Studio → SQL editor and Run. NOTHING IS KEPT: it runs inside a transaction
-- that ends in ROLLBACK.
--
-- It invents a stand-in agent ("Test Agent"), puts them on ONE deal, then
-- switches to that login (role authenticated + their JWT) and asks the
-- database what they can see and do. The last result table shows each check
-- with expected vs actual and PASS / FAIL.

begin;

-- ---------------------------------------------------------------------------
-- Setup, as the database owner
-- ---------------------------------------------------------------------------
create temp table _t (n int, check_name text, expected text, actual text, ok boolean) on commit drop;
create temp table _ids (k text primary key, v uuid) on commit drop;
grant all on _t, _ids to authenticated;

-- The stand-in agent: a login and a roster row linked to it.
insert into _ids values ('me', gen_random_uuid());
insert into app_user (id, full_name, email, role, active)
  select v, 'Test Agent (rolled back)', 'test-agent-0086@invalid.example', 'agent', true from _ids where k = 'me';
insert into agent (full_name, email, app_user_id, active)
  select 'Test Agent (rolled back)', 'test-agent-0086@invalid.example', v, true from _ids where k = 'me';

-- MY deal: a transfer with a seller on it; the test agent becomes its lead.
insert into _ids
  select 'my_transfer', t.id from transfer t
   where exists (select 1 from transfer_party tp where tp.transfer_id = t.id and tp.side = 'seller')
   order by t.created_at desc limit 1;
update transfer set lead_agent_user_id = (select v from _ids where k = 'me')
 where id = (select v from _ids where k = 'my_transfer');
insert into _ids select 'my_property', property_id from transfer where id = (select v from _ids where k = 'my_transfer');

-- SOMEONE ELSE's deal: a transfer with a seller, on a different property,
-- that the test agent has nothing to do with.
insert into _ids
  select 'other_transfer', t.id from transfer t
   where t.property_id <> (select v from _ids where k = 'my_property')
     and exists (select 1 from transfer_party tp where tp.transfer_id = t.id and tp.side = 'seller')
   order by t.created_at desc limit 1;
insert into _ids select 'other_property', property_id from transfer where id = (select v from _ids where k = 'other_transfer');
insert into _ids
  select 'other_seller', tp.party_id from transfer_party tp
   where tp.transfer_id = (select v from _ids where k = 'other_transfer') and tp.side = 'seller' limit 1;
insert into _ids
  select 'my_seller', tp.party_id from transfer_party tp
   where tp.transfer_id = (select v from _ids where k = 'my_transfer') and tp.side = 'seller' limit 1;

-- A listing on MY deal with the test agent on it (the listing_agent path).
insert into _ids values ('my_listing', gen_random_uuid());
insert into listing (id, property_id, transfer_id, status)
  select (select v from _ids where k = 'my_listing'), (select v from _ids where k = 'my_property'),
         (select v from _ids where k = 'my_transfer'), 'draft';
insert into listing_agent (listing_id, agent_id, position)
  select (select v from _ids where k = 'my_listing'), a.id, 1 from agent a where a.app_user_id = (select v from _ids where k = 'me');
-- A contact owned by somebody else (a director), linked to MY deal.
update party set owner_user_id = (select id from app_user where role = 'admin' and active order by id limit 1)
 where id = (select v from _ids where k = 'my_seller');
-- A document filed on MY property but belonging to the OTHER deal (the way
-- intake links paperwork to both): must stay hidden.
insert into _ids values ('mixed_doc', gen_random_uuid());
insert into document (id, title, storage_path, is_pii)
  select (select v from _ids where k = 'mixed_doc'), 'Test ID copy (rolled back)', 'test/0086/mixed.pdf', true;
insert into document_link (document_id, entity_type, entity_id) values
  ((select v from _ids where k = 'mixed_doc'), 'property', (select v from _ids where k = 'my_property')),
  ((select v from _ids where k = 'mixed_doc'), 'transfer', (select v from _ids where k = 'other_transfer'));
-- A sale in progress on the OTHER property, with an agreed price.
insert into _ids values ('busy_transfer', gen_random_uuid());
insert into transfer (id, property_id, name, status)
  select (select v from _ids where k = 'busy_transfer'), (select v from _ids where k = 'other_property'), 'Test in progress (rolled back)', 'sale_agreed';
insert into agreement (transfer_id, price) select (select v from _ids where k = 'busy_transfer'), 987654321;

create temp table _n (k text primary key, v bigint) on commit drop;
grant all on _n to authenticated;
insert into _n select 'parties_total', count(*) from party;
insert into _n select 'other_completed', count(*) from transfer
 where property_id = (select v from _ids where k = 'other_property')
   and (status in ('registered', 'sold_external') or registered_date is not null);
insert into _t values (0, 'setup: deals found', 'mine + other',
  (select count(*) from _ids where k in ('my_transfer','other_transfer'))::text || ' of 2',
  (select count(*) from _ids where k in ('my_transfer','other_transfer')) = 2);

-- ---------------------------------------------------------------------------
-- Become the stand-in agent
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from _ids where k = 'me'), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into _t select 1, 'is_staff() for an agent', 'true', is_staff()::text, is_staff();
insert into _t select 2, 'is_admin() for an agent', 'false', is_admin()::text, not is_admin();

-- Public facts: everything the map needs.
insert into _t select 3, 'sees every property', 'all', (select count(*) from property)::text, (select count(*) from property) > 1;
insert into _t select 4, 'sees every listing', 'all', (select count(*) from listing)::text, (select count(*) from listing) > 1;
insert into _t select 5, 'transfer_public (map) shows all deals', 'many', (select count(*) from transfer_public)::text, (select count(*) from transfer_public) > 1;
insert into _t select 6, 'past sales of the OTHER property = its completed sales only',
  (select v from _n where k = 'other_completed')::text,
  (select count(*) from property_sales((select v from _ids where k = 'other_property')))::text,
  (select count(*) from property_sales((select v from _ids where k = 'other_property'))) = (select v from _n where k = 'other_completed');

-- My deal: full detail.
insert into _t select 10, 'sees MY transfer', '1',
  (select count(*) from transfer where id = (select v from _ids where k = 'my_transfer'))::text,
  (select count(*) from transfer where id = (select v from _ids where k = 'my_transfer')) = 1;
insert into _t select 11, 'sees MY seller', '1',
  (select count(*) from party where id = (select v from _ids where k = 'my_seller'))::text,
  (select count(*) from party where id = (select v from _ids where k = 'my_seller')) = 1;
insert into _t select 12, 'sees MY deal''s parties link', '≥1',
  (select count(*) from transfer_party where transfer_id = (select v from _ids where k = 'my_transfer'))::text,
  (select count(*) from transfer_party where transfer_id = (select v from _ids where k = 'my_transfer')) >= 1;

-- Someone else's deal: nothing sensitive.
insert into _t select 20, 'OTHER transfer hidden', '0',
  (select count(*) from transfer where id = (select v from _ids where k = 'other_transfer'))::text,
  (select count(*) from transfer where id = (select v from _ids where k = 'other_transfer')) = 0;
insert into _t select 21, 'OTHER seller hidden', '0',
  (select count(*) from party where id = (select v from _ids where k = 'other_seller'))::text,
  (select count(*) from party where id = (select v from _ids where k = 'other_seller')) = 0;
insert into _t select 22, 'OTHER deal: parties link hidden', '0',
  (select count(*) from transfer_party where transfer_id = (select v from _ids where k = 'other_transfer'))::text,
  (select count(*) from transfer_party where transfer_id = (select v from _ids where k = 'other_transfer')) = 0;
insert into _t select 23, 'OTHER deal: offers hidden', '0',
  (select count(*) from offer where transfer_id = (select v from _ids where k = 'other_transfer'))::text,
  (select count(*) from offer where transfer_id = (select v from _ids where k = 'other_transfer')) = 0;
insert into _t select 24, 'OTHER deal: agreements hidden', '0',
  (select count(*) from agreement where transfer_id = (select v from _ids where k = 'other_transfer'))::text,
  (select count(*) from agreement where transfer_id = (select v from _ids where k = 'other_transfer')) = 0;
insert into _t select 25, 'OTHER deal: documents hidden', '0',
  (select count(*) from document_link where entity_type = 'transfer' and entity_id = (select v from _ids where k = 'other_transfer'))::text,
  (select count(*) from document_link where entity_type = 'transfer' and entity_id = (select v from _ids where k = 'other_transfer')) = 0;
insert into _t select 26, 'OTHER property: ownership history hidden', '0',
  (select count(*) from property_ownership_history where property_id = (select v from _ids where k = 'other_property'))::text,
  (select count(*) from property_ownership_history where property_id = (select v from _ids where k = 'other_property')) = 0;
insert into _t select 27, 'sees only a few of all parties', 'far fewer than ' || (select v from _n where k = 'parties_total'),
  (select count(*) from party)::text,
  (select count(*) from party) < greatest(10, (select v from _n where k = 'parties_total') / 4);

-- Things that must be refused.
do $$
begin
  perform owner from muni_property limit 1;
  insert into _t values (30, 'muni owner column refused', 'refused', 'allowed', false);
exception when insufficient_privilege then
  insert into _t values (30, 'muni owner column refused', 'refused', sqlerrm, true);
end $$;
do $$
begin
  perform sg_number, erf_number, street_name from muni_property limit 1;
  insert into _t values (31, 'muni roll still searchable', 'allowed', 'allowed', true);
exception when others then
  insert into _t values (31, 'muni roll still searchable', 'allowed', sqlerrm, false);
end $$;
do $$
begin
  perform mark_transfer_sold((select v from _ids where k = 'other_transfer'), 'other', 'test');
  insert into _t values (32, 'mark OTHER deal sold refused', 'refused', 'allowed', false);
exception when others then
  insert into _t values (32, 'mark OTHER deal sold refused', 'refused', sqlerrm, true);
end $$;
do $$
declare n int;
begin
  update transfer set notes = coalesce(notes, '') where id = (select v from _ids where k = 'other_transfer');
  get diagnostics n = row_count;
  insert into _t values (33, 'edit OTHER deal refused', '0 rows', n || ' rows', n = 0);
end $$;
do $$
declare n int;
begin
  update transfer set notes = coalesce(notes, '') where id = (select v from _ids where k = 'my_transfer');
  get diagnostics n = row_count;
  insert into _t values (34, 'edit MY deal allowed', '1 row', n || ' rows', n = 1);
end $$;
do $$
begin
  insert into party (party_type, display_name, owner_user_id)
    values ('individual', 'Test Contact (rolled back)', (select v from _ids where k = 'me'));
  insert into _t values (35, 'add MY contact', 'allowed', 'allowed', true);
exception when others then
  insert into _t values (35, 'add MY contact', 'allowed', sqlerrm, false);
end $$;
do $$
begin
  insert into party (party_type, display_name) values ('individual', 'Unowned (rolled back)');
  insert into _t values (36, 'add an unowned contact refused', 'refused', 'allowed', false);
exception when others then
  insert into _t values (36, 'add an unowned contact refused', 'refused', sqlerrm, true);
end $$;

do $$
begin
  update transfer set property_id = (select v from _ids where k = 'other_property')
   where id = (select v from _ids where k = 'my_transfer');
  insert into _t values (37, 'move MY deal onto another property refused', 'refused', 'allowed', false);
exception when others then
  insert into _t values (37, 'move MY deal onto another property refused', 'refused', sqlerrm, true);
end $$;
do $$
begin
  update transfer set lead_agent_user_id = null where id = (select v from _ids where k = 'my_transfer');
  insert into _t values (38, 'change MY deal''s lead agent refused', 'refused', 'allowed', false);
exception when others then
  insert into _t values (38, 'change MY deal''s lead agent refused', 'refused', sqlerrm, true);
end $$;

do $$
begin
  update listing set transfer_id = (select v from _ids where k = 'other_transfer') where id = (select v from _ids where k = 'my_listing');
  insert into _t values (40, 're-point MY listing at the OTHER deal refused', 'refused', 'allowed', false);
exception when others then
  insert into _t values (40, 're-point MY listing at the OTHER deal refused', 'refused', sqlerrm, true);
end $$;
do $$
begin
  insert into transfer_party (transfer_id, party_id, side) values
    ((select v from _ids where k = 'my_transfer'), (select v from _ids where k = 'other_seller'), 'purchaser');
  insert into _t values (41, 'link the OTHER seller onto MY deal refused', 'refused', 'allowed', false);
exception when others then
  insert into _t values (41, 'link the OTHER seller onto MY deal refused', 'refused', sqlerrm, true);
end $$;
do $$
begin
  insert into offer (transfer_id, purchaser_party_id) values
    ((select v from _ids where k = 'my_transfer'), (select v from _ids where k = 'other_seller'));
  insert into _t values (42, 'offer naming the OTHER seller refused', 'refused', 'allowed', false);
exception when others then
  insert into _t values (42, 'offer naming the OTHER seller refused', 'refused', sqlerrm, true);
end $$;
do $$
begin
  insert into party_member (entity_party_id, member_party_id) values
    ((select v from _ids where k = 'my_seller'), (select v from _ids where k = 'other_seller'));
  insert into _t values (43, 'member link to the OTHER seller refused', 'refused', 'allowed', false);
exception when others then
  insert into _t values (43, 'member link to the OTHER seller refused', 'refused', sqlerrm, true);
end $$;
insert into _t select 44, 'OTHER deal''s paper filed on MY property hidden', '0',
  (select count(*) from document where id = (select v from _ids where k = 'mixed_doc'))::text,
  (select count(*) from document where id = (select v from _ids where k = 'mixed_doc')) = 0;
do $$
begin
  insert into document_draft (template_id, property_id, transfer_id, created_by) values
    ((select id from doc_template order by sort_order limit 1),
     (select v from _ids where k = 'my_property'), (select v from _ids where k = 'other_transfer'), (select v from _ids where k = 'me'));
  insert into _t values (45, 'draft pointed at the OTHER deal refused', 'refused', 'allowed', false);
exception when others then
  insert into _t values (45, 'draft pointed at the OTHER deal refused', 'refused', sqlerrm, true);
end $$;
insert into _t select 46, 'price of a sale in progress not in past sales', 'absent',
  case when exists (select 1 from property_sales((select v from _ids where k = 'other_property')) where price = 987654321) then 'shown' else 'absent' end,
  not exists (select 1 from property_sales((select v from _ids where k = 'other_property')) where price = 987654321);
do $$
begin
  update party set owner_user_id = (select v from _ids where k = 'me') where id = (select v from _ids where k = 'my_seller');
  insert into _t values (47, 'take over a director''s contact refused', 'refused', 'allowed', false);
exception when others then
  insert into _t values (47, 'take over a director''s contact refused', 'refused', sqlerrm, true);
end $$;
insert into _t select 48, 'MY listing''s mandate kind via mandate_public', 'readable', 'readable', true
  where exists (select 1 from information_schema.views where table_name = 'mandate_public');

-- The real job still works: save a mandate on MY listing, keep its draft,
-- put the listing live, save a draft version.
do $$
declare mid uuid; did uuid;
begin
  insert into mandate (listing_id, type) values ((select v from _ids where k = 'my_listing'), 'exclusive') returning id into mid;
  insert into document_draft (template_id, property_id, listing_id, mandate_id, created_by)
    values ((select id from doc_template where code = 'mandate_exclusive'),
            (select v from _ids where k = 'my_property'), (select v from _ids where k = 'my_listing'), mid, (select v from _ids where k = 'me'))
    returning id into did;
  insert into document_draft_version (draft_id, version, field_values, clause_selections, clause_overrides, omitted_clauses)
    values (did, 1, '{}', '{}', '{}', '[]');
  update listing set status = 'live' where id = (select v from _ids where k = 'my_listing');
  insert into _t values (50, 'save a mandate + draft on MY listing, put it live', 'allowed', 'allowed', true);
exception when others then
  insert into _t values (50, 'save a mandate + draft on MY listing, put it live', 'allowed', sqlerrm, false);
end $$;

reset role;
-- Deactivate the stand-in agent: every deal must close to them.
update app_user set active = false where id = (select v from _ids where k = 'me');
set local role authenticated;
insert into _t select 49, 'deactivated agent loses MY deal', '0',
  (select count(*) from transfer where id = (select v from _ids where k = 'my_transfer'))::text,
  (select count(*) from transfer where id = (select v from _ids where k = 'my_transfer')) = 0;

reset role;
insert into _t select 99, 'directors (role admin, active) — should be Bronwyn, Camilla, Simon', 'check by eye',
  coalesce((select string_agg(full_name || ' <' || coalesce(email::text, '?') || '>', ', ' order by full_name)
              from app_user where role = 'admin' and active and email <> 'test-agent-0086@invalid.example'), 'none'),
  true;

-- Report: raised as an error so the whole test rolls back.
do $$
declare rep text;
begin
  select string_agg(
           lpad(n::text, 2) || '  ' || case when ok then 'PASS' else 'FAIL' end || '  ' || check_name
           || '  (expected ' || expected || ', got ' || actual || ')', E'\n' order by n)
    into rep from _t;
  raise exception E'ACCESS CHECK 0086 — % of % passed (everything rolled back)\n%',
    (select count(*) from _t where ok), (select count(*) from _t), rep;
end $$;
