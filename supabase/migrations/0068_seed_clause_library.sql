-- ============================================================================
-- Dream Knysna OS — 0068 seed clause library (mandate masters, 2026-final)
-- ----------------------------------------------------------------------------
-- Bronwyn's final 2026 mandate masters, delivered 2026-09-17, supersede the
-- August set. Three mandate types: Exclusive, Joint, Open. The Business
-- Mandate from the August set is NOT included — Simon is confirming with
-- Bronwyn whether it has been retired.
--
-- Every clause body is verbatim from the template files in
-- docs/templates/2026-final/. Any wording difference from Bronwyn's originals
-- is a defect, not a preference — she signs these (Simon, 2026-09-17).
--
-- Tokenised placeholders:
--   {{commission_pct}}        — commission percentage (e.g. "5")
--   {{commission_pct_words}}  — commission percentage in words (e.g. "Five")
--   {{term_months}}           — mandate term in months (e.g. "6")
--   {{term_months_words}}     — mandate term in words (e.g. "six")
--
-- Marketing price and ZAR amounts: NOT tokenised. The fill-in blanks in
-- Bronwyn's originals remain as blanks — the resolver fills them at draft time
-- from mandate.asking_price.
--
-- Safe to re-run: the unique index on (clause_id, label) plus ON CONFLICT DO
-- NOTHING guards make every insert idempotent.
-- ============================================================================

-- Ensure (clause_id, label) is unique so ON CONFLICT targeting it is valid.
create unique index if not exists uq_clause_variant_clause_label
  on clause_variant(clause_id, label);

-- ---------------------------------------------------------------------------
-- CLAUSE SLOTS (9)
-- ---------------------------------------------------------------------------

