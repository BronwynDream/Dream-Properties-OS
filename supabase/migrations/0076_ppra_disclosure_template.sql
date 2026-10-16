-- ============================================================================
-- Dream Knysna OS — 0076 PPRA Section 67 mandatory disclosure as a document
-- ----------------------------------------------------------------------------
-- Plan 019, Arc A6. The disclosure already lives as structured answers
-- (0052: ppra_disclosure + ppra_disclosure_answer_row) so the compliance
-- watchlist can see which live deals are exposed. What was missing is the
-- paper: the prescribed form, filled from those answers, printed on the
-- letterhead, filed and signed through the same register as every other
-- deal document (A5).
--
-- Bronwyn's two masters ("Mandatory PPRA Disclosure Form 2026" and the
-- "Vacant Land" one) are the SAME prescribed form: the vacant-land version
-- is pre-answered N/A on every statement except boundary disputes (NO),
-- with "This Property is Vacant Land." under additional information. So
-- this is one template; the plot preset is applied to the structured record
-- (lib/ppraDisclosure.ts), not to the wording.
--
-- Wording is the regulation's, verbatim from docs/templates/2026-final/
-- mandatory-ppra-disclosure-form-2026.md. Statement answers are tokens
-- (ans_<question_key>) the deal context fills from the answer rows as
-- "YES [X]  NO [ ]  N/A [ ]". The "Initial here" lines of the PDF master are
-- a page-footer convention, not body text, and are left to the signing.
-- ============================================================================

insert into clause (key, label, category, description) values
  ('ppra.property_description', 'PPRA — property description',          'general',  'Property description line at the head of the prescribed form.'),
  ('ppra.disclaimer',           'PPRA — 1 Disclaimer',                   'general',  'Regulation wording.'),
  ('ppra.definitions',          'PPRA — 2 Definitions',                  'general',  'Regulation wording: "to be aware", "defect".'),
  ('ppra.disclosure_of_info',   'PPRA — 3 Disclosure of information',    'general',  'Regulation wording.'),
  ('ppra.additional_info_duty', 'PPRA — 4 Provision of additional information', 'general', 'Regulation wording: a "yes" obliges a full explanation.'),
  ('ppra.statements',           'PPRA — 5 Statements in connection with Property', 'warranty', 'The eleven prescribed statements, answered YES / NO / N/A from the structured disclosure.'),
  ('ppra.additional_info',      'PPRA — Additional information',         'warranty', 'Explanations for every "yes" plus anything else the owner discloses.'),
  ('ppra.certifications',       'PPRA — 6 and 7 Certifications',         'general',  'Owner''s certification; certification by person supplying information.'),
  ('ppra.notice_and_ack',       'PPRA — 8 Notice and 9 Buyer''s acknowledgement', 'general', 'Regulation wording.'),
  ('ppra.signatures',           'PPRA — 10 Signatures',                  'signature','Signed at / on; owner, purchaser, property practitioner.')
on conflict (key) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'ppra.property_description'), 'Master', $body$PROPERTY DESCRIPTION: {{property_description}}

MANDATORY DISCLOSURE

The mandatory disclosure referred to in Section 67 of the Property Practitioners Act, 22 of 2019 shall be in the following format –

IMMOVABLE PROPERTY CONDITION REPORT IN RELATION TO THE SALE OF ANY IMMOVABLE PROPERTY$body$, null, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'ppra.disclaimer'), 'Master', $body$This condition report concerns the immovable property situated at {{property_description}} (the "Property"). This report does not constitute a guarantee or warranty of any kind by the owner of the Property or by the property practitioners representing that owner in any transaction. This report should, therefore, not be regarded as a substitute for any inspections or warranties that prospective purchasers may wish to obtain prior to concluding an agreement of sale in respect of the Property.$body$, null, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'ppra.definitions'), 'Master', $body$In this form –

2.1	"to be aware" means to have actual notice or knowledge of a certain fact or state of affairs; and

2.2	"defect" means any condition, whether latent or patent, that would or could have a significant deleterious or adverse impact on, or affect, the value of the property, that would or could significantly impair or impact upon the health or safety of any future occupants of the property or that, if not repaired, removed or replaced, would or could significantly shorten or adversely affect the expected normal lifespan of the Property.$body$, null, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'ppra.disclosure_of_info'), 'Master', $body$The owner of the Property discloses the information hereunder in the full knowledge that, even though this is not to be construed as a warranty, prospective purchasers of the Property may rely on such information when deciding whether, and on what terms, to purchase the Property. The owner hereby authorises the appointed property practitioner marketing the Property for sale to provide a copy of this statement, and to disclose any information contained in this statement, to any person in connection with any actual or anticipated sale of the Property.$body$, null, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'ppra.additional_info_duty'), 'Master', $body$The owner represents that to the best of his or her knowledge the responses to the statements in respect of the Property contained herein have been accurately noted as "yes", "no" or "not applicable". Should the owner have responded to any of the statements with a "yes", the owner shall be obliged to provide, in the additional information area of this form, a full explanation as to the response to the statement concerned.$body$, null, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'ppra.statements'), 'Master', $body$I am aware of the defects in the roof.
{{ans_defect_roof}}

I am aware of the defects in the electrical systems.
{{ans_defect_electrical}}

I am aware of the defects in the plumbing system, including in the swimming pool (if any).
{{ans_defect_plumbing}}

I am aware of the defects in the heating and air conditioning systems, including the air filters and humidifiers.
{{ans_defect_hvac}}

