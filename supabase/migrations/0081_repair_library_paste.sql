-- ============================================================================
-- Dream Knysna OS — 0081 repair library wordings damaged in transit
-- ----------------------------------------------------------------------------
-- 0076 and 0078 were pasted into the Supabase SQL editor by copying from a
-- file preview, which dropped characters mid-word in 17 clause wordings
-- ("fulfillmeof", "propertcopy"…). Found 2026-10-17 with
-- scripts/check-library-detail.sql. This rewrites exactly those wordings
-- from the repo text. Drafts resolve from the library on every open, so
-- they are repaired too; nothing had been finalised from these wordings.
--
-- From now on migrations are copied with `pbcopy < file` in Terminal, and
-- scripts/check-library.sql is run after each library migration.
-- ============================================================================

update clause_variant v set body = $body$In this form –

2.1	"to be aware" means to have actual notice or knowledge of a certain fact or state of affairs; and

2.2	"defect" means any condition, whether latent or patent, that would or could have a significant deleterious or adverse impact on, or affect, the value of the property, that would or could significantly impair or impact upon the health or safety of any future occupants of the property or that, if not repaired, removed or replaced, would or could significantly shorten or adversely affect the expected normal lifespan of the Property.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'ppra.definitions' and v.label = 'Master';

update clause_variant v set body = $body$20.1	If any dispute, difference or question arises at any time between the parties out of or in regard to any matters arising out of, or the rights and duties of any of the parties, or the interpretation of, or termination of, or any matter arising out of the termination of, or the rectification of this agreement, such dispute shall be submitted to and decided by arbitration on notice given by either party to the other of them in terms of this paragraph.

20.2	Such arbitration shall be held in Knysna in accordance with the provisions of the Arbitration Act No 42 of 1965 (as amended) save that the arbitration shall be informal and the arbitrator shall have the absolute discretion to determine the procedure to be adopted, it being the intention that the arbitration shall be held and concluded without delay.

20.3	The arbitrator shall be such independent or suitably qualified person as may be agreed upon between the parties in writing, and failing such agreement, the arbitrator shall be appointed by the President for the time being of the Law Society of the Cape of Good Hope or its successor/s at the request of either party.

20.4	The contents of Arbitration clause is severable from the rest of this agreement and shall remain in force notwithstanding the termination of this agreement for whatever reason.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.arbitration' and v.label = 'Master';

update clause_variant v set body = $body$8.1	This Agreement of Sale is subject to the PURCHASER within 30 (THIRTY) days of acceptance, being granted a loan by a South African Bank or financial institution in the amount of R{{bond_amount}} ({{bond_amount_words}} Rand) or such lesser amount as the PURCHASER may, in writing, accept; the repayment of which loan may be required by such lending bank or similar financial institution, to be secured by the registration of a mortgage bond over the property simultaneously with transfer thereof to the PURCHASER.  The aforesaid date shall be automatically extended by a further 30 (THIRTY) days if required.  This condition shall be deemed to have been fulfilled upon the issue to the PURCHASER by the said bank or financial institution of a written quotation and a written pre-agreement statement as contemplated in section 92 of the National Credit Act No. 34 of 2005 in respect of the loan in the said amount within the period referred to in this paragraph, whether or not such quotation or pre-agreement statement is accepted by the PURCHASER.

8.2	The PURCHASER acknowledges that the PURCHASER is aware that the granting of credit is subject to costs and charges levied in terms of the National Credit Act.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.bond' and v.label = 'Bond';

update clause_variant v set body = $body$19.1	The SELLER confirms that he is in possession of all approved municipal building plans relating to the improvements erected on the Property ("as-built plans") and has provided the PURCHASER with copies thereof prior to the signing of this Agreement. The PURCHASER acknowledges receipt of the plans and hereby confirms that they are satisfied with the documentation provided.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.building_plans' and v.label = 'Plans available';

