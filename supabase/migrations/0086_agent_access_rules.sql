-- Dream Knysna OS — 0086 agent access rules (2026-10-19)
--
-- Simon, verbatim (2026-10-17):
--   "Agents should only see their own sellers details nobody else's"
--   "so Bronwyn should be able to see any of the property records, Vanessa
--    should only see the deals that Bronwyn and her are working on."
--   "yes the map should show all listings to all agents. the OS should not
--    show the sensitive details of the transaction or the owners or any
--    buyers that are loaded for that particular property etc"
-- and his answers on 2026-10-19:
--   * another agent's property opens with PUBLIC FACTS ONLY (address, erf,
--     size, photos, asking price, listing agent) — no parties, offers,
--     documents or deal terms;
--   * directors (role admin) are Bronwyn, Camilla and Simon — see everything;
--   * contacts an agent loads are theirs (plus directors);
--   * past sales on any property: date and price only (deeds-office facts).
--
-- Before this migration every active login could read every party, offer,
-- agreement, commission, document and FICA-adjacent row (0005 gave the
-- business tables `is_staff()` read). This replaces those reads.
--
-- The model:
--   "works on" a listing  = on listing_agent for it (active agent row linked
--                           to this login), or listing.agent_user_id = me.
--   "works on" a transfer = transfer lead, or works on a listing that sits
--                           on that transfer.
--   "works on" a property = works on any listing of it, or leads a transfer
--                           on it.
--   A party is visible to directors, to the agent who owns the contact
--   (party.owner_user_id), and to anyone who works on a transfer the party
--   is on (seller / buyer / offer purchaser), or a viewing they ran.
-- Directors pass every check through is_admin().
--
-- Public to every agent (unchanged): property, erf, listing, listing_agent,
-- agent, listing_price_history, media, external_listing, suburb & the other
-- lookups, estates, cadastral parcels, the clause library, compliance certs.
-- The municipal roll stays readable EXCEPT the owner column.
--
-- Agents can now write on their own deals (Simon: "the agent can add the
-- sellers details as well as all the other available documents"): parties
-- on their transfers, transfers, offers, agreements, milestones, mandates,
-- disclosure, inventory, viewings, FICA, communications, drafts. Commission
-- stays director-write. Deletes stay director-only everywhere.
--
-- Apply in one transaction. Safe to re-run (drop-if-exists throughout).

-- ---------------------------------------------------------------------------
-- 0. "Staff" means a director or an agent. Conveyancer / client roles are
--    reserved for external portals and must not inherit staff reads.
-- ---------------------------------------------------------------------------
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_user
    where id = auth.uid() and active and role in ('admin', 'agent')
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. Helpers. SECURITY DEFINER so they read the link tables without
--    re-entering RLS (no policy recursion); each one only ever answers
--    "may auth.uid() …?".
-- ---------------------------------------------------------------------------
create or replace function works_on_listing(lid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select lid is not null and is_staff() and (
    is_admin()
    or exists (select 1 from listing l where l.id = lid and l.agent_user_id = auth.uid())
    or exists (
      select 1
        from listing_agent la
        join agent a on a.id = la.agent_id
       where la.listing_id = lid and a.app_user_id = auth.uid() and a.active
    )
  );
$$;

create or replace function works_on_transfer(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select tid is not null and is_staff() and (
    is_admin()
    or exists (select 1 from transfer t where t.id = tid and t.lead_agent_user_id = auth.uid())
    or exists (select 1 from listing l where l.transfer_id = tid and works_on_listing(l.id))
  );
$$;

create or replace function works_on_property(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pid is not null and is_staff() and (
    is_admin()
    or exists (select 1 from listing l where l.property_id = pid and works_on_listing(l.id))
    or exists (select 1 from transfer t where t.property_id = pid and t.lead_agent_user_id = auth.uid())
  );
$$;

create or replace function can_see_party(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pid is not null and is_staff() and (
    is_admin()
    or exists (select 1 from party p where p.id = pid and p.owner_user_id = auth.uid())
    or exists (select 1 from transfer_party tp where tp.party_id = pid and works_on_transfer(tp.transfer_id))
    or exists (select 1 from offer o where o.purchaser_party_id = pid and works_on_transfer(o.transfer_id))
    -- a person who is a member / signatory of an entity on one of my deals
    or exists (
      select 1 from party_member pm
        join transfer_party tp on tp.party_id = pm.entity_party_id
       where pm.member_party_id = pid and works_on_transfer(tp.transfer_id)
    )
    or exists (
      select 1 from viewing_attendee va
        join viewing v on v.id = va.viewing_id
       where va.party_id = pid
         and (v.agent_user_id = auth.uid() or works_on_listing(v.listing_id) or works_on_transfer(v.transfer_id))
    )
  );
$$;

-- What a document link exposes: the entity it's attached to decides.
create or replace function can_see_link(etype text, eid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case etype
    when 'property'  then works_on_property(eid)
    when 'transfer'  then works_on_transfer(eid)
    when 'listing'   then works_on_listing(eid)
    when 'mandate'   then exists (select 1 from mandate m where m.id = eid and works_on_listing(m.listing_id))
    when 'agreement' then exists (select 1 from agreement a where a.id = eid and works_on_transfer(a.transfer_id))
    when 'party'     then can_see_party(eid)
    when 'fica'      then exists (select 1 from fica f where f.id = eid and works_on_transfer(f.transfer_id))
    -- estate rules, design manuals: office knowledge, not deal data
    when 'estate'    then is_staff()
    else is_admin()
  end;
$$;

-- Past sales on a property, for any agent: dates and price only, no names
-- (Simon: "Date and price only"). Price is the newest agreement's price.
create or replace function property_sales(p_property_id uuid)
returns table (
  transfer_id     uuid,
  status          transfer_status,
  transfer_date   date,
  registered_date date,
  price           numeric
)
language sql stable security definer set search_path = public as $$
  select t.id, t.status, t.transfer_date, t.registered_date,
         (select a.price from agreement a
           where a.transfer_id = t.id and a.price is not null
           order by a.version desc, a.created_at desc limit 1)
    from transfer t
   where is_staff()
     and t.property_id = p_property_id
     -- completed sales only: a deal still in progress keeps its price private
     and (t.status in ('registered', 'sold_external') or t.registered_date is not null)
   order by coalesce(t.registered_date, t.transfer_date, t.opened_date) desc nulls last;
$$;

-- The map shows every listing to every agent, with its mandate kind and
-- whether / when it sold. These two views carry exactly those columns, for
-- staff, without the deal's name (which holds the parties' names) or terms.
-- They run as their owner (no security_invoker), so they see past RLS; the
-- where-clause is the gate.
create or replace view transfer_public with (security_barrier) as
  select id, property_id, status, opened_date, transfer_date, registered_date, sold_by, created_at
    from transfer
   where is_staff();
create or replace view mandate_public with (security_barrier) as
  select id, listing_id, type, evidence, expiry_date
    from mandate
   where is_staff();
revoke all on transfer_public, mandate_public from anon;
grant select on transfer_public, mandate_public to authenticated;

grant execute on function works_on_listing(uuid), works_on_transfer(uuid), works_on_property(uuid),
                          can_see_party(uuid), can_see_link(text, uuid), property_sales(uuid)
  to authenticated;

-- A document is visible when one of its links is, and none of its
-- deal-level links is hidden: intake and finalise link a deal's paperwork to
-- the property too, and a later agent on the property must not inherit an
-- earlier deal's ID copies and OTPs through that property link.
create or replace function can_see_document(did uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_staff() and (
    is_admin()
    or (
      exists (select 1 from document_link dl where dl.document_id = did and can_see_link(dl.entity_type, dl.entity_id))
      and not exists (
        select 1 from document_link dl
         where dl.document_id = did
           and dl.entity_type in ('transfer', 'mandate', 'agreement', 'party', 'fica', 'listing')
           and not can_see_link(dl.entity_type, dl.entity_id)
      )
    )
    or exists (select 1 from document d where d.id = did and d.uploaded_by = auth.uid()
                 and not exists (select 1 from document_link dl where dl.document_id = did))
  );
$$;
grant execute on function can_see_document(uuid) to authenticated;

-- A small helper to replace a table's 0005 read/write pair.
-- (Policies below are written out in full; this just drops the old ones.)
do $$
declare t text;
begin
  foreach t in array array[
    'party','party_member','transfer','transfer_party','mandate','cma','offer','agreement',
    'suspensive_condition','milestone','commission','property_ownership_history','listing',
    'listing_price_history'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. People
-- ---------------------------------------------------------------------------
drop policy if exists party_select on party;
drop policy if exists party_insert on party;
drop policy if exists party_update on party;
drop policy if exists party_delete on party;
create policy party_select on party for select using (owner_user_id = auth.uid() and is_staff() or can_see_party(id));
-- An agent's new contact is theirs; directors may create unowned rows.
create policy party_insert on party for insert with check (is_admin() or owner_user_id = auth.uid());
create policy party_update on party for update using (can_see_party(id)) with check (can_see_party(id) or owner_user_id = auth.uid());
create policy party_delete on party for delete using (is_admin());

drop policy if exists party_member_select on party_member;
drop policy if exists party_member_write on party_member;
create policy party_member_select on party_member for select using (can_see_party(entity_party_id));
create policy party_member_write on party_member for all
  using (can_see_party(entity_party_id))
  with check (can_see_party(entity_party_id) and can_see_party(member_party_id));

-- ---------------------------------------------------------------------------
-- 3. Deals
-- ---------------------------------------------------------------------------
drop policy if exists transfer_select on transfer;
drop policy if exists transfer_insert on transfer;
drop policy if exists transfer_update on transfer;
drop policy if exists transfer_delete on transfer;
create policy transfer_select on transfer for select using (works_on_transfer(id));
create policy transfer_insert on transfer for insert with check (is_admin() or works_on_property(property_id));
create policy transfer_update on transfer for update using (works_on_transfer(id)) with check (works_on_transfer(id));
create policy transfer_delete on transfer for delete using (is_admin());

-- Tables hanging off a transfer: read and write on your own deals, delete as director.
do $$
declare t text;
begin
  foreach t in array array['transfer_party','offer','agreement','milestone','transfer_inventory'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for select using (works_on_transfer(transfer_id))', t || '_select', t);
    execute format('create policy %I on %I for insert with check (works_on_transfer(transfer_id))', t || '_insert', t);
    execute format('create policy %I on %I for update using (works_on_transfer(transfer_id)) with check (works_on_transfer(transfer_id))', t || '_update', t);
    if t = 'transfer_party' then
      -- you can only put a person on your deal if you could already see them
      execute format('drop policy if exists %I on %I', t || '_insert', t);
      execute format('drop policy if exists %I on %I', t || '_update', t);
      execute format('create policy %I on %I for insert with check (works_on_transfer(transfer_id) and can_see_party(party_id))', t || '_insert', t);
      execute format('create policy %I on %I for update using (works_on_transfer(transfer_id)) with check (works_on_transfer(transfer_id) and can_see_party(party_id))', t || '_update', t);
    elsif t = 'offer' then
      execute format('drop policy if exists %I on %I', t || '_insert', t);
      execute format('drop policy if exists %I on %I', t || '_update', t);
      execute format('create policy %I on %I for insert with check (works_on_transfer(transfer_id) and (purchaser_party_id is null or can_see_party(purchaser_party_id)))', t || '_insert', t);
      execute format('create policy %I on %I for update using (works_on_transfer(transfer_id)) with check (works_on_transfer(transfer_id) and (purchaser_party_id is null or can_see_party(purchaser_party_id)))', t || '_update', t);
    end if;
    execute format('create policy %I on %I for delete using (is_admin())', t || '_delete', t);
  end loop;
end $$;
drop policy if exists transfer_inventory_read on transfer_inventory;
drop policy if exists transfer_inventory_write on transfer_inventory;

drop policy if exists suspensive_condition_select on suspensive_condition;
drop policy if exists suspensive_condition_write on suspensive_condition;
create policy suspensive_condition_select on suspensive_condition for select
  using (exists (select 1 from agreement a where a.id = agreement_id and works_on_transfer(a.transfer_id)));
create policy suspensive_condition_write on suspensive_condition for all
  using (exists (select 1 from agreement a where a.id = agreement_id and works_on_transfer(a.transfer_id)))
  with check (exists (select 1 from agreement a where a.id = agreement_id and works_on_transfer(a.transfer_id)));

-- Commission: agents on the deal may read it; only directors change money.
drop policy if exists commission_select on commission;
drop policy if exists commission_write on commission;
create policy commission_select on commission for select using (works_on_transfer(transfer_id));
create policy commission_write on commission for all using (is_admin()) with check (is_admin());

-- Listings are public facts (the map shows them all). Agents update their own;
-- new listings come from directors or the server-side take-on (service role).
drop policy if exists listing_select on listing;
drop policy if exists listing_insert on listing;
drop policy if exists listing_update on listing;
drop policy if exists listing_delete on listing;
create policy listing_select on listing for select using (is_staff());
create policy listing_insert on listing for insert with check (is_admin());
create policy listing_update on listing for update using (works_on_listing(id)) with check (works_on_listing(id));
create policy listing_delete on listing for delete using (is_admin());

drop policy if exists listing_price_history_select on listing_price_history;
drop policy if exists listing_price_history_write on listing_price_history;
create policy listing_price_history_select on listing_price_history for select using (is_staff());
create policy listing_price_history_write on listing_price_history for all
  using (works_on_listing(listing_id)) with check (works_on_listing(listing_id));

-- Mandate terms (commission %, term) and CMAs belong to the listing's agents.
drop policy if exists mandate_select on mandate;
drop policy if exists mandate_write on mandate;
create policy mandate_select on mandate for select using (works_on_listing(listing_id));
drop policy if exists mandate_insert on mandate;
create policy mandate_insert on mandate for insert with check (works_on_listing(listing_id));
drop policy if exists mandate_update on mandate;
create policy mandate_update on mandate for update using (works_on_listing(listing_id)) with check (works_on_listing(listing_id));
drop policy if exists mandate_delete on mandate;
create policy mandate_delete on mandate for delete using (is_admin());

drop policy if exists cma_select on cma;
drop policy if exists cma_write on cma;
create policy cma_select on cma for select using (works_on_listing(listing_id));
create policy cma_write on cma for all using (works_on_listing(listing_id)) with check (works_on_listing(listing_id));

-- Owners over time: names, so deal agents and directors only.
drop policy if exists property_ownership_history_select on property_ownership_history;
drop policy if exists property_ownership_history_write on property_ownership_history;
create policy property_ownership_history_select on property_ownership_history for select using (works_on_property(property_id));
create policy property_ownership_history_write on property_ownership_history for all using (is_admin()) with check (is_admin());

-- Lightstone market data carries owner names.
drop policy if exists "market staff read" on market_property;
drop policy if exists market_property_select on market_property;
create policy market_property_select on market_property for select
  using (is_admin() or works_on_property(matched_property_id));

-- PPRA disclosure (seller's defect answers).
drop policy if exists ppra_disclosure_read on ppra_disclosure;
drop policy if exists ppra_disclosure_write on ppra_disclosure;
create policy ppra_disclosure_read on ppra_disclosure for select using (works_on_transfer(transfer_id));
create policy ppra_disclosure_write on ppra_disclosure for all
  using (works_on_transfer(transfer_id)) with check (works_on_transfer(transfer_id));
drop policy if exists ppra_disclosure_row_read on ppra_disclosure_answer_row;
drop policy if exists ppra_disclosure_row_write on ppra_disclosure_answer_row;
create policy ppra_disclosure_row_read on ppra_disclosure_answer_row for select
  using (exists (select 1 from ppra_disclosure d where d.id = disclosure_id and works_on_transfer(d.transfer_id)));
create policy ppra_disclosure_row_write on ppra_disclosure_answer_row for all
  using (exists (select 1 from ppra_disclosure d where d.id = disclosure_id and works_on_transfer(d.transfer_id)))
  with check (exists (select 1 from ppra_disclosure d where d.id = disclosure_id and works_on_transfer(d.transfer_id)));

-- FICA and communications: deal agents (was: transfer lead only).
drop policy if exists fica_read on fica;
drop policy if exists fica_write on fica;
create policy fica_read on fica for select using (works_on_transfer(transfer_id));
create policy fica_write on fica for all using (works_on_transfer(transfer_id)) with check (works_on_transfer(transfer_id));

drop policy if exists comm_read on communication;
drop policy if exists comm_write on communication;
create policy comm_read on communication for select using (
  is_admin()
  or works_on_transfer(transfer_id)
  or (transfer_id is null and works_on_property(property_id))
  or (transfer_id is null and property_id is null and can_see_party(party_id))
);
create policy comm_write on communication for all
  using (is_admin() or works_on_transfer(transfer_id) or (transfer_id is null and works_on_property(property_id)))
  with check (is_admin() or works_on_transfer(transfer_id) or (transfer_id is null and works_on_property(property_id)));

-- Viewings: the agent who ran it, and the listing / deal agents.
drop policy if exists viewing_read on viewing;
drop policy if exists viewing_write on viewing;
create policy viewing_read on viewing for select using (
  is_admin() or agent_user_id = auth.uid() or works_on_listing(listing_id) or works_on_transfer(transfer_id)
);
create policy viewing_write on viewing for all
  using (is_admin() or agent_user_id = auth.uid() or works_on_listing(listing_id) or works_on_transfer(transfer_id))
  with check (
    is_admin()
    or (
      is_staff()
      and (listing_id is null or works_on_listing(listing_id))
      and (transfer_id is null or works_on_transfer(transfer_id))
      and (property_id is null or works_on_property(property_id))
    )
  );
drop policy if exists viewing_attendee_read on viewing_attendee;
drop policy if exists viewing_attendee_write on viewing_attendee;
create policy viewing_attendee_read on viewing_attendee for select using (
  exists (select 1 from viewing v where v.id = viewing_id
           and (is_admin() or v.agent_user_id = auth.uid() or works_on_listing(v.listing_id) or works_on_transfer(v.transfer_id)))
);
create policy viewing_attendee_write on viewing_attendee for all
  using (exists (select 1 from viewing v where v.id = viewing_id
           and (is_admin() or v.agent_user_id = auth.uid() or works_on_listing(v.listing_id) or works_on_transfer(v.transfer_id))))
  with check (
    exists (select 1 from viewing v where v.id = viewing_id
             and (is_admin() or v.agent_user_id = auth.uid() or works_on_listing(v.listing_id) or works_on_transfer(v.transfer_id)))
    and (party_id is null or can_see_party(party_id))
  );

-- Tags and do-not-contact entries follow the contact (they carry party ids,
-- and suppressions carry the email / phone itself).
drop policy if exists party_tag_read on party_tag;
drop policy if exists party_tag_write on party_tag;
create policy party_tag_read on party_tag for select using (can_see_party(party_id));
create policy party_tag_write on party_tag for all using (can_see_party(party_id)) with check (can_see_party(party_id));
drop policy if exists suppression_read on contact_point_suppression;
create policy suppression_read on contact_point_suppression for select using (is_admin() or can_see_party(party_id));

-- Buyer interests (budgets) follow the contact.
drop policy if exists party_interest_read on party_interest;
create policy party_interest_read on party_interest for select using (can_see_party(party_id));

-- ---------------------------------------------------------------------------
-- 4. Documents
-- ---------------------------------------------------------------------------
drop policy if exists document_read on document;
create policy document_read on document for select using (can_see_document(id));
-- (document_write stays director-only; agents' finalised drafts are filed
-- server-side after the draft's own RLS has been checked.)

drop policy if exists document_link_read on document_link;
create policy document_link_read on document_link for select using (is_admin() or can_see_link(entity_type, entity_id));

drop policy if exists document_draft_read on document_draft;
drop policy if exists document_draft_write on document_draft;
create or replace function can_use_draft_anchors(p_property uuid, p_listing uuid, p_transfer uuid, p_mandate uuid, p_creator uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_staff() and (
    is_admin()
    or (
      (p_transfer is null or works_on_transfer(p_transfer))
      and (p_listing is null or works_on_listing(p_listing))
      and (p_mandate is null or exists (select 1 from mandate m where m.id = p_mandate and works_on_listing(m.listing_id)))
      and (p_property is null or works_on_property(p_property))
      -- an unanchored draft is its creator's alone
      and (p_transfer is not null or p_listing is not null or p_mandate is not null or p_property is not null
           or p_creator = auth.uid())
    )
  );
$$;
grant execute on function can_use_draft_anchors(uuid, uuid, uuid, uuid, uuid) to authenticated;

create policy document_draft_read on document_draft for select
  using (can_use_draft_anchors(property_id, listing_id, transfer_id, mandate_id, created_by));
create policy document_draft_write on document_draft for all
  using (can_use_draft_anchors(property_id, listing_id, transfer_id, mandate_id, created_by))
  with check (can_use_draft_anchors(property_id, listing_id, transfer_id, mandate_id, created_by));

-- Versions (0072): anyone who may edit the draft may save a version (was:
-- creator or director only, so a co-agent's Save failed).
drop policy if exists document_draft_version_write on document_draft_version;
create policy document_draft_version_write on document_draft_version for insert
  with check (exists (select 1 from document_draft d where d.id = document_draft_version.draft_id));

-- The rendered / signed document ids and the finalised status are set by the
-- server when it files the PDF (service role). A user session may not set
-- them, or re-point a draft at another deal.
create or replace function guard_draft_server_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;
  if new.rendered_document_id is distinct from old.rendered_document_id
     or new.signed_document_id is distinct from old.signed_document_id
     or (new.status is distinct from old.status and new.status <> 'draft')
     or new.property_id is distinct from old.property_id
     or new.listing_id is distinct from old.listing_id
     or new.transfer_id is distinct from old.transfer_id
     or new.mandate_id is distinct from old.mandate_id then
    raise exception 'That change to a document is made by Dream OS when it files the PDF.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_draft_server_fields on document_draft;
create trigger trg_guard_draft_server_fields before update on document_draft
  for each row execute function guard_draft_server_fields();
-- document_draft_version policies (0072) check the draft through its RLS: unchanged.

-- Storage: a file in the documents bucket is readable when its document row
-- is (that row's RLS applies inside this check). Photos (media) stay office-wide.
drop policy if exists "staff read documents" on storage.objects;
drop policy if exists "staff read media" on storage.objects;
drop policy if exists "read documents by record" on storage.objects;
create policy "staff read media" on storage.objects for select
  using (bucket_id = 'media' and is_staff());
create policy "read documents by record" on storage.objects for select
  using (
    bucket_id = 'documents'
    and (
      is_admin()
      or exists (select 1 from public.document d
                  where d.storage_bucket = 'documents' and d.storage_path = storage.objects.name)
    )
  );

-- Staging (raw intake files: IDs, OTPs): the batch's sender and directors.
drop policy if exists "staff read staging" on storage.objects;
drop policy if exists "staff delete staging" on storage.objects;
drop policy if exists "read staging by batch" on storage.objects;
drop policy if exists "delete staging by batch" on storage.objects;
create policy "read staging by batch" on storage.objects for select
  using (
    bucket_id = 'staging'
    and (is_admin() or exists (select 1 from public.ingest_batch b
                                where b.id::text = split_part(storage.objects.name, '/', 1)
                                  and b.created_by = auth.uid()))
  );
create policy "delete staging by batch" on storage.objects for delete
  using (
    bucket_id = 'staging'
    and (is_admin() or exists (select 1 from public.ingest_batch b
                                where b.id::text = split_part(storage.objects.name, '/', 1)
                                  and b.created_by = auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 5. Municipal roll: every column except the owner's name. Column grants
--    are built from the live table so drift can't leave a column out.
--    (Server code that needs the owner — the director-only erf popup —
--    reads with the service role, which these grants don't touch.)
-- ---------------------------------------------------------------------------
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'muni_property' and column_name <> 'owner';
  execute 'revoke select on public.muni_property from authenticated, anon';
  execute format('grant select (%s) on public.muni_property to authenticated', cols);
end $$;

-- ---------------------------------------------------------------------------
-- 6. mark_transfer_sold (0033) had no permission check: any login could
--    change any deal's status. Only directors and the deal's agents now.
-- ---------------------------------------------------------------------------
do $$
declare src text;
begin
  select pg_get_functiondef('public.mark_transfer_sold(uuid, text, text)'::regprocedure) into src;
  if position('works_on_transfer(p_transfer_id)' in src) = 0 then
    src := replace(
      src,
      'begin
  if p_sold_by not in',
      'begin
  if not works_on_transfer(p_transfer_id) then
    raise exception ''not permitted: you are not on this deal'' using errcode = ''42501'';
  end if;
  if p_sold_by not in'
    );
    if position('works_on_transfer(p_transfer_id)' in src) = 0 then
      raise exception 'mark_transfer_sold: could not insert the permission check; function body has changed since 0033';
    end if;
    execute src;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. No re-pointing. Access follows the links between listing, transfer and
--    property, so an agent who may edit their own listing or deal must not
--    be able to re-point it at someone else's (e.g. set their listing's
--    transfer_id to another deal and inherit its sellers). Directors and the
--    server (service role: auth.uid() is null) may.
-- ---------------------------------------------------------------------------
create or replace function guard_deal_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;
  if tg_table_name = 'listing' then
    if new.property_id is distinct from old.property_id
       or new.transfer_id is distinct from old.transfer_id
       or new.agent_user_id is distinct from old.agent_user_id then
      raise exception 'Only a director can move a listing, attach it to another deal or change its agent.'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'transfer' then
    if new.property_id is distinct from old.property_id
       or new.lead_agent_user_id is distinct from old.lead_agent_user_id then
      raise exception 'Only a director can move a deal to another property or change its lead agent.'
        using errcode = '42501';
    end if;
  else
    -- transfer-child rows (offer, agreement, …): may not be moved to another deal
    if to_jsonb(new) ->> 'transfer_id' is distinct from to_jsonb(old) ->> 'transfer_id' then
      raise exception 'Only a director can move this to another deal.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['listing','transfer','transfer_party','offer','agreement','milestone',
                           'transfer_inventory','ppra_disclosure','fica','commission'] loop
    execute format('drop trigger if exists trg_guard_deal_links on %I', t);
    execute format('create trigger trg_guard_deal_links before update on %I for each row execute function guard_deal_links()', t);
  end loop;
end $$;

-- Parties: an agent may not take over someone else's contact by setting
-- owner_user_id on a row they can merely see through a deal.
create or replace function guard_party_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;
  if new.owner_user_id is distinct from old.owner_user_id
     and not (old.owner_user_id is null and new.owner_user_id = auth.uid()) then
    raise exception 'Only a director can reassign a contact.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_party_owner on party;
create trigger trg_guard_party_owner before update on party for each row execute function guard_party_owner();

-- New views and functions: tell PostgREST.
notify pgrst, 'reload schema';
