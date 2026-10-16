-- ============================================================================
-- Dream Knysna OS — 0074 tokenise the short templates
-- ----------------------------------------------------------------------------
-- Plan 019, Arc A follow-up. 0069 seeded Bronwyn's movables agreement, the
-- two addenda and the condition-report appendix with her fill-in blanks kept
-- verbatim. The first live finalise (A5) printed an addendum that said "all
-- fields filled" and was still full of blanks — the record knew the seller,
-- purchaser, erf and address and could not put them on the page.
--
-- This replaces those blanks with {{tokens}} the deal context already
-- supplies (lib/documents/context-deal.ts), so "filled from the record" is
-- true for the short documents too. Signature blocks keep their blanks:
-- place and date are written at signing.
--
-- Only the 'Master' variant of each clause is touched (same rule as 0071).
-- Existing drafts are unaffected: their saved selections still point at the
-- same variant rows, and their field_values already carry these tokens.
-- ============================================================================

-- Helper: update the Master body of one clause.
create or replace function _set_master_body(p_key text, p_body text) returns void
language plpgsql as $$
begin
  update clause_variant v
     set body = p_body
    from clause c
   where v.clause_id = c.id and c.key = p_key and v.label = 'Master';
end $$;

-- movables.definitions — property, purchaser, seller from the record.
select _set_master_body('movables.definitions', $body$DEFINITIONS

In this agreement of sale (hereinafter referred to as "this agreement of sale") the following words and expressions shall have the following meanings:

1.1	"the assets"		the movable assets listed in annexure "A" hereto which has been initialled by the parties for purposes of identification;

1.2	"the effective date"	the date of registration of transfer of the property into the name of the purchaser;

1.3	"the parties"	the seller and the purchaser;

1.4	"the property"		Erf {{erf_number}} Knysna, known as {{property_known_as}};

1.5	"the purchaser"		{{purchaser_names}}

1.6	"the seller"	{{seller_names}}$body$);

-- movables.purchase_price — figures and words, same convention as 0071.
select _set_master_body('movables.purchase_price', $body$The purchase price for the assets is the sum of R{{movables_price}}

({{movables_price_words}} RAND).$body$);

-- addendum.parties — the agreement of sale being amended.
select _set_master_body('addendum.parties', $body$ADDENDUM

to the Agreement of Sale entered into between:

{{seller_names}}

(hereinafter referred to as "the SELLER", and duly authorised thereto)

and

{{purchaser_names}}

(hereinafter referred to as "the PURCHASER", and duly authorised thereto)

(Collectively referred to as the Parties)

in respect of Erf {{erf_number}} Knysna ({{property_known_as}}), dated {{agreement_date}}

("the agreement of sale")$body$);

-- addendum_movables.parties — the movables agreement being amended.
select _set_master_body('addendum_movables.parties', $body$ADDENDUM TO AGREEMENT OF SALE IN RESPECT OF MOVABLES

entered into between:

{{seller_names}}

(hereinafter referred to as "the SELLER", and duly authorised thereto)

and

{{purchaser_names}}

(hereinafter referred to as "the PURCHASER", and duly authorised thereto)

(Collectively referred to as the Parties)

in respect of Erf {{erf_number}} Knysna (known as {{property_known_as}}),

dated {{movables_agreement_date}}

("the Movables Agreement")$body$);

-- condition_report.seller_unable — the agent's own disclosures, if any.
select _set_master_body('condition_report.seller_unable', $body$APPENDIX TO PROPERTY CONDITION REPORT WHERE THE SELLER IS UNABLE TO COMPLETE IT

It is hereby recorded that the SELLER is unable to complete the Disclosure due to lack of suitable knowledge.

Notwithstanding anything contained in the Property Practitioner Act, the Purchaser hereby accepts the Property Condition Report, blank and incomplete, and buys completely at own risk, mindful of the right to appoint a building inspector of his/her own choice and at his/her own expense.

The Purchaser hereby waives any claims against the agent as he/she may have otherwise had, due to the Property Condition Report Form not being completed.

The parties hereby record that the Agent has not made any disclosures regarding the condition of the property other than:

{{agent_disclosures}}$body$);

drop function _set_master_body(text, text);