update clause_variant v set body = $body$19.1	The SELLER confirms that Municipal building plans for all or part of the existing improvements are not presently available and has disclosed this to the PURCHASER. The SELLER undertakes at their own risk to obtain all required Municipal approvals and approved building plans on or before date of registration and transfer of the property, and should the SELLER fail to procure such approvals within this time limit prior to transfer, the Conveyancer is irrevocably authorised and instructed to retain the sum of R100,000 (One Hundred Thousand Rand) (“the retained amount”) from the SELLER’s proceeds of the sale, to be held in trust pending compliance with the SELLER’s obligations under this clause. Upon the SELLER furnishing proof that the required approvals and plans have been obtained, the retained amount shall be released to the SELLER. If the SELLER has not obtained the required approvals within 3 (three) months from date of transfer of the property, the retained amount shall be paid to the PURCHASER without prejudice to any further rights or remedies the PURCHASER may have in law under this agreement.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.building_plans' and v.label = 'Plans not available — R100 000 retained';

update clause_variant v set body = $body$17.1	Should the PURCHASER sign this Agreement as agent for a company, close corporation or other juristic person to be formed, the signatory shall be deemed to be personally liable in terms of this Agreement should the company, close corporation or juristic person not be incorporated or formed or not ratify and adopt this Agreement within 30 (THIRTY) days of the date of signature hereof.  Upon formation or incorporation or ratification as aforesaid, the PURCHASER by his signature hereto binds himself as surety for and co-principal debtor in solidum with the company, close corporation or other juristic person or entity for the due and punctual performance by the company, close corporation or other juristic person or entity of its obligations arising out of this Agreement.

17.2	In the event of any of the parties to this Agreement being a company, close corporation, trust or other juristic person or entity, the person who signs this Agreement in the name or on behalf of such company, close corporation, trust or other juristic person or entity hereby warrants that such legal entity is indeed duly registered in terms of the applicable legislation and warrants that he is duly authorized to act for and/or on behalf of such legal entity, and he hereby binds himself as surety and co-principal debtor with such juristic person or entity in favour of the SELLER for all the obligations of such juristic person or entity in terms of this Agreement.  Such signatory shall be personally liable as PURCHASER or SELLER (as the case may be) in terms of this Agreement if such juristic person or entity legally does not exist and/or for whatsoever reason is not bound to this Agreement and/or fails to comply with any of the provisions hereof.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.capacity' and v.label = 'Master';

update clause_variant v set body = $body$9.1	Commission is payable by the SELLER and is calculated at {{commission_pct}}% of the Purchase Price plus VAT.  Such commission shall be due on fulfilment of the suspensive conditions herein and payable upon Transfer and Registration of transfer of the property into the name of the PURCHASER. The SELLER hereby irrevocably instructs the Conveyancers to pay the commission amount to Dream Knysna (Pty) Limited as first draw against the proceeds of the sale.

9.2	The PURCHASER warrants and undertakes to the SELLER that the PURCHASER has not been introduced to the property by any third party entitled to commission other than the agent/s specified in this Agreement on Page 2 of the CONTRACT INFORMATION.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.commission' and v.label = 'Master';

update clause_variant v set body = $body$CONVEYANCER:	{{conveyancer_name}}

TEL & EMAIL:	{{conveyancer_contact}}

SELLING AGENTS:	DREAM KNYSNA (PTY) LIMITED (FFC 2026 – 2028 No. 20261501621) hereby warrant the validity of the required FFC’s as at date of signature of this agreement. Agent/Property Practitioner: {{agent_name}}

THE SELLER agrees to sell to the PURCHASER who agrees to purchase the following property (hereinafter called "the property") upon the following terms and conditions:$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.contract_info_close' and v.label = 'Master';

update clause_variant v set body = $body$10.1	The property is sold, as regards its extent, as set out in the title deed(s) thereof, and the SELLER shall not be liable in respect of any shortfall and shall have no claim in respect of any excess which may be found on re-survey of the property.

10.2	The PURCHASER acknowledges that he has satisfied himself by personal inspection, or by means of independent sources of information, concerning any burdens or servitudes to which the property may be subject, and also concerning all advantages and disadvantages attaching to the property; and hereby agrees that the SELLER shall not be liable to him/her in respect of any failure by the SELLER or his Agent to inform him of any such qualities.

