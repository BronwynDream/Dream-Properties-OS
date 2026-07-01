-- ============================================================================
-- Dream Knysna OS — 0005 RLS: helper functions + row-level security baseline
-- ----------------------------------------------------------------------------
-- Model (from PROJECT.md):
--   * Admin (Bronwyn, Camilla)  -> full access, every FICA view audited.
--   * Agent (Vanessa, others)   -> only transfers where they are lead agent.
--   * Reference/business data    -> readable by any active staff member.
-- This is a SAFE BASELINE. Conveyancer magic-link rooms and the client portal
-- get their own scoped policies in a later migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so they can read app_user under RLS)
-- ---------------------------------------------------------------------------
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_user
    where id = auth.uid() and role = 'admin' and active
  );
$$;

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_user
    where id = auth.uid() and active
  );
$$;

create or replace function leads_transfer(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from transfer
    where id = tid and lead_agent_user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'country','suburb','ownership_type','property_type','document_type','compliance_type',
    'agency','conveyancer_firm','conveyancer_contact','app_user','estate',
    'party','party_member','property','erf','property_ownership_history',
    'transfer','transfer_party','listing','listing_price_history','mandate','cma',
    'offer','agreement','suspensive_condition','milestone','commission','compliance_cert',
    'document','document_link','media','fica','communication','consent','audit_log'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reference / lookup: staff read, admin write
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'country','suburb','ownership_type','property_type','document_type','compliance_type',
    'agency','conveyancer_firm','conveyancer_contact','estate'
  ]
  loop
    execute format($f$create policy %1$I_read  on %1$I for select using (is_staff());$f$, t);
    execute format($f$create policy %1$I_write on %1$I for all    using (is_admin()) with check (is_admin());$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Business data readable by all staff, written by admin (agent write scoping
-- is enforced in the app layer for the first cut).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'party','party_member','property','erf','property_ownership_history',
    'transfer','transfer_party','listing','listing_price_history','mandate','cma',
    'offer','agreement','suspensive_condition','milestone','commission',
    'compliance_cert','media'
  ]
  loop
    execute format($f$create policy %1$I_read  on %1$I for select using (is_staff());$f$, t);
    execute format($f$create policy %1$I_write on %1$I for all    using (is_admin()) with check (is_admin());$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- app_user: a user sees their own row; admins see all; admins manage.
-- ---------------------------------------------------------------------------
create policy app_user_self  on app_user for select using (id = auth.uid() or is_admin());
create policy app_user_admin on app_user for all    using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- FICA: admin full; agent only on transfers they lead. (Every read should be
-- written to audit_log by the app.)
-- ---------------------------------------------------------------------------
create policy fica_read on fica for select
  using (is_admin() or leads_transfer(transfer_id));
create policy fica_write on fica for all
  using (is_admin() or leads_transfer(transfer_id))
  with check (is_admin() or leads_transfer(transfer_id));

-- ---------------------------------------------------------------------------
-- Documents: admin full; PII docs only via a transfer the agent leads;
-- non-PII docs readable by any staff.
-- ---------------------------------------------------------------------------
create policy document_read on document for select using (
  is_admin()
  or is_pii = false
  or exists (
    select 1 from document_link dl
    join transfer t on t.id = dl.entity_id and dl.entity_type = 'transfer'
    where dl.document_id = document.id and t.lead_agent_user_id = auth.uid()
  )
);
create policy document_write on document for all using (is_admin()) with check (is_admin());

create policy document_link_read  on document_link for select using (is_staff());
create policy document_link_write on document_link for all    using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Communications: admin full; agent only on transfers they lead.
-- ---------------------------------------------------------------------------
create policy comm_read on communication for select
  using (is_admin() or leads_transfer(transfer_id));
create policy comm_write on communication for all
  using (is_admin() or leads_transfer(transfer_id))
  with check (is_admin() or leads_transfer(transfer_id));

-- ---------------------------------------------------------------------------
-- Consent + audit: admin only (audit is insert-only for staff).
-- ---------------------------------------------------------------------------
create policy consent_admin on consent for all using (is_admin()) with check (is_admin());
create policy audit_insert on audit_log for insert with check (is_staff());
create policy audit_read   on audit_log for select using (is_admin());
