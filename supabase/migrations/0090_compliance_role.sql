-- 0090 — Compliance role (2026-10-21)
--
-- Simon: "create a compliance role ... only access to relevant information.
-- This role cannot have access to any commission information or any agreement
-- of sale information, and should only access the second page of any sale
-- agreement ... chase up all gaps in the FICA documentation and all missing
-- documents ... load documents ... through the intake."
--
-- Design: the compliance user is NOT staff. is_staff() (0086) stays
-- admin/agent only, so every RLS policy in the database still gives her
-- nothing. Her whole view of Dream OS is the FICA desk (/fica), whose server
-- code checks is_compliance_or_admin and reads a fixed list of columns with
-- the service key. Commission, prices on the deal, offers, mandates and
-- agreements are never selected there. Safe to re-run.

alter type app_role add value if not exists 'compliance';

-- role::text so this function doesn't depend on the new enum value being
-- committed yet (it can't be used inside the transaction that adds it).
create or replace function is_compliance()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_user
    where id = auth.uid() and active and role::text = 'compliance'
  );
$$;

-- She can use "Report a problem" like everyone else.
drop policy if exists app_feedback_insert on app_feedback;
create policy app_feedback_insert on app_feedback for insert
  with check ((is_staff() or is_compliance()) and user_id = auth.uid() and resolved_at is null);

-- ---------------------------------------------------------------------------
-- Holes found by the security review of this role (2026-10-21). Each was
-- open to ANY signed-in user who isn't staff (compliance, a switched-off
-- agent, the reserved conveyancer/client roles) — and the first to anon.
-- ---------------------------------------------------------------------------

-- 1. muni_property_public (0050) runs as its owner, so RLS never applied: any
--    signed-in user (and probably the public anon key) could read the whole
--    municipal roll, purchase prices and bonds included. Staff only now.
create or replace view muni_property_public with (security_barrier) as
  select
    sg_number, erf_number, muni_erf_code,
    street_no, street_name, suburb, suburb_hint,
    zoning, ward_no, sectional_title_flag, usage_, prop_description,
    town_name, extent_sqm, property_type,
    sect_scheme_name, sect_scheme_unit,
    title_deed_no, old_title_deed_no, deeds_office,
    purch_date, registration_date, purch_price,
    bond_number, bond_amount, bond_institution,
    imported_at, refreshed_at,
    roll_upload_id
  from muni_property
  where is_staff();
revoke all on muni_property_public from anon;
grant select on muni_property_public to authenticated;

-- 2. Intake staging (0007/0008) trusted "you created the batch". A non-staff
--    user could plant batches and extraction rows (prices, commission) for a
--    director to commit later. Staff only, as everywhere else.
drop policy if exists ingest_batch_rw on ingest_batch;
create policy ingest_batch_rw on ingest_batch for all
  using (is_admin() or (is_staff() and created_by = auth.uid()))
  with check (is_admin() or (is_staff() and created_by = auth.uid()));

drop policy if exists ingest_file_rw on ingest_file;
create policy ingest_file_rw on ingest_file for all
  using (is_admin() or (is_staff() and exists (select 1 from ingest_batch b where b.id = ingest_file.batch_id and b.created_by = auth.uid())))
  with check (is_admin() or (is_staff() and exists (select 1 from ingest_batch b where b.id = ingest_file.batch_id and b.created_by = auth.uid())));

drop policy if exists extraction_rw on extraction;
create policy extraction_rw on extraction for all
  using (is_admin() or (is_staff() and exists (select 1 from ingest_batch b where b.id = extraction.batch_id and b.created_by = auth.uid())))
  with check (is_admin() or (is_staff() and exists (select 1 from ingest_batch b where b.id = extraction.batch_id and b.created_by = auth.uid())));

drop policy if exists match_candidate_rw on match_candidate;
create policy match_candidate_rw on match_candidate for all
  using (is_admin() or (is_staff() and exists (select 1 from ingest_batch b where b.id = match_candidate.batch_id and b.created_by = auth.uid())))
  with check (is_admin() or (is_staff() and exists (select 1 from ingest_batch b where b.id = match_candidate.batch_id and b.created_by = auth.uid())));

-- 3. party_insert (0086) let any signed-in user add contacts they own.
drop policy if exists party_insert on party;
create policy party_insert on party for insert with check (is_admin() or (is_staff() and owner_user_id = auth.uid()));