10.3	The SELLER gives no express or implied warranty whatsoever with respect to the property or any aspect thereof.  Moreover, the property is sold "voetstoots" as it now lies, with any patent or latent defects to which it may be subject.

10.4	The PURCHASER acknowledges that he has not been influenced into entering into this Agreement by any express or implied information, statement or representation given or made by or on behalf of the SELLER; the PURCHASER hereby waives in favour of the SELLER any rights whatsoever which he otherwise may have obtained against the SELLER as result of any such information, statement or representation given or made by or on behalf of the SELLER.

10.5	This Deed of Sale constitutes the entire Agreement between the parties, and no other conditions, stipulations, warranties or representatives whatsoever have been made by either party or his agent other than such as are contained herein.  No modification, variation or alteration hereto shall be valid unless in writing and signed by both parties or their respective agents.

10.6	Any latitude which may have been allowed by the SELLER in respect of any breach by the PURCHASER in terms hereof, shall not under any circumstances be deemed to be a waiver of the SELLER's rights under this agreement nor a novation hereof, nor shall it prevent the SELLER from exercising any right nor absolve the PURCHASER from any obligation under this Agreement.

10.7	Should there be more than one PURCHASER, their liability in terms of this agreement shall be joint and several.

10.8	As per Requirements by Law, the SELLER and PURCHASER warrant that they are aware of their obligations in terms of the Financial Intelligence Centre Act and shall produce all necessary documents to comply with this Act to the Agent and Conveyancer.

10.9	As per SARS Declaration, the SELLER and PURCHASER warrant and confirm to each other and the Estate Agent, that they have met all their tax obligations and commitments to the South African Receiver of Revenue Services, whether in their personal capacity or otherwise. Should the transfer be delayed or cancelled as a result of this breach of warrantee, the defaulting party will be liable for all costs incurred and damages suffered by the aggrieved party in accordance with the Breach Clause above.

10.10	The SELLER and PURCHASER hereby give their consent to Dream Knysna (Pty) Limited and the Conveyancing Attorneys, who will register the transfer of the property, to process their personal information for all purposes and requirements that are specifically related to this sale in accordance with the Provisions of the Protection of the Personal Information Act (“POPIA”).

10.11	The SELLER hereby warrants that he, to the best of his knowledge, is not aware of any invasive species of vegetation and plant life, as prescribed in the Regulations of the NEMBA Act (Act 10 of 2004), on the Property and that he is not in possession of any valid permit to keep any such species on the Property.

10.12	Dream Knysna (Pty) Limited are hereby authorised to erect a SOLD board on the Property for a period of three months period after selling the property.

10.13	In this Agreement words importing the singular shall include the plural and vice versa, words importing the masculine gender shall include the female gender and vice versa.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.general' and v.label = 'Master';

update clause_variant v set body = $body$The Parties to the Agreement choose their respective domicilia citandi et executandi for all purposes arising hereunder and as their respective addresses for the service of any notices required to be served upon them at the addresses detailed on Page 2 “Contract Information”.

12.1	Any notice or communication required or permitted in terms of this Agreement shall be valid and effective only if in writing, but it shall be competent to give such notice by email.

12.2	Either party may, by notice to the other, change the physical address chosen as his domicilium, or may advise via email; provided that such change[s] shall only become effective on the sixth business day after the date of receipt, or deemed date of receipt, of such notice by the addressee.

12.3	Any notice to a party shall –

Notwithstanding anything to the contrary herein contained a written notice or communication actually received by a party to this Agreement shall be an adequate written notice or communication to him/her notwithstanding that it was not sent to or delivered at the chosen domicilium citandi et executandi or sent via email address as stipulated herein.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.notices' and v.label = 'Master';

update clause_variant v set body = $body$5.1	The PURCHASER shall take vacant occupation and possession of the property on {{occupation_date}} into his name.

