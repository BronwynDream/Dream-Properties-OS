-- ============================================================================
-- Dream Knysna OS — PILOT / golden record: 7 The Grove, Leisure Isle (Erf 1764)
-- ----------------------------------------------------------------------------
-- Loads one real, complete transaction to prove the schema end-to-end:
--   * partnership seller (The Leisure Partnership = Mark + Gail Sofianos)
--   * joint purchasers (Phil + Kate Davis), married
--   * executed agreement, a WAIVED suspensive condition, dated milestones
--   * FICA per party, a representative document set, and the comms log
-- Run AFTER 0001–0006 + seed. Safe to run once; wrapped in a transaction.
-- Facts are taken verbatim from the 29-Jun-2026 email pack; unknowns are left
-- NULL with a note rather than invented (e.g. purchaser IDs, exact deposit date).
-- ============================================================================

begin;

do $$
declare
  v_suburb   uuid; v_ot uuid; v_pt uuid; v_dream uuid;
  v_firm     uuid; v_colleen uuid;
  v_prop     uuid;
  v_partnership uuid; v_mark uuid; v_gail uuid;
  v_phil uuid; v_kate uuid;
  v_transfer uuid; v_listing uuid; v_agreement uuid;
  v_doc uuid;
begin
  -- reference lookups (from seed) -------------------------------------------
  select id into v_suburb  from suburb          where name = 'Leisure Isle';
  select id into v_ot      from ownership_type  where code = 'full_freehold';
  select id into v_pt      from property_type   where code = 'house';
  select id into v_dream   from agency          where is_dream limit 1;
  select id into v_firm    from conveyancer_firm where name = 'Foley-Nel Incorporated';
  select id into v_colleen from conveyancer_contact where full_name = 'Colleen Nel';

  -- PROPERTY -----------------------------------------------------------------
  insert into property (primary_address, suburb_id, ownership_type_id, property_type_id,
                        extent_sqm, title_deed_no, deeds_office, deeds_description, notes)
  values ('7 The Grove, Leisure Isle, Knysna', v_suburb, v_ot, v_pt,
          614, 'T62677/2025', 'Cape Town',
          'Erf 1764, Knysna, Western Cape', 'Double-storey home on a landscaped grove; 6 bedrooms, 3 self-contained suites. Concept plans available.')
  returning id into v_prop;

  insert into erf (property_id, erf_number, deeds_description)
  values (v_prop, '1764', 'Erf 1764, Knysna, Western Cape, 614 sqm, T62677/2025');

  -- SELLERS: The Leisure Partnership (Mark + Gail Sofianos) ------------------
  insert into party (party_type, display_name, entity_name, email, postal_address, domicilium_address, notes)
  values ('partnership', 'The Leisure Partnership', 'The Leisure Partnership',
          'mark@mgprop.co.za', 'P O Box 3298, Knysna, 6570', '9 Bowden Park, Leisure Isle, Knysna, 6571',
          'Mark & Gail Sofianos trading in partnership as The Leisure Partnership')
  returning id into v_partnership;

  insert into party (party_type, display_name, first_names, surname, id_number,
                     matrimonial_regime, email, phone)
  values ('individual', 'Mark Tracy Sofianos', 'Mark Tracy', 'Sofianos', '6702185098089',
          'married_in_community', 'mark@mgprop.co.za', '082 448 5782')
  returning id into v_mark;

  insert into party (party_type, display_name, first_names, surname, id_number,
                     matrimonial_regime, email, phone)
  values ('individual', 'Gail Sofianos', 'Gail', 'Sofianos', '7104010109083',
          'married_in_community', 'gailsofy@icloud.com', '082 459 3411')
  returning id into v_gail;

  update party set spouse_party_id = v_gail where id = v_mark;
  update party set spouse_party_id = v_mark where id = v_gail;

  -- partners of the partnership, both authorised signatories
  insert into party_member (entity_party_id, member_party_id, role, is_authorised_signatory)
  values (v_partnership, v_mark, 'partner', true),
         (v_partnership, v_gail, 'partner', true);

  -- PURCHASERS: Phil + Kate Davis (married; IDs pending capture from jpegs) --
  insert into party (party_type, display_name, first_names, surname, notes)
  values ('individual', 'Phil Davis', 'P A T', 'Davis', 'Purchaser. ID number pending (supplied as image).')
  returning id into v_phil;

  insert into party (party_type, display_name, first_names, surname, notes)
  values ('individual', 'Kate Davis', 'Kate', 'Davis', 'Purchaser. ID number pending (supplied as image).')
  returning id into v_kate;

  update party set spouse_party_id = v_kate where id = v_phil;
  update party set spouse_party_id = v_phil where id = v_kate;

  -- TRANSFER -----------------------------------------------------------------
  insert into transfer (property_id, name, status, conveyancer_firm_id, conveyancer_contact_id,
                        transfer_date, notes)
  values (v_prop, '7 The Grove Sofianos to Davis', 'in_conveyancing', v_firm, v_colleen,
          date '2026-08-14', 'Transfer instructed to Foley-Nel 26 Jun 2026. Suspensive condition waived 29 Jun 2026.')
  returning id into v_transfer;

  insert into transfer_party (transfer_id, party_id, side, is_primary) values
    (v_transfer, v_partnership, 'seller',    true),
    (v_transfer, v_phil,       'purchaser', true),
    (v_transfer, v_kate,       'purchaser', false);

  -- LISTING (sold) -----------------------------------------------------------
  insert into listing (transfer_id, property_id, status, asking_price, headline, agent_user_id)
  values (v_transfer, v_prop, 'sold', 7600000,
          'A quiet grove on Leisure Isle — spacious double-storey overlooking the central park', null)
  returning id into v_listing;

  -- AGREEMENT (executed) -----------------------------------------------------
  insert into agreement (transfer_id, agreement_type, status, version, price, deposit,
                        transfer_date, notes)
  values (v_transfer, 'sale_improved', 'executed', 1, 7600000, 760000, date '2026-08-14',
          'Final signed AOS. Deposit R760k (10%) to conveyancer within 7 days of final signature; balance by guarantee 30 days before lodgement.')
  returning id into v_agreement;

  -- SUSPENSIVE CONDITION (waived) -------------------------------------------
  insert into suspensive_condition (agreement_id, type, description, status, fulfilled_date, notes)
  values (v_agreement, 'other',
          'Suspensive condition per agreement — confirmed WAIVED by purchaser (Kate Davis) via WhatsApp.',
          'waived', date '2026-06-29',
          'Waiver evidenced by WhatsApp screenshot forwarded by Vanessa Eyre 29 Jun 2026.');

  -- MILESTONES ---------------------------------------------------------------
  insert into milestone (transfer_id, type, due_date, status, source, notes) values
    (v_transfer, 'deposit_due',   null,             'pending', 'contract', 'R760,000 due within 7 days of final signature (signature date to confirm).'),
    (v_transfer, 'guarantee_due', null,             'pending', 'contract', 'Balance guarantee due 30 days before lodgement in the Cape Town Deeds Office.'),
    (v_transfer, 'transfer_date', date '2026-08-14','pending', 'contract', 'Transfer & registration target date per clause 4.');

  -- COMMISSION (amount blank in the signed agreement) ------------------------
  insert into commission (transfer_id, payee_agency_id, is_first_draw, status, split_notes)
  values (v_transfer, v_dream, true, 'pending',
          'Commission amount left blank in the executed agreement — to be confirmed and captured. Payable to Dream Knysna as first draw on registration.');

  -- FICA (per party per role) ------------------------------------------------
  insert into fica (transfer_id, party_id, role, status, risk, notes) values
    (v_transfer, v_partnership, 'seller',    'received', 'low', 'Partnership; partners'' FICA held.'),
    (v_transfer, v_mark,        'partner',   'received', 'low', 'Seller ID + proof of address on file.'),
    (v_transfer, v_gail,        'partner',   'received', 'low', 'Seller partner.'),
    (v_transfer, v_phil,        'purchaser', 'received', 'low', 'ID (image), proof of address, marriage cert, KYC on file.'),
    (v_transfer, v_kate,        'purchaser', 'received', 'low', 'ID (image), marriage cert, KYC on file.');

  -- OWNERSHIP HISTORY --------------------------------------------------------
  insert into property_ownership_history (property_id, owner_party_id, source)
  values (v_prop, v_partnership, 'deeds');

  -- DOCUMENTS (metadata; binaries uploaded to the buckets separately) --------
  -- storage_path is the intended path within the bucket; PII docs use the 'fica' bucket.
  insert into document (doc_type_id, title, storage_bucket, storage_path, status, is_pii, retention_until)
  values ((select id from document_type where code='agreement_of_sale'),
          'Final Signed Agreement of Sale — 7 The Grove', 'documents',
          'transfers/7-the-grove/final-signed-agreement-of-sale.pdf', 'executed', false, null)
  returning id into v_doc;
  insert into document_link (document_id, entity_type, entity_id, role) values
    (v_doc, 'transfer', v_transfer, 'signed'),
    (v_doc, 'agreement', v_agreement, 'signed');

  insert into document (doc_type_id, title, storage_bucket, storage_path, status, is_pii)
  values ((select id from document_type where code='boundary_relaxation'),
          'Building-line Relaxation Approval (front boundary)', 'documents',
          'properties/7-the-grove/boundary-relaxation-front.pdf', 'final', false)
  returning id into v_doc;
  insert into document_link (document_id, entity_type, entity_id, role) values
    (v_doc, 'property', v_prop, 'approval');

  insert into document (doc_type_id, title, storage_bucket, storage_path, status, is_pii, retention_until)
  values ((select id from document_type where code='marriage_certificate'),
          'Purchaser Marriage Certificate — Davis', 'fica',
          'fica/7-the-grove/davis-marriage-certificate.pdf', 'final', true, date '2031-08-14')
  returning id into v_doc;
  insert into document_link (document_id, entity_type, entity_id, role) values
    (v_doc, 'party', v_phil, 'evidence'),
    (v_doc, 'party', v_kate, 'evidence');

  insert into document (doc_type_id, title, storage_bucket, storage_path, status, is_pii, retention_until)
  values ((select id from document_type where code='id_document'),
          'Seller ID — Sofianos', 'fica', 'fica/7-the-grove/sellers-id.pdf', 'final', true, date '2031-08-14')
  returning id into v_doc;
  insert into document_link (document_id, entity_type, entity_id, role) values
    (v_doc, 'party', v_mark, 'id'), (v_doc, 'party', v_gail, 'id');

  insert into document (doc_type_id, title, storage_bucket, storage_path, status, is_pii, retention_until)
  values ((select id from document_type where code='transfer_instruction'),
          'Transfer Instruction to Foley-Nel', 'documents',
          'transfers/7-the-grove/transfer-instruction.pdf', 'final', false, date '2031-08-14')
  returning id into v_doc;
  insert into document_link (document_id, entity_type, entity_id, role) values
    (v_doc, 'transfer', v_transfer, 'instruction');

  insert into document (doc_type_id, title, storage_bucket, storage_path, status, is_pii)
  values ((select id from document_type where code='property_info'),
          'Property Information — 7 The Grove', 'documents',
          'properties/7-the-grove/property-information.pdf', 'final', false)
  returning id into v_doc;
  insert into document_link (document_id, entity_type, entity_id, role) values
    (v_doc, 'property', v_prop, null), (v_doc, 'listing', v_listing, null);

  -- MEDIA: concept plans (drawings are first-class, not just photos) ---------
  insert into media (property_id, kind, storage_bucket, storage_path, caption) values
    (v_prop, 'concept_plan', 'media', 'media/7-the-grove/concept-floor-plans-2026-02-23.pdf', 'Concept floor plans (renovation option)'),
    (v_prop, 'concept_plan', 'media', 'media/7-the-grove/concept-screenshots-2026-02-23.pdf', 'Concept renders');

  -- COMMUNICATIONS log -------------------------------------------------------
  insert into communication (transfer_id, party_id, channel, direction, subject, body_text, occurred_at) values
    (v_transfer, null, 'email', 'outbound',
     'NEW TRANSFER INSTRUCTION : Sofianos / Davis : Erf 1764',
     'Instruction sent to Foley-Nel (Colleen/Sandra) with FICA; purchaser awaiting trust-account details before going on holiday.',
     timestamptz '2026-06-26 09:58:00+02'),
    (v_transfer, v_kate, 'whatsapp', 'inbound',
     'Suspensive condition — waiver',
     'Kate Davis confirmed via WhatsApp they are happy with the email re the suspensive condition; condition waived.',
     timestamptz '2026-06-29 08:00:00+02');

  raise notice '7 The Grove loaded: property %, transfer %', v_prop, v_transfer;
end $$;

commit;

-- Quick read-back (run after commit to eyeball the golden record):
-- select p.primary_address, t.name, t.status, a.price, a.status as agreement_status,
--        sc.status as condition_status
-- from transfer t
-- join property p on p.id = t.property_id
-- left join agreement a on a.transfer_id = t.id
-- left join suspensive_condition sc on sc.agreement_id = a.id
-- where p.title_deed_no = 'T62677/2025';
