-- ============================================================================
-- Dream Knysna OS — seed data (reference tables + known organisations/estates)
-- Idempotent: safe to re-run. App users are seeded separately (see README) once
-- their Supabase Auth accounts exist, because app_user.id must equal auth.uid().
-- ============================================================================

-- Countries -----------------------------------------------------------------
insert into country (code, name, sort_order) values
  ('ZA','South Africa',1), ('GB','United Kingdom',2),
  ('AU','Australia',3),    ('MU','Mauritius',4)
on conflict (code) do nothing;

-- Suburbs (Knysna town + 40 km radius) --------------------------------------
insert into suburb (name, town) values
  ('The Heads','Knysna'), ('Leisure Isle','Knysna'), ('Thesen Islands','Knysna'),
  ('Knysna Quays','Knysna'), ('Pezula','Knysna'), ('Simola','Knysna'),
  ('Eastford','Knysna'), ('Brenton','Knysna'), ('Belvidere','Knysna'),
  ('Rheenendal','Knysna'), ('Centreville','Knysna'), ('Sedgefield','Sedgefield')
on conflict (name, town) do nothing;

-- Ownership types (PropCtrl-parity taxonomy) --------------------------------
insert into ownership_type (code, label) values
  ('full_freehold','Full & Free (Freehold)'), ('sectional','Sectional Title'),
  ('share_block','Share Block'), ('leasehold','Leasehold'),
  ('fractional','Fractional'), ('timeshare','Timeshare')
on conflict (code) do nothing;

-- Property types ------------------------------------------------------------
insert into property_type (code, label) values
  ('house','House'), ('apartment','Apartment'), ('townhouse','Townhouse'),
  ('vacant_land','Vacant Land'), ('estate_plot','Estate Plot'),
  ('farm','Farm / Small Holding'), ('commercial','Commercial')
on conflict (code) do nothing;

-- Compliance certificate types (SA) -----------------------------------------
insert into compliance_type (code, label, validity_months) values
  ('electrical_coc','Electrical Certificate of Compliance', 24),
  ('gas_coc','Gas Certificate of Conformity', null),
  ('electric_fence_coc','Electric Fence Certificate', null),
  ('beetle','Beetle / Entomologist Certificate', null),
  ('plumbing_water','Plumbing / Water Certificate', null)
on conflict (code) do nothing;

-- Document types (category, PII default, FIC Act retention) ------------------
insert into document_type (code, label, category, is_pii_default, retention_years) values
  ('property_info','Property Information Sheet','listing',false,null),
  ('detailed_listing','Detailed Listing (marketing copy)','listing',false,null),
  ('cma','Comparative Market Analysis','listing',false,null),
  ('lightstone_report','Lightstone / Property Report','listing',false,null),
  ('mandate','Mandate (Sole/Joint/Open)','mandate',false,5),
  ('ppra_disclosure','PPRA Mandatory Disclosure Form','mandate',false,5),
  ('offer_to_purchase','Offer to Purchase','agreement',false,5),
  ('agreement_of_sale','Agreement of Sale','agreement',false,5),
  ('land_freehold_agreement','Land / Freehold Agreement','agreement',false,5),
  ('movables_agreement','Movables Agreement','agreement',false,5),
  ('addendum','Addendum','agreement',false,5),
  ('title_deed','Title / Registered Deed','municipal',false,null),
  ('id_document','Identity Document','fica',true,5),
  ('passport','Passport','fica',true,5),
  ('proof_of_address','Proof of Address','fica',true,5),
  ('marriage_certificate','Marriage Certificate','fica',true,5),
  ('fica_questionnaire','FICA Questionnaire','fica',true,5),
  ('kyc_form','KYC Form','fica',true,5),
  ('vat_certificate','VAT Certificate','company',false,5),
  ('company_resolution','Company/Members Resolution','company',true,5),
  ('share_register','Share Register','company',true,5),
  ('cipc_form','CIPC Registration Form (COR)','company',true,5),
  ('trust_deed','Trust Deed / Letters of Authority','company',true,5),
  ('gas_coc','Gas Certificate of Conformity','compliance',false,null),
  ('electrical_coc','Electrical Certificate of Compliance','compliance',false,null),
  ('beetle_cert','Beetle Certificate','compliance',false,null),
  ('rates_account','Municipal Rates Account','municipal',true,null),
  ('boundary_relaxation','Building-line Relaxation Approval','municipal',false,null),
  ('architectural_plan','Architectural Plan / Drawing','plan',false,null),
  ('concept_plan','Concept / Proposed Plan','plan',false,null),
  ('estate_design_manual','Estate Architectural Design Manual','plan',false,null),
  ('transfer_instruction','Transfer Instruction to Conveyancer','correspondence',false,5),
  ('email_thread','Email Correspondence','correspondence',false,5),
  ('photo','Property Photograph','photo',false,null),
  ('other','Other','other',false,null)
on conflict (code) do nothing;

-- Agencies ------------------------------------------------------------------
insert into agency (name, ffc_no, is_dream, phone, email, address) values
  ('Dream Knysna (Pty) Ltd','2026-15016210000', true, '+27 44 382 0362','info@dreamknysna.co.za','2 Gray Street, Knysna, 6571')
on conflict do nothing;
insert into agency (name, is_dream, phone, address) values
  ('Pam Golding Properties Knysna (Knysna Plett Property Professionals Pty Ltd)', false, '+27 44 382 5574','TH18 Thesen Harbour Town, Knysna'),
  ('Sotheby''s International Realty (Knysna)', false, null, null)
on conflict do nothing;

-- Conveyancer firms + contacts ----------------------------------------------
insert into conveyancer_firm (name, email, address) values
  ('Foley-Nel Incorporated','colleen@foleynel.co.za','3 Trotter Street, Knysna'),
  ('Van Tonder Attorneys', null, null)
on conflict do nothing;

insert into conveyancer_contact (firm_id, full_name, email, role, is_primary)
select id, 'Colleen Nel','colleen@foleynel.co.za','Conveyancer', true
from conveyancer_firm where name = 'Foley-Nel Incorporated'
on conflict do nothing;
insert into conveyancer_contact (firm_id, full_name, role, is_primary)
select id, 'Sandra','Transfer secretary', false
from conveyancer_firm where name = 'Foley-Nel Incorporated'
on conflict do nothing;

-- Estates -------------------------------------------------------------------
insert into estate (name, kind, suburb_id)
select 'Pezula Private Estate','estate', (select id from suburb where name='Pezula')
where not exists (select 1 from estate where name='Pezula Private Estate');
insert into estate (name, kind, suburb_id)
select 'Thesen Islands','estate', (select id from suburb where name='Thesen Islands')
where not exists (select 1 from estate where name='Thesen Islands');
insert into estate (name, kind, suburb_id)
select 'Simola Golf & Country Estate','estate', (select id from suburb where name='Simola')
where not exists (select 1 from estate where name='Simola Golf & Country Estate');