5.2	Should the date of occupation not coincide with the date of transfer, the occupant shall monthly in advance pay to the owner, occupational rental in the sum of R {{occupational_rent}} ({{occupational_rent_words}} Rand) per month for the period of occupation, or pro-rata thereof if applicable.  The occupant shall, during such occupation, be responsible for the cost of all utility bills, including electricity, water, gas (if applicable) and internet etc and shall keep the Property, including garden and pool, in a neat and well-maintained condition.  Should the occupant be the PURCHASER, occupation will only be given once the PURCHASER has performed all his contractual obligations, including but not limited to, payment of transfer and bond costs, signature of transfer and bond documents (if applicable) and payment of occupational rental as agreed.

5.3	Should the occupant be the PURCHASER, he shall not be entitled to effect any alterations in respect of the Property without the prior, written consent of the SELLER.

5.4	In the event of this agreement being cancelled for any reason whatsoever and the PURCHASER has taken early occupation; the PURCHASER will vacate the Property immediately and return the Property to the SELLER in the same condition.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.occupation' and v.label = 'Master';

update clause_variant v set body = $body$5.5	Occupation shall, by operation of law, be subject to the existing lease in respect of the property, a copy of which the PURCHASER acknowledges to have in his possession.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.occupation_lease' and v.label = 'Property is let';

update clause_variant v set body = $body$5.6	The Purchaser shall be obliged, in the event of cancellation of this Agreement to vacate the Property within (7) Seven days of written request by the Conveyancer to do so, it being expressly agreed between the parties that no tenancy shall be created by virtue of the Purchaser taking occupation of the property prior to registration of transfer.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.occupation_vacate' and v.label = 'Master';

update clause_variant v set body = $body$2.1	The purchase price payable by the PURCHASER to the SELLER for the property is R{{purchase_price}} ({{purchase_price_words}} Rand) and shall be payable to the SELLER on registration of transfer of the property into the name of the PURCHASER, to be secured by :

2.2	a deposit of R{{deposit}} ({{deposit_words}} Rand) payable within 7 (Seven) working days of acceptance hereof, which amount is to be paid in cash to the SELLER's Conveyancer; and which amounts shall be invested by the SELLER's Conveyancers in an interest-bearing account until transfer, the interest earned thereon to accrue to the PURCHASER.

2.3	the balance on or before the {{guarantee_date}} by issue of a guarantee by a bank or financial institution acceptable to the SELLER’s Conveyancer. In the event of this agreement being subject to the fulfillment of a suspensive condition(s) such guarantee shall be furnished within 14 (Fourteen) days of fulfillment of such condition(s).$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.purchase_price' and v.label = 'Master';

update clause_variant v set body = $body$22.2	THESEN ISLAND PROPERTIES: It is recorded that a special “Entry Fee” equivalent to 12 times (one year) the applicable monthly Levy will be raised as an Entry Fee Levy on all new Homeowners or existing Homeowners purchasing additional properties as laid out by the Trustees of Thesen Islands Homeowners Association (“TIHOA”) on transfer of their property on Thesen Islands payable to TIHOA.  This rule may be amended from time to time by the Trustees. The SELLER acknowledges that prior to the TIHOA issuing a clearance certificate allowing transfer of the property the TIHOA will carry out an inspection of the property to ascertain that the standard of the property is in accordance with their regulations. The TIHOA will issue a report stating the improvements that need to be carried out and the SELLER will have to abide by these at their cost.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.recordal_thesen' and v.label = 'Thesen Islands';

update clause_variant v set body = $body$This Agreement of Sale is subject to the following suspensive conditions, failing which this Agreement shall be of no further force and effect.  It is further recorded that this clause is for the benefit of the PURCHASER who may unilaterally waive it at any time prior to the fulfilment of this condition.

24.1	The PURCHASER viewing the Property by no later than {{viewing_by}} and confirming to the SELLER or his Conveyancer in writing within 2 (TWO) days after such viewing to the effect that he wishes to proceed with the sale.$body$
  from clause c
 where v.clause_id = c.id and c.key = 'sale.suspensive' and v.label = 'Subject to viewing';

