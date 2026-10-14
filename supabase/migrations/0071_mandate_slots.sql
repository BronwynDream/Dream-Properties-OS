-- ============================================================================
-- Dream Knysna OS — 0071 mandate templates: remaining clauses, predicates,
-- tokenised blanks, slot order
-- ----------------------------------------------------------------------------
-- Plan 019, Arc A2. 0068 seeded the nine clause bodies the three mandate
-- masters share, but not:
--
--   1. the opening block (title; "We/I ... being the registered owner ...
--      Erf ... hereby irrevocably instruct ..."),
--   2. the signature blocks,
--   3. `applies_when` on the per-type variants (they were labelled
--      "Exclusive master" / "Joint master" / "Open master" but carried no
--      predicate, so the resolver could not pick one),
--   4. tokens for the marketing-price blanks,
--   5. any doc_template_slot rows — so no template had an order.
--
-- This migration fills all five. Wording stays Bronwyn's; the only edits
-- are blanks → {{tokens}} and the opening paragraph's Erf/address/extent
-- blanks → tokens, exactly as 0068 did for commission and term.
--
-- Tokens used (resolved by lib/documents/resolve.ts):
--   seller_names, seller_id_line, seller_representative, erf_number,
--   property_known_as, extent_sqm, asking_price, asking_price_words,
--   commission_pct, commission_pct_words, term_months, term_months_words,
--   joint_agency_name
--
-- Safe to re-run: inserts are ON CONFLICT DO NOTHING; updates are
-- idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. New clause slots
-- ---------------------------------------------------------------------------

insert into clause (key, label, category, description)
values
  ('mandate.title',            'Mandate title',               'general',   'Heading line naming the mandate type and the agency / selling agents.'),
  ('mandate.parties_property', 'Seller, property and instruction', 'general', 'Opening paragraph: the Seller, the erf and street address, extent, and the irrevocable instruction to procure a purchaser.'),
  ('mandate.signatures',       'Signature block',             'signature', 'Seller, agency and (joint) partner-agency signature lines with dates.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Variants for the new slots (one per mandate type)
-- ---------------------------------------------------------------------------

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'mandate.title'), 'Exclusive master',
$body$EXCLUSIVE MANDATE – DREAM KNYSNA (PTY) LIMITED$body$,
'{"mandate_type":"exclusive"}'::jsonb, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'mandate.title'), 'Joint master',
$body$JOINT MANDATE – DREAM KNYSNA (PTY) LIMITED & {{joint_agency_name}}, KNYSNA.  (“the Selling Agents”)$body$,
'{"mandate_type":"joint"}'::jsonb, false, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'mandate.title'), 'Open master',
$body$OPEN MANDATE – DREAM KNYSNA (PTY) Ltd

(“the Selling Agent”)$body$,
'{"mandate_type":"open"}'::jsonb, false, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'mandate.parties_property'), 'Exclusive master',
$body$We/I {{seller_names}} {{seller_id_line}}, being the registered owner, and duly authorized thereto (“the Seller”) of:

Erf {{erf_number}} KNYSNA, WESTERN CAPE PROVINCE, known as {{property_known_as}}, KNYSNA (“the property”) and measuring in extent {{extent_sqm}} square metres in extent, hereby irrevocably instruct Dream Knysna (Pty) Limited to procure a Purchaser for the property.$body$,
'{"mandate_type":"exclusive"}'::jsonb, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'mandate.parties_property'), 'Joint master',
$body${{seller_names}} being the registered owner, herein represented by {{seller_representative}}, he being duly authorized thereto (“the Seller”) of:

Erf {{erf_number}} KNYSNA, known as {{property_known_as}}, KNYSNA, WESTERN CAPE (“the property”) and measuring in extent {{extent_sqm}} square metres, hereby irrevocably instruct Dream Knysna (Pty) Limited AND {{joint_agency_name}} to procure a Purchaser for the property.$body$,
'{"mandate_type":"joint"}'::jsonb, false, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'mandate.parties_property'), 'Open master',
$body${{seller_names}} being the registered owner, herein represented by {{seller_representative}}, he being duly authorized thereto (“the Seller”) of:

Erf {{erf_number}} KNYSNA, known as {{property_known_as}}, KNYSNA, WESTERN CAPE (“the property”) and measuring in extent {{extent_sqm}} square metres, hereby irrevocably instruct the Selling Agent to procure a Purchaser for the property.$body$,
'{"mandate_type":"open"}'::jsonb, false, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'mandate.signatures'), 'Exclusive master',
$body$Seller: (signature)	 	_________________________________	Date: 		__________________

Seller: (signature)	 	_________________________________	Date: 		__________________

Dream Knysna (Pty) Limited: 	_________________________________	Date:		__________________

AGENT

Dream Knysna (Pty) Limited:	_________________________________	Date:		__________________

PRINCIPAL / OWNER$body$,
'{"mandate_type":"exclusive"}'::jsonb, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'mandate.signatures'), 'Joint master',
$body$Seller: (signature)	 	_________________________________	Date: 		__________________