I am aware of the defects in the septic or other sanitary disposal systems.
{{ans_defect_sanitary}}

I am aware of any defects to the property and/or in the basement or foundations of the property, including cracks, seepage and bulges. Other such defects include, but are not limited to, flooding, dampness or wet walls and unsafe concentrations of mould or defects in drain tiling or sump pumps.
{{ans_defect_basement}}

I am aware of structural defects in the Property.
{{ans_defect_structural}}

I am aware of boundary line dispute, encroachments or encumbrances in connection with the Property.
{{ans_boundary_dispute}}

I am aware that remodeling and refurbishment have affected the structure of the Property.
{{ans_remodel_affected_structure}}

I am aware that any additions or improvements made to or any erections made on the property, have been done or were made, only after the required consents, permissions and permits to do so were properly obtained.
{{ans_additions_with_consent}}

I am aware that a structure on the Property has been earmarked as a historic structure or heritage site.
{{ans_heritage}}$body$, null, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'ppra.additional_info'), 'Master', $body$ADDITIONAL INFORMATION

{{ppra_additional_info}}$body$, null, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'ppra.certifications'), 'Master', $body$6	Owner's certification

The owner hereby certifies that the information provided in this report is, to the best of the owner's knowledge and belief, true and correct as at the date when the owner signs this report.

7	Certification by person supplying information

If a person other than the owner of the property provides the required information that person must certify that he/she is duly authorised by the owner to supply the information and that he/she has supplied the correct information on which the owner relied for the purposes of this report and, in addition, that the information contained herein is, to the best of that person's knowledge and belief, true and correct as at the date on which that person signs this report.$body$, null, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'ppra.notice_and_ack'), 'Master', $body$8	Notice regarding advice or inspections

Both the owner as well as potential buyers of the property may wish to obtain professional advice and/or to undertake a professional inspection of the property. Under such circumstances adequate provisions must be contained in any agreement of sale to be concluded between the parties pertaining to the obtaining of any such professional advice and/or the conducting of required inspections and/or the disclosure of defects and/or the making of required warranties.

9	Buyer's acknowledgement

The prospective buyer acknowledges that he/she has been informed that professional expertise and/or technical skill and knowledge may be required to detect defects in, and non-compliant aspects concerning, the property. The prospective buyer acknowledges receipt of a copy of this statement.$body$, null, true, 'master_template', true
on conflict (clause_id, label) do nothing;

insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)
select (select id from clause where key = 'ppra.signatures'), 'Master', $body$Signed at ________________________ on ________________________

Signature of owner: ____________________________________

Signature of purchaser: ____________________________________

Signature of property practitioner: ____________________________________$body$, null, true, 'master_template', true
on conflict (clause_id, label) do nothing;

-- The template. Not a 'component' render; the generic ClauseDocument.
insert into doc_template (code, label, component, doc_type_id, requires_property, requires_purchaser, description, sort_order, active)
values (
  'ppra_disclosure',
  'Mandatory PPRA disclosure (Section 67)',
  'ClauseDocument',
  (select id from document_type where code = 'ppra_disclosure'),
  true, false,
  'Immovable Property Condition Report in the prescribed format, filled from the structured disclosure on the deal. Signed by the seller and acknowledged by the purchaser before the offer is concluded.',
  60, true
)
on conflict (code) do update set doc_type_id = excluded.doc_type_id, label = excluded.label, description = excluded.description;

insert into doc_template_slot (template_id, clause_id, ordinal, heading, numbering, condition, is_optional, default_on) values
  ((select id from doc_template where code = 'ppra_disclosure'), (select id from clause where key = 'ppra.property_description'), 10, null, null, null, false, true),
  ((select id from doc_template where code = 'ppra_disclosure'), (select id from clause where key = 'ppra.disclaimer'),            20, 'Disclaimer', '1', null, false, true),
  ((select id from doc_template where code = 'ppra_disclosure'), (select id from clause where key = 'ppra.definitions'),           30, 'Definitions', '2', null, false, true),
  ((select id from doc_template where code = 'ppra_disclosure'), (select id from clause where key = 'ppra.disclosure_of_info'),    40, 'Disclosure of information', '3', null, false, true),
  ((select id from doc_template where code = 'ppra_disclosure'), (select id from clause where key = 'ppra.additional_info_duty'),  50, 'Provision of additional information', '4', null, false, true),
  ((select id from doc_template where code = 'ppra_disclosure'), (select id from clause where key = 'ppra.statements'),            60, 'Statements in connection with Property', '5', null, false, true),
  ((select id from doc_template where code = 'ppra_disclosure'), (select id from clause where key = 'ppra.additional_info'),       70, null, null, null, false, true),
  ((select id from doc_template where code = 'ppra_disclosure'), (select id from clause where key = 'ppra.certifications'),        80, null, null, null, false, true),
  ((select id from doc_template where code = 'ppra_disclosure'), (select id from clause where key = 'ppra.notice_and_ack'),        90, null, null, null, false, true),
  ((select id from doc_template where code = 'ppra_disclosure'), (select id from clause where key = 'ppra.signatures'),           100, 'Signatures', '10', null, false, true)
on conflict do nothing;

-- 0069 registered two placeholder templates (house / land) before it was
-- clear they are one prescribed form. Retire them; nothing was built on them.
update doc_template set active = false
 where code in ('ppra_disclosure_house', 'ppra_disclosure_land') and active;