insert into clause (key, label, category, description)
values
  ('mandate.commission',       'Commission',           'mandate_terms', 'Commission percentage, plus VAT, payable by the Seller on fulfilment of the mandate.'),
  ('mandate.marketing_price',  'Marketing Price',      'financial',     'Agreed marketing price, in ZAR, plus words; lesser amount provision.'),
  ('mandate.term',             'Mandate Term',         'mandate_terms', 'Duration of the mandate in months, plus the 6-month tail commission right after expiry.'),
  ('mandate.popia_consent',    'POPIA Consent',        'popia',         'Seller consent to process personal information under POPIA for the mandate.'),
  ('mandate.juristic_warrant', 'Juristic Warrant',     'juristic',      'Warranty from a company/CC/trust signatory that the entity is registered and the signatory is authorised.'),
  ('mandate.defect_disclosure','Defect Disclosure',    'warranty',      'Seller warranty that all known defects have been disclosed on the Disclosure Report.'),
  ('mandate.marketing_efforts','Marketing Efforts',    'mandate_terms', 'Undertaking to market the property; access rights; exclusivity tail (Exclusive and Joint only).'),
  ('mandate.for_sale_board',   'For Sale Board',       'mandate_terms', 'Right to erect a For Sale board and later a Sold board. Joint mandate only.'),
  ('mandate.ffc_warranty',     'FFC Warranty',         'signature',     'Dream Knysna FFC number and validity warrant at date of signature.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- CLAUSE VARIANTS
-- ---------------------------------------------------------------------------
-- Dollar-quoting ($body$...$body$) is used throughout so single quotes,
-- apostrophes and curly apostrophes inside the clause text need no escaping.

-- mandate.commission — three variants (one per mandate type)

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.commission'),
  'Exclusive master',
  $body$Commission shall be calculated at {{commission_pct}}% ({{commission_pct_words}} percent) of the purchase price, plus VAT hereon, by the Seller on fulfillment of this mandate.$body$,
  null, true, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.commission'),
  'Joint master',
  $body$Commission shall be calculated at {{commission_pct}}% ({{commission_pct_words}} percent) of the purchase price, plus VAT thereon, by the Seller on fulfillment of this mandate to the successful Selling Agent.$body$,
  null, false, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.commission'),
  'Open master',
  $body$Commission shall be payable and calculated at {{commission_pct}}% ({{commission_pct_words}} percent) of the purchase price, plus VAT thereon, by the Seller on fulfillment of this mandate to Dream Knysna (Pty) Ltd.$body$,
  null, false, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

-- mandate.marketing_price — three variants

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.marketing_price'),
  'Exclusive master',
  $body$It is agreed that the property will be marketed at ZAR___________________ (____________________________________ RAND) or such lesser amount agreed upon by the Purchaser and the Agent that is acceptable to the Seller.$body$,
  null, true, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.marketing_price'),
  'Joint master',
  $body$It is agreed that the property will be marketed at ZAR ___________________ (__________________RAND), or such lesser amount agreed upon by the Purchaser and the successful Selling Agent that is acceptable to the Seller.$body$,
  null, false, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.marketing_price'),
  'Open master',
  $body$It is agreed that the property will be marketed at ZAR ___________________ (__________________RAND) or such lesser amount agreed upon by the Purchaser and the Selling Agent that is acceptable to the Seller.$body$,
  null, false, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

-- mandate.term — three variants

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.term'),
  'Exclusive master',
  $body$Dream Knysna (Pty) Limited has the sole and exclusive mandate in respect of the property for a period of {{term_months}} ({{term_months_words}}) months from the last date of signature of this mandate.  In the event of the property being sold to a Purchaser introduced during this mandate period by Dream Knysna (Pty) Limited, within six (6) months of the expiry of this mandate, the introducing Agent shall be entitled to the commission as agreed above.$body$,
  null, true, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.term'),
  'Joint master',
  $body$The Selling Agents have the joint mandate in respect of the property for a period of {{term_months}} ({{term_months_words}}) months from the date of signature of this mandate.  In the event of the property being sold to a Purchaser introduced during this mandate period by any of the Selling Agents, within six (6) months of the expiry of this mandate, the introducing Agent shall be entitled to the commission as agreed above.$body$,
  null, false, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.term'),
  'Open master',
  $body$The Selling Agent shall have the mandate in respect of the property for a period of {{term_months}} ({{term_months_words}}) months from the date of signature of this mandate.  In the event of the property being sold to a Purchaser introduced during this mandate period by the Selling Agent, within six (6) months of the expiry of this mandate, the Selling Agent / introducing Agent shall be entitled to the commission as agreed above.$body$,
  null, false, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

-- mandate.popia_consent — three variants

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.popia_consent'),
  'Exclusive master',
  $body$The Seller hereby gives Dream Knysna (Pty) Limited consent to process my / our personal information, in accordance with the provisions of the Protection of Personal Information Act (“POPIA”), for all purposes relating to the carrying out of this mandate.  Such consent shall extend to the sharing, processing and retention of my / our personal information as authorized or required by law and shall extend to the sharing of my / our personal information with trusted legal advisors who may be approached for advice or assistance during the provisions of this mandate.$body$,
  null, true, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.popia_consent'),
  'Joint master',
  $body$The Seller hereby gives the Selling Agents consent to process our personal information, in accordance with the provisions of the Protection of Personal Information Act (“POPIA”), for all purposes relating to the carrying out of this mandate.  Such consent shall extend to the sharing, processing and retention of our personal information as authorized or required by law and shall extend to the sharing of our personal information with trusted legal advisors who may be approached for advice or assistance during the provisions of this mandate.$body$,
  null, false, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.popia_consent'),
  'Open master',
  $body$The Seller hereby gives the Selling Agent consent to process my / our personal information, in accordance with the provisions of the Protection of Personal Information Act (“POPIA”), for all purposes relating to the carrying out of this mandate.  Such consent shall extend to the sharing, processing and retention of my / our personal information as authorised or required by law and shall extend to the sharing of my / our personal information with trusted legal advisors who may be approached for advice or assistance during the provisions of this mandate.$body$,
  null, false, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

-- mandate.juristic_warrant — one variant (Exclusive and Joint carry it verbatim; Open omits it)

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.juristic_warrant'),
  'Standard',
  $body$In the event of any of the parties to this Agreement being a company, close corporation, trust or other juristic person or entity, the person who signs this Mandate in the name or on behalf of such company, close corporation, trust or other juristic person or entity hereby warrants that such legal entity is indeed duly registered in terms of the applicable legislation and warrants that he is duly authorized to act for and/or on behalf of such legal entity, and such signatory shall be personally liable as Seller in terms of this Mandate if such juristic person or entity legally does not exist and/or fails to comply with any of the provisions hereof.$body$,
  null, true, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

-- mandate.defect_disclosure — one variant (identical across all three masters)

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.defect_disclosure'),
  'Standard',
  $body$The Seller hereby warrants that he has disclosed all known defects on the property including those listed on the ‘Disclosure Report by the Seller’ attached hereto.$body$,
  null, true, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

-- mandate.marketing_efforts — three variants

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.marketing_efforts'),
  'Exclusive master',
  $body$Dream Knysna (Pty) Limited shall use their every endeavor to market and to try and sell the property. The property will be marketed on various websites, email campaigns, advertisements, including adverts displayed in real estate windows in the Knysna area and advertisements in various media from time to time.  Dream Knysna (Pty) Limited representatives and any prospective Purchaser shall be entitled to access the property at all reasonable times during the period of this mandate.  No other agent shall be given a mandate and/or instruction of whatsoever nature to market the property by the Seller during the period of this exclusive mandate, unless they liaise directly with Dream Knysna (Pty) Limited and an offer to purchase is made through Dream Knysna (Pty) Limited.$body$,
  null, true, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.marketing_efforts'),
  'Joint master',
  $body$The Selling Agents shall use their every endeavor to market and to try and sell the property. The property will be marketed on various websites, email campaigns, advertisements, including adverts displayed in real estate windows in the Knysna area and advertisements in various media from time to time.  The Selling Agents and their representatives shall be entitled to access the property at all reasonable times during the period of this mandate.  No other agent shall be given a mandate and/or instruction of whatsoever nature to market the property by the Seller during the period of this joint mandate, unless they liaise directly with any one of the Selling Agents and an offer to purchase is made through one of the Selling Agents.$body$,
  null, false, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.marketing_efforts'),
  'Open master',
  $body$The Selling Agent shall use their every endeavor to market and to try and sell the property. The property will be marketed on various websites, email campaigns, advertisements, including adverts displayed in real estate windows in the Knysna area and advertisements in various media from time to time.  The Selling Agent and their representatives shall be entitled to access the property at all reasonable times during the period of this mandate.$body$,
  null, false, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

-- mandate.for_sale_board — one variant (Joint mandate only)

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.for_sale_board'),
  'Joint master',
  $body$The Selling Agents shall have the exclusive right to erect a ‘For Sale’ board on the property during the mandate period, which board may include the asking price and any relevant details and/or photos of the property.  The successful Selling Agent shall furthermore be permitted to erect a ‘Sold’ board on the property for a period of 90 days after the property is sold as a result of this mandate.$body$,
  null, true, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

-- mandate.ffc_warranty — one variant (identical across all three masters)

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved, approved_by, approved_at)
select
  (select id from clause where key = 'mandate.ffc_warranty'),
  'Standard',
  $body$DREAM KNYSNA (PTY) LIMITED (FFC 2026 – 2028 No. 20261501621) hereby warrant the validity of the required FFC’s as at date of signature of this agreement$body$,
  null, true, 'master_template', true, null, null
on conflict (clause_id, label) do nothing;

-- ---------------------------------------------------------------------------
-- DOC_TEMPLATE ROWS (three mandate templates; not four — Business Mandate
-- from the August set is not in the final 2026 set)
-- ---------------------------------------------------------------------------

insert into doc_template (code, label, component, requires_property, requires_purchaser, description, sort_order)
values
  ('mandate_exclusive', 'Exclusive Mandate', 'MandateExclusive', true,  false, 'Sole and exclusive mandate to market the property. Bronwyn''s standard for a seller who commits to Dream alone.',                                10),
  ('mandate_joint',     'Joint Mandate',     'MandateJoint',     true,  false, 'Joint mandate co-held with another agency (typically Pam Golding / Knysna Plett Property Professionals). Commission % negotiated case by case.', 20),
  ('mandate_open',      'Open Mandate',      'MandateOpen',      true,  false, 'Non-exclusive mandate; seller may work with any number of agents.',                                                                              30)
on conflict (code) do nothing;