Dream Knysna (Pty) Limited:	_________________________________	Date:		__________________$body$,
'{"mandate_type":"joint"}'::jsonb, false, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'mandate.signatures'), 'Open master',
$body$Seller: (signature)	 _____________________________________	Date: 		__________________

Dream Knysna (PTY) LTD:	__________________________________	Date:		__________________

Dream Knysna (PTY) LTD:	__________________________________	Date:		__________________

			            PRINCIPAL / OWNER$body$,
'{"mandate_type":"open"}'::jsonb, false, 'master_template', true
on conflict (clause_id, label) do nothing;

-- The joint mandate's partner-agency signature comes AFTER the FFC warrant
-- in Bronwyn's master, so it is its own slot.
insert into clause (key, label, category, description)
values ('mandate.joint_agency_signature', 'Joint agency signature', 'signature', 'Partner agency signature line. Joint mandate only; sits after the FFC warrant in the master.')
on conflict (key) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'mandate.joint_agency_signature'), 'Joint master',
$body$Joint Agency:			_________________________________	Date:		__________________$body$,
'{"mandate_type":"joint"}'::jsonb, true, 'master_template', true
on conflict (clause_id, label) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Predicates on the 0068 per-type variants
-- ---------------------------------------------------------------------------

update clause_variant set applies_when = '{"mandate_type":"exclusive"}'::jsonb
 where label = 'Exclusive master' and applies_when is null;
update clause_variant set applies_when = '{"mandate_type":"joint"}'::jsonb
 where label = 'Joint master' and applies_when is null;
update clause_variant set applies_when = '{"mandate_type":"open"}'::jsonb
 where label = 'Open master' and applies_when is null;

-- ---------------------------------------------------------------------------
-- 4. Tokenise the marketing-price blanks (0068 left them as underscores)
-- ---------------------------------------------------------------------------

update clause_variant
   set body = regexp_replace(body, 'ZAR\s*_+\s*\(_+\s*RAND\)', 'ZAR {{asking_price}} ({{asking_price_words}} RAND)')
 where clause_id = (select id from clause where key = 'mandate.marketing_price')
   and body ~ 'ZAR\s*_+';

-- ---------------------------------------------------------------------------
-- 5. Slot order per mandate template
-- ---------------------------------------------------------------------------
-- Bronwyn's masters are unnumbered paragraphs; ordinal carries the order,
-- heading and numbering stay null. is_optional = false everywhere: an agent
-- edits wording on a draft, they do not drop a clause from a mandate.

insert into doc_template_slot (template_id, clause_id, ordinal, heading, numbering, condition, is_optional, default_on)
select t.id, c.id, s.ordinal, null, null, null, false, true
from (values
  ('mandate_exclusive', 'mandate.title',              10),
  ('mandate_exclusive', 'mandate.parties_property',   20),
  ('mandate_exclusive', 'mandate.popia_consent',      30),
  ('mandate_exclusive', 'mandate.marketing_price',    40),
  ('mandate_exclusive', 'mandate.commission',         50),
  ('mandate_exclusive', 'mandate.term',               60),
  ('mandate_exclusive', 'mandate.marketing_efforts',  70),
  ('mandate_exclusive', 'mandate.juristic_warrant',   80),
  ('mandate_exclusive', 'mandate.defect_disclosure',  90),
  ('mandate_exclusive', 'mandate.signatures',        100),
  ('mandate_exclusive', 'mandate.ffc_warranty',      110),

  ('mandate_joint',     'mandate.title',              10),
  ('mandate_joint',     'mandate.parties_property',   20),
  ('mandate_joint',     'mandate.popia_consent',      30),
  ('mandate_joint',     'mandate.marketing_price',    40),
  ('mandate_joint',     'mandate.commission',         50),
  ('mandate_joint',     'mandate.term',               60),
  ('mandate_joint',     'mandate.for_sale_board',     70),
  ('mandate_joint',     'mandate.marketing_efforts',  80),
  ('mandate_joint',     'mandate.juristic_warrant',   90),
  ('mandate_joint',     'mandate.defect_disclosure', 100),
  ('mandate_joint',     'mandate.signatures',        110),
  ('mandate_joint',     'mandate.ffc_warranty',      120),
  ('mandate_joint',     'mandate.joint_agency_signature', 130),

  ('mandate_open',      'mandate.title',              10),
  ('mandate_open',      'mandate.parties_property',   20),
  ('mandate_open',      'mandate.popia_consent',      30),
  ('mandate_open',      'mandate.marketing_price',    40),
  ('mandate_open',      'mandate.commission',         50),
  ('mandate_open',      'mandate.term',               60),
  ('mandate_open',      'mandate.marketing_efforts',  70),
  ('mandate_open',      'mandate.defect_disclosure',  80),
  ('mandate_open',      'mandate.signatures',         90),
  ('mandate_open',      'mandate.ffc_warranty',      100)
) as s(template_code, clause_key, ordinal)
join doc_template t on t.code = s.template_code
join clause c on c.key = s.clause_key
on conflict (template_id, ordinal) do nothing;
