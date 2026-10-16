#!/usr/bin/env python3
"""
Generate supabase/migrations/0078_seed_sale_house.sql from Bronwyn's 2026
freehold-house master (docs/templates/2026-final/
dream-properties-agreement-of-sale-freehold-house-template-2026.md).

Wording is verbatim. The only changes to her text are:
  * fill-in blanks  →  {{tokens}} the deal context or the editor supplies;
  * "DELETE / OR / IF APPLICABLE" alternatives  →  library variants the
    agent picks (or that the deal picks: bond vs cash, estate recordal);
  * where a choice is "not applicable", a one-line "Not applicable" variant
    keeps the clause number in place. Those lines are marked `ours=True`
    below and listed in the migration header for Bronwyn to approve.

Run:  python3 scripts/seed-sale-house.py > supabase/migrations/0078_seed_sale_house.sql
"""

T = "agreement_sale_house"

# (key, label, category, description)
# slots: (ordinal, key, heading, numbering, is_optional, default_on)
# variants: key -> list of dict(label, body, applies_when=None, default=False, ours=False)

clauses = []
slots = []
variants = {}


def clause(key, label, category, desc, ordinal, heading=None, numbering=None, vs=None, optional=False, default_on=True):
    clauses.append((key, label, category, desc))
    slots.append((ordinal, key, heading, numbering, optional, default_on))
    variants[key] = vs


def v(label, body, applies_when=None, default=False, ours=False):
    return dict(label=label, body=body.strip("\n"), applies_when=applies_when, default=default, ours=ours)


# --------------------------------------------------------------------------
# Page 1 — parties and CONTRACT INFORMATION
# --------------------------------------------------------------------------
clause("sale.parties", "Agreement of sale — parties", "general",
       "Title and the two parties, as on page 1 of the master.", 10, vs=[v("Master", """
AGREEMENT OF SALE

Entered into between:

{{seller_names}}

(hereinafter referred to as "the SELLER", and duly authorised thereto)

and

{{purchaser_names}}

(hereinafter referred to as "the PURCHASER", and duly authorised thereto)
""", default=True)])

clause("sale.contract_info", "Contract information — parties, property, price, deposit", "general",
       "The CONTRACT INFORMATION block: both parties' details, property, purchase price, deposit.", 20, vs=[v("Master", """
CONTRACT INFORMATION:

SELLER DETAILS:

Full Names:\t{{seller_names}}

Duly Represented by:\t{{seller_represented_by}}

ID/Passport/Registration No:\t{{seller_ids}}

Postal Address:\t{{seller_postal}}

Domicilia Citandi:\t{{seller_domicilium}}

Marital Status:\t{{seller_marital}}

Date & Place of Marriage:\t{{seller_marriage}}

E-mail:\t{{seller_email}}

Contact Numbers:\t{{seller_phone}}

PURCHASER DETAILS:

Full Names:\t{{purchaser_names}}

Duly Represented by:\t{{purchaser_represented_by}}

ID/Passport/Registration No:\t{{purchaser_ids}}

Postal Address:\t{{purchaser_postal}}

Domicilia Citandi:\t{{purchaser_domicilium}}

Marital Status:\t{{purchaser_marital}}

Date & Place of Marriage:\t{{purchaser_marriage}}

E-mail:\t{{purchaser_email}}

Contact Numbers:\t{{purchaser_phone}}

PROPERTY DETAILS:\tERF {{erf_number}}, KNYSNA, situated at {{property_known_as}}

PURCHASE PRICE:\tR {{purchase_price}} ({{purchase_price_words}})

DEPOSIT:\tR {{deposit}} ({{deposit_words}})
""", default=True)])

clause("sale.contract_info_bond", "Contract information — bond line", "financial",
       "BOND line of the contract information. Chosen by the deal: a bond amount prints it; none means a cash sale.", 25, vs=[
    v("Bond", "BOND:\tR {{bond_amount}} ({{bond_amount_words}})", applies_when={"bond_amount_set": True}),
    v("Cash sale", "BOND:\tNot applicable", default=True, ours=True),
])

clause("sale.contract_info_close", "Contract information — conveyancer, selling agents, sale", "signature",
       "Conveyancer, selling agents with the FFC warrant, and the operative sentence.", 30, vs=[v("Master", """
CONVEYANCER:\t{{conveyancer_name}}

TEL & EMAIL:\t{{conveyancer_contact}}

SELLING AGENTS:\tDREAM KNYSNA (PTY) LIMITED (FFC 2026 – 2028 No. 20261501621) hereby warrant the validity of the required FFC’s as at date of signature of this agreement. Agent/Property Practitioner: {{agent_name}}

THE SELLER agrees to sell to the PURCHASER who agrees to purchase the following property (hereinafter called "the property") upon the following terms and conditions:
""", default=True)])

# --------------------------------------------------------------------------
# 1 – 4
# --------------------------------------------------------------------------
clause("sale.property", "1 The property", "general", "Erf, address, extent, title deed.", 40, "THE PROPERTY", "1", vs=[v("Master", """
ERF {{erf_number}}, KNYSNA, in the Province of the Western Cape, situated at {{property_known_as}}, Knysna, measuring {{extent_sqm}} square metres in extent and held under Title Deed No {{title_deed_no}}.
""", default=True)])

clause("sale.purchase_price", "2 Purchase price, deposit, guarantee", "financial",
       "Price in figures and words, deposit within 7 working days to the conveyancer, balance guaranteed.", 50, "PURCHASE PRICE", "2", vs=[v("Master", """
2.1\tThe purchase price payable by the PURCHASER to the SELLER for the property is R{{purchase_price}} ({{purchase_price_words}} Rand) and shall be payable to the SELLER on registration of transfer of the property into the name of the PURCHASER, to be secured by :

2.2\ta deposit of R{{deposit}} ({{deposit_words}} Rand) payable within 7 (Seven) working days of acceptance hereof, which amount is to be paid in cash to the SELLER's Conveyancer; and which amounts shall be invested by the SELLER's Conveyancers in an interest-bearing account until transfer, the interest earned thereon to accrue to the PURCHASER.

2.3\tthe balance on or before the {{guarantee_date}} by issue of a guarantee by a bank or financial institution acceptable to the SELLER’s Conveyancer. In the event of this agreement being subject to the fulfillment of a suspensive condition(s) such guarantee shall be furnished within 14 (Fourteen) days of fulfillment of such condition(s).
""", default=True)])

clause("sale.costs", "3 Costs", "financial", "Purchaser pays transfer costs and transfer duty.", 60, "COSTS", "3", vs=[v("Master", """
The PURCHASER shall pay all transfer costs incurred to enable registration of transfer of the property into his name, including Transfer Duty which amounts shall be paid upon request of the SELLER's Conveyancers.
""", default=True)])

clause("sale.transfer_risk", "4 Transfer and risk", "general", "Transfer date, risk passes on transfer, FICA.", 70, "TRANSFER & RISK", "4", vs=[v("Master", """
Transfer of the property shall be passed by the SELLER's Conveyancers and shall be given and taken on {{transfer_date}} or as soon as is reasonably possible thereafter.  Both parties shall sign all transfer documents on request by SELLER’s Conveyancers.  The property shall remain at the risk of the SELLER until the date of transfer from which date the property shall be at the sole risk of the PURCHASER. Furthermore, the Seller and the Purchaser undertake to comply with the Financial Intelligent Centre Act No.38 of 2001, providing all documents as required, when called upon to do so by the Conveyancer and the Agent.
""", default=True)])

# --------------------------------------------------------------------------
# 5 Possession & occupation (5.5 is the "existing lease" line)
# --------------------------------------------------------------------------
clause("sale.occupation", "5.1–5.4 Possession and occupation", "general",
       "Occupation date, occupational rent if occupation and transfer differ, no alterations, vacate on cancellation.", 80,
       "POSSESSION & OCCUPATION", "5", vs=[v("Master", """
5.1\tThe PURCHASER shall take vacant occupation and possession of the property on {{occupation_date}} into his name.

5.2\tShould the date of occupation not coincide with the date of transfer, the occupant shall monthly in advance pay to the owner, occupational rental in the sum of R {{occupational_rent}} ({{occupational_rent_words}} Rand) per month for the period of occupation, or pro-rata thereof if applicable.  The occupant shall, during such occupation, be responsible for the cost of all utility bills, including electricity, water, gas (if applicable) and internet etc and shall keep the Property, including garden and pool, in a neat and well-maintained condition.  Should the occupant be the PURCHASER, occupation will only be given once the PURCHASER has performed all his contractual obligations, including but not limited to, payment of transfer and bond costs, signature of transfer and bond documents (if applicable) and payment of occupational rental as agreed.

5.3\tShould the occupant be the PURCHASER, he shall not be entitled to effect any alterations in respect of the Property without the prior, written consent of the SELLER.

5.4\tIn the event of this agreement being cancelled for any reason whatsoever and the PURCHASER has taken early occupation; the PURCHASER will vacate the Property immediately and return the Property to the SELLER in the same condition.
""", default=True)])

clause("sale.occupation_lease", "5.5 Existing lease", "general",
       "Only when the property is let: occupation is subject to the existing lease.", 85, vs=[
    v("Not let", "5.5\tNot applicable.", default=True, ours=True),
    v("Property is let", "5.5\tOccupation shall, by operation of law, be subject to the existing lease in respect of the property, a copy of which the PURCHASER acknowledges to have in his possession."),
])

clause("sale.occupation_vacate", "5.6 Vacate on cancellation, no tenancy", "general",
       "Purchaser in early occupation vacates within 7 days of cancellation; no tenancy created.", 88, vs=[v("Master", """
5.6\tThe Purchaser shall be obliged, in the event of cancellation of this Agreement to vacate the Property within (7) Seven days of written request by the Conveyancer to do so, it being expressly agreed between the parties that no tenancy shall be created by virtue of the Purchaser taking occupation of the property prior to registration of transfer.
""", default=True)])

# --------------------------------------------------------------------------
# 6 – 7
# --------------------------------------------------------------------------
clause("sale.rates", "6 Rates and charges", "financial", "Municipal clearance (s118), purchaser pays from transfer.", 90, "RATES AND CHARGES", "6", vs=[v("Master", """
The SELLERS authorise the Conveyancer to obtain a municipal clearance certificate from the municipality including any possible historical debt due and payable to the municipality as required in terms of Section 118(1) and 118(3) of the Municipal Systems Act 32 of 2000. The Conveyancer shall determine from the municipal rates assessment form if there are any such arrear rates and taxes due to the municipality and shall obtain an instruction from the SELLERS to settle these arrears.

The PURCHASERS shall be liable for the payment of any Local Authority Rates and other charges, including any levies, in respect of the property beyond the date of Transfer and Registration.
""", default=True)])

clause("sale.breach", "7 Default / breach", "general", "Seven days' notice, then enforce or cancel and claim damages.", 100, "DEFAULT / BREACH", "7", vs=[v("Master", """
Should any Party to this agreement (‘the defaulting party’) breach any of his obligations under this Agreement (which shall include the signature of any documentation relating to the passing of transfer or the payment of any amount due under this agreement or the delivery of the guarantee referred to above) and remain in breach thereof after the expiry of a period of Seven (7) days’ notice in writing, given to the defaulting party by the non-defaulting party or on his behalf calling upon the defaulting party to remedy such breach the non-defaulting party shall have the right, without prejudice to any other rights to which he may be entitled in law or under this Agreement namely:-  EITHER

7.1\tto hold the defaulting party bound to this Agreement, to enforce performance of the obligations of the defaulting party hereunder and (if applicable) to claim immediate payment of all amounts payable by the defaulting party under this Agreement, including (if applicable) payment of the full balance of the purchase price outstanding together with any default interest accruing thereon, costs and other charges; OR

7.2\tto cancel this Agreement forthwith; and

7.2.1\tto retake possession of the property, the PURCHASER hereby waiving any lien for improvements which he may have over the property; and

7.2.2\tto claim damages from the defaulting party in which event, if the PURCHASER is the defaulting party, the SELLER shall not be obliged to return to the PURCHASER such amounts as have already been paid by the PURCHASER, but shall be entitled to retain such amounts, together with interest accruing thereon, until such dispute, if any, has been settled.
""", default=True)])

# --------------------------------------------------------------------------
# 8 Bond — chosen by the deal (bond amount present or not)
# --------------------------------------------------------------------------
clause("sale.bond", "8 Bond", "suspensive",
       "Bond approval within 30 days (auto-extends 30), NCA s92 quotation fulfils it. Cash sale: not applicable.", 110, "BOND", "8", vs=[
    v("Bond", """
8.1\tThis Agreement of Sale is subject to the PURCHASER within 30 (THIRTY) days of acceptance, being granted a loan by a South African Bank or financial institution in the amount of R{{bond_amount}} ({{bond_amount_words}} Rand) or such lesser amount as the PURCHASER may, in writing, accept; the repayment of which loan may be required by such lending bank or similar financial institution, to be secured by the registration of a mortgage bond over the property simultaneously with transfer thereof to the PURCHASER.  The aforesaid date shall be automatically extended by a further 30 (THIRTY) days if required.  This condition shall be deemed to have been fulfilled upon the issue to the PURCHASER by the said bank or financial institution of a written quotation and a written pre-agreement statement as contemplated in section 92 of the National Credit Act No. 34 of 2005 in respect of the loan in the said amount within the period referred to in this paragraph, whether or not such quotation or pre-agreement statement is accepted by the PURCHASER.

8.2\tThe PURCHASER acknowledges that the PURCHASER is aware that the granting of credit is subject to costs and charges levied in terms of the National Credit Act.
""", applies_when={"bond_amount_set": True}),
    v("Cash sale", "Not applicable.", default=True, ours=True),
])

# --------------------------------------------------------------------------
# 9 – 14
# --------------------------------------------------------------------------
clause("sale.commission", "9 Commission", "financial", "Seller pays commission % plus VAT on transfer; purchaser warrants no other introducing agent.", 120, "COMMISSION", "9", vs=[v("Master", """
9.1\tCommission is payable by the SELLER and is calculated at {{commission_pct}}% of the Purchase Price plus VAT.  Such commission shall be due on fulfilment of the suspensive conditions herein and payable upon Transfer and Registration of transfer of the property into the name of the PURCHASER. The SELLER hereby irrevocably instructs the Conveyancers to pay the commission amount to Dream Knysna (Pty) Limited as first draw against the proceeds of the sale.

9.2\tThe PURCHASER warrants and undertakes to the SELLER that the PURCHASER has not been introduced to the property by any third party entitled to commission other than the agent/s specified in this Agreement on Page 2 of the CONTRACT INFORMATION.
""", default=True)])

clause("sale.general", "10 General conditions", "general",
       "Extent per title deed, servitudes, voetstoots, no representations, entire agreement, latitude, joint and several, FICA, SARS, POPIA, NEMBA, SOLD board, interpretation.", 130,
       "GENERAL CONDITIONS", "10", vs=[v("Master", """
10.1\tThe property is sold, as regards its extent, as set out in the title deed(s) thereof, and the SELLER shall not be liable in respect of any shortfall and shall have no claim in respect of any excess which may be found on re-survey of the property.

10.2\tThe PURCHASER acknowledges that he has satisfied himself by personal inspection, or by means of independent sources of information, concerning any burdens or servitudes to which the property may be subject, and also concerning all advantages and disadvantages attaching to the property; and hereby agrees that the SELLER shall not be liable to him/her in respect of any failure by the SELLER or his Agent to inform him of any such qualities.

10.3\tThe SELLER gives no express or implied warranty whatsoever with respect to the property or any aspect thereof.  Moreover, the property is sold "voetstoots" as it now lies, with any patent or latent defects to which it may be subject.

10.4\tThe PURCHASER acknowledges that he has not been influenced into entering into this Agreement by any express or implied information, statement or representation given or made by or on behalf of the SELLER; the PURCHASER hereby waives in favour of the SELLER any rights whatsoever which he otherwise may have obtained against the SELLER as result of any such information, statement or representation given or made by or on behalf of the SELLER.

10.5\tThis Deed of Sale constitutes the entire Agreement between the parties, and no other conditions, stipulations, warranties or representatives whatsoever have been made by either party or his agent other than such as are contained herein.  No modification, variation or alteration hereto shall be valid unless in writing and signed by both parties or their respective agents.

10.6\tAny latitude which may have been allowed by the SELLER in respect of any breach by the PURCHASER in terms hereof, shall not under any circumstances be deemed to be a waiver of the SELLER's rights under this agreement nor a novation hereof, nor shall it prevent the SELLER from exercising any right nor absolve the PURCHASER from any obligation under this Agreement.

10.7\tShould there be more than one PURCHASER, their liability in terms of this agreement shall be joint and several.

10.8\tAs per Requirements by Law, the SELLER and PURCHASER warrant that they are aware of their obligations in terms of the Financial Intelligence Centre Act and shall produce all necessary documents to comply with this Act to the Agent and Conveyancer.

10.9\tAs per SARS Declaration, the SELLER and PURCHASER warrant and confirm to each other and the Estate Agent, that they have met all their tax obligations and commitments to the South African Receiver of Revenue Services, whether in their personal capacity or otherwise. Should the transfer be delayed or cancelled as a result of this breach of warrantee, the defaulting party will be liable for all costs incurred and damages suffered by the aggrieved party in accordance with the Breach Clause above.

10.10\tThe SELLER and PURCHASER hereby give their consent to Dream Knysna (Pty) Limited and the Conveyancing Attorneys, who will register the transfer of the property, to process their personal information for all purposes and requirements that are specifically related to this sale in accordance with the Provisions of the Protection of the Personal Information Act (“POPIA”).

10.11\tThe SELLER hereby warrants that he, to the best of his knowledge, is not aware of any invasive species of vegetation and plant life, as prescribed in the Regulations of the NEMBA Act (Act 10 of 2004), on the Property and that he is not in possession of any valid permit to keep any such species on the Property.

10.12\tDream Knysna (Pty) Limited are hereby authorised to erect a SOLD board on the Property for a period of three months period after selling the property.

10.13\tIn this Agreement words importing the singular shall include the plural and vice versa, words importing the masculine gender shall include the female gender and vice versa.
""", default=True)])

clause("sale.enforcement_costs", "11 Costs of enforcement", "general", "Party in breach pays attorney-and-client costs.", 140,
       "COSTS OF ENFORCEMENT OF SELLER’S AND PURCHASER’S RIGHTS", "11", vs=[v("Master", """
If for any reason whatsoever any party instructs his attorneys to take action against the other party in terms hereof, and notwithstanding that such action may not involve litigation or the issue of process from any court of law, then the party that is in breach shall be liable for, and the innocent party shall be entitled to recover on demand, all such legal fees incurred by such party including in particular wasted costs of transfer, collection costs and all costs on an attorney/client scale, notwithstanding that, in the absence of this paragraph, the innocent party would not be entitled to recover any costs from the party in breach, or costs other than on a party and party scale.
""", default=True)])

clause("sale.notices", "12 Notices and domicilia", "general", "Domicilia per contract information; email notices; change of address.", 150,
       "NOTICES AND DOMICILIA", "12", vs=[v("Master", """
The Parties to the Agreement choose their respective domicilia citandi et executandi for all purposes arising hereunder and as their respective addresses for the service of any notices required to be served upon them at the addresses detailed on Page 2 “Contract Information”.

12.1\tAny notice or communication required or permitted in terms of this Agreement shall be valid and effective only if in writing, but it shall be competent to give such notice by email.

12.2\tEither party may, by notice to the other, change the physical address chosen as his domicilium, or may advise via email; provided that such change[s] shall only become effective on the sixth business day after the date of receipt, or deemed date of receipt, of such notice by the addressee.

12.3\tAny notice to a party shall –

Notwithstanding anything to the contrary herein contained a written notice or communication actually received by a party to this Agreement shall be an adequate written notice or communication to him/her notwithstanding that it was not sent to or delivered at the chosen domicilium citandi et executandi or sent via email address as stipulated herein.
""", default=True)])

clause("sale.expiry", "13 Expiry of the offer", "general", "First signature is an irrevocable offer, open until 12h00 on the date set.", 160,
       "EXPIRY", "13", vs=[v("Master", """
The first signature to this agreement shall constitute an irrevocable offer, which may not be withdrawn prior to presentation to the SELLER or the PURCHASER, whichever the case may be, and which thereafter shall remain available for acceptance until 12h00 on {{offer_expires}}, whereafter it shall lapse and be of no further force and effect.  The agents detailed on Page 2 “Contract Information – Selling Agents’” are hereby appointed as agents for the purpose of communication of acceptance.
""", default=True)])

clause("sale.fixtures", "14 Fixtures and fittings", "general", "Permanent fixtures included, voetstoots, listed 14.1–14.9.", 170,
       "FIXTURES & FITTINGS", "14", vs=[v("Master", """
The property is sold with all existing fixtures and fittings of a permanent nature and sold ‘voetstoots’ and which the Seller warrants are his exclusive property and fully paid for, including but not limited to:

14.1\tFixed light fittings, fitted carpets and awnings;

14.2\tAll fitted cupboards, shelving, curtain rails, rods and pelmets;

14.3\tOven, Hob & Extractor;

14.4\tFree standing fireplace/heater;

14.5\tPool filter, pump and cleaning equipment including automatic pool cleaner;

14.6\tExisting garden trees, shrubs, plants, garden irrigation and related equipment;

14.7\tAlternate power systems – invertor, batteries, solar panels;

14.8\tWater tanks; and

14.9\tBurglar alarm systems, keys and remote controls for the property.
""", default=True)])

# --------------------------------------------------------------------------
# 15 Certificates of compliance — each one "Applies" or "Not applicable"
# --------------------------------------------------------------------------
clause("sale.coc", "15 Certificates of compliance — heading", "compliance",
       "Heading only; each certificate below is its own clause the agent marks applicable or not.", 180,
       "CERTIFICATES OF COMPLIANCE", "15", vs=[v("Master", "", default=True)])


def coc(key, ordinal, num, title, body):
    clause(key, f"{num} {title.title()}", "compliance", f"{title} certificate; mark not applicable when the property has none.", ordinal, vs=[
        v("Applies", f"{num}\t{title}\n\n{body.strip()}", default=True),
        v("Not applicable", f"{num}\t{title} – Not applicable.", ours=True),
    ])


coc("sale.coc_electrical", 181, "15.1", "ELECTRICAL", """
The SELLER shall, at its cost, deliver to the PURCHASER on or before the transfer date a certificate of compliance in regard to the electrical installation on the property in terms of the regulations made by the Minister of Manpower on 23rd October 1992 under Section 35 of the Machinery and Occupational Safety Act No 6 of 1983 and under Act 85 or 1993.  The SELLER undertakes not to alter the electrical installation after the issue of the said Certificate.
""")
coc("sale.coc_beetle", 182, "15.2", "BEETLE FREE CERTIFICATE (ENTOMOLOGIST REPORT)", """
The Parties agree that, prior to transfer of the Property into the name of the Purchaser, the SELLER shall, at his expense, have all the accessible timbers of the property inspected by a SAPCA - registered Inspector for the infestation by Wood-destroying beetles, termites and fungi and a written report with recommendations shall be given to the SELLER. Where infestation is found, the recommendations made shall be carried out in full, in terms of Act 36 of 1947 and/or SANS Codes 0124 and 0204.  Upon receipt of a Certificate of Clearance issued by the said Inspector to the SELLER, to the effect that there is no apparent infestation on first inspection, or that any infestation which had been reported has been dealt with as set out above, the SELLER shall have fairly discharged all responsibility in the matter and the PURCHASER shall have no further claim against the SELLER.
""")
coc("sale.coc_gas", 183, "15.3", "GAS INSTALLATIONS", """
The SELLER shall, prior to the Occupation Date or Transfer of the Property, whichever is the earlier, furnish the PURCHASER with a valid certificate of conformity applicable to all gas appliances or systems on the property as prescribed in Regulation 17(3) of the Occupational Health and Safety Act.  The certificate will be issued by an authorised person registered as such with the Liquefied Petroleum Gas Safety Association of Southern Africa (LPGAS).  All expenses incurred in meeting the criteria for the issue of such certificate, including the certificate itself, shall be borne by the SELLER.  The SELLER furthermore warrants to the PURCHASER that no addition or alteration to the gas installations on the property has been effected since the issue of such certificate.  Upon the SELLER furnishing the PURCHASER with the said certificate of conformity, the PURCHASER shall have no claim whatsoever against the SELLER and no further liability in this regard shall rest upon the SELLER.
""")
coc("sale.coc_electric_fence", 184, "15.4", "ELECTRIC FENCE", """
The Seller shall obtain at his cost the required Electric Fence System Certificate as mentioned in Regulation 12 of the Electrical Machinery Regulations, 2011 promulgated in terms of the Occupational Health and Safety Act 1983 (Act No 6 of 1983) in respect of the electric fence system and deliver the said Electric Fence System Certificate to the Purchaser within 15 days of acceptance of this offer by the Seller.  If the electric fence system on the premises is faulty, the Seller shall at his cost repair the electrical fence system in order to deliver the required Electric Fence System Certificate to the Purchaser.  The Seller undertakes not to make any alterations to the Electric Fence System after the issue of the certificate.  If the certificate has not been delivered within the period referred to above, the Purchaser shall be entitled but not obliged to obtain an Electric Fence System Certificate in respect of such system at his own costs and the conveyancer is hereby irrevocably instructed to pay to the Purchaser from the proceeds of the sale, on the date of registration of transfer of the Property into the name of the Purchaser, the costs incurred by the Purchaser of obtaining such Electric Fence System Certificate (including the costs of effecting any rectifications or repairs to enable the relevant party to issue such certificate).”
""")
coc("sale.coc_solar", 185, "15.5", "SOLAR SYSTEMS", """
The Seller shall obtain at his cost the required Certificate of Compliance (“COC”) as mentioned in Regulation 9 promulgated in terms of the Occupational Health and Safety Act No 85 of 1993.  The COC shall be issued by a Registered Person.  If a Solar System forms part of the electrical installations on the Property, it shall specifically be included in the COC which must be signed by an installation electrician or master installation electrician or an electric tester under the supervision of an installation electrician or master installation electrician.  If the electrical installation is faulty, the Seller shall at his cost repair the electrical installation.  The COC shall be delivered to the Purchaser within 15 days of the acceptance of the offer or fulfilment of the suspensive conditions (whichever is the later) and no alterations shall be affected after the issuing of the COC.
""")

# --------------------------------------------------------------------------
# 16 – 20
# --------------------------------------------------------------------------
clause("sale.inspection", "16 Inspection", "warranty", "Purchaser inspected, voetstoots; seller has disclosed known defects (Disclosure Report attached).", 190,
       "INSPECTION", "16", vs=[v("Master", """
The PURCHASER has personally inspected the property and hereby accepts to purchase the property “Voetstoots” as it now stands.  The PURCHASER hereby waives any right to claim damages and/or costs for any such repairs on the property, whether caused by patent or latent defects. The SELLER hereby warrants that he has disclosed all known defects on the property including those listed on the Disclosure Report by the Seller attached hereto.
""", default=True)])

clause("sale.capacity", "17 Capacity of parties", "juristic", "Signing for an entity to be formed; signatory for a juristic person is surety.", 200,
       "CAPACITY OF PARTIES", "17", vs=[v("Master", """
17.1\tShould the PURCHASER sign this Agreement as agent for a company, close corporation or other juristic person to be formed, the signatory shall be deemed to be personally liable in terms of this Agreement should the company, close corporation or juristic person not be incorporated or formed or not ratify and adopt this Agreement within 30 (THIRTY) days of the date of signature hereof.  Upon formation or incorporation or ratification as aforesaid, the PURCHASER by his signature hereto binds himself as surety for and co-principal debtor in solidum with the company, close corporation or other juristic person or entity for the due and punctual performance by the company, close corporation or other juristic person or entity of its obligations arising out of this Agreement.

17.2\tIn the event of any of the parties to this Agreement being a company, close corporation, trust or other juristic person or entity, the person who signs this Agreement in the name or on behalf of such company, close corporation, trust or other juristic person or entity hereby warrants that such legal entity is indeed duly registered in terms of the applicable legislation and warrants that he is duly authorized to act for and/or on behalf of such legal entity, and he hereby binds himself as surety and co-principal debtor with such juristic person or entity in favour of the SELLER for all the obligations of such juristic person or entity in terms of this Agreement.  Such signatory shall be personally liable as PURCHASER or SELLER (as the case may be) in terms of this Agreement if such juristic person or entity legally does not exist and/or for whatsoever reason is not bound to this Agreement and/or fails to comply with any of the provisions hereof.
""", default=True)])

clause("sale.counterparts", "18 Signature in counterparts", "general", "Counterparts and emailed signatures valid.", 210,
       "SIGNATURE IN COUNTERPARTS", "18", vs=[v("Master", """
This Agreement of Sale may be signed in separate counterparts, each of which shall be deemed to be an original and all of which, taken together, shall constitute one and the same agreement. A counterpart of this Offer to Purchase in email form shall be conclusive evidence of the original signature and shall be as effective in law as the counterparts in original form showing the original signatures.
""", default=True)])

clause("sale.building_plans", "19 Building plans", "warranty",
       "Either the seller has approved plans and gave copies, or plans are missing and R100 000 is retained until they are approved.", 220,
       "BUILDING PLANS", "19", vs=[
    v("Plans available", """
19.1\tThe SELLER confirms that he is in possession of all approved municipal building plans relating to the improvements erected on the Property ("as-built plans") and has provided the PURCHASER with copies thereof prior to the signing of this Agreement. The PURCHASER acknowledges receipt of the plans and hereby confirms that they are satisfied with the documentation provided.
""", default=True),
    v("Plans not available — R100 000 retained", """
19.1\tThe SELLER confirms that Municipal building plans for all or part of the existing improvements are not presently available and has disclosed this to the PURCHASER. The SELLER undertakes at their own risk to obtain all required Municipal approvals and approved building plans on or before date of registration and transfer of the property, and should the SELLER fail to procure such approvals within this time limit prior to transfer, the Conveyancer is irrevocably authorised and instructed to retain the sum of R100,000 (One Hundred Thousand Rand) (“the retained amount”) from the SELLER’s proceeds of the sale, to be held in trust pending compliance with the SELLER’s obligations under this clause. Upon the SELLER furnishing proof that the required approvals and plans have been obtained, the retained amount shall be released to the SELLER. If the SELLER has not obtained the required approvals within 3 (three) months from date of transfer of the property, the retained amount shall be paid to the PURCHASER without prejudice to any further rights or remedies the PURCHASER may have in law under this agreement.
"""),
])

clause("sale.arbitration", "20 Arbitration", "general", "Informal arbitration in Knysna under the Arbitration Act.", 230,
       "ARBITRATION", "20", vs=[v("Master", """
20.1\tIf any dispute, difference or question arises at any time between the parties out of or in regard to any matters arising out of, or the rights and duties of any of the parties, or the interpretation of, or termination of, or any matter arising out of the termination of, or the rectification of this agreement, such dispute shall be submitted to and decided by arbitration on notice given by either party to the other of them in terms of this paragraph.

20.2\tSuch arbitration shall be held in Knysna in accordance with the provisions of the Arbitration Act No 42 of 1965 (as amended) save that the arbitration shall be informal and the arbitrator shall have the absolute discretion to determine the procedure to be adopted, it being the intention that the arbitration shall be held and concluded without delay.

20.3\tThe arbitrator shall be such independent or suitably qualified person as may be agreed upon between the parties in writing, and failing such agreement, the arbitrator shall be appointed by the President for the time being of the Law Society of the Cape of Good Hope or its successor/s at the request of either party.

20.4\tThe contents of Arbitration clause is severable from the rest of this agreement and shall remain in force notwithstanding the termination of this agreement for whatever reason.
""", default=True)])

# --------------------------------------------------------------------------
# 21 – 24 — the "IF APPLICABLE" clauses
# --------------------------------------------------------------------------
clause("sale.non_resident", "21 Non-resident sellers", "financial",
       "Withholding tax on purchase price ≥ R2m when the seller is non-resident. Self-conditional, so it stays in.", 240,
       "NON-RESIDENT SELLERS (IF APPLICABLE)", "21", vs=[v("Master", """
In the event that the Seller is a non-resident of the Republic of South Africa, the Seller accordingly hereby irrevocably authorises and instructs the Conveyancer to deduct the applicable withholding tax from the purchase price on behalf of the Purchaser if the purchase price is R2,000,000 or more and to pay the same to the Receiver of Revenue within 14 (fourteen) days after date of registration of transfer of the property into the name of the Purchaser.
""", default=True)])

clause("sale.recordal", "22 Recordal — heading", "recordal", "Heading only; estate and Thesen Islands recordals below.", 250,
       "RECORDAL (IF APPLICABLE)", "22", vs=[v("Master", "", default=True)])

clause("sale.recordal_estate", "22.1 Properties within an estate", "recordal",
       "Estate guidelines, HOA constitution and rules bind the purchaser. Chosen automatically when the property is in an estate.", 251, vs=[
    v("Estate", """
22.1\tPROPERTIES WITHIN AN ESTATE: It is recorded that the original developer for {{estate_name}} Estate has imposed various conditions relating to ownership of the property including the Estate’s Architectural Guidelines, Constitution of the Estate’s Homeowners Association and Estate Rules. The PURCHASER confirms that he is familiar therewith and aware that he will own the property subject to such conditions. It is further recorded that a Homeowners Association has been established for the benefit of all owners of erven of the Estate, so as to control and maintain services and amenities within the Estate and the PURCHASER agrees to bind itself to such Association and requirements.
""", applies_when={"estate_name_set": True}),
    v("Not applicable", "22.1\tPROPERTIES WITHIN AN ESTATE – Not applicable.", default=True, ours=True),
])

clause("sale.recordal_thesen", "22.2 Thesen Islands properties", "recordal",
       "TIHOA entry-fee levy and pre-transfer inspection. Chosen automatically on Thesen Islands.", 252, vs=[
    v("Thesen Islands", """
22.2\tTHESEN ISLAND PROPERTIES: It is recorded that a special “Entry Fee” equivalent to 12 times (one year) the applicable monthly Levy will be raised as an Entry Fee Levy on all new Homeowners or existing Homeowners purchasing additional properties as laid out by the Trustees of Thesen Islands Homeowners Association (“TIHOA”) on transfer of their property on Thesen Islands payable to TIHOA.  This rule may be amended from time to time by the Trustees. The SELLER acknowledges that prior to the TIHOA issuing a clearance certificate allowing transfer of the property the TIHOA will carry out an inspection of the property to ascertain that the standard of the property is in accordance with their regulations. The TIHOA will issue a report stating the improvements that need to be carried out and the SELLER will have to abide by these at their cost.
""", applies_when={"suburb": ["Thesen Island", "Thesen Islands"]}),
    v("Not applicable", "22.2\tTHESEN ISLAND PROPERTIES – Not applicable.", default=True, ours=True),
])

clause("sale.continued_marketing", "23 Continued marketing", "suspensive",
       "Seller may keep marketing until suspensive conditions are met; 3 working days to waive on a competing offer.", 260,
       "CONTINUED MARKETING", "23", vs=[v("Master", """
The SELLER may continue to market the Property until the fulfilment of the suspensive conditions contained herein is fulfilled.  Should the SELLER, during this time, receive another more acceptable offer to purchase the Property, he will have the right to notify the PURCHASER, in writing, to waive or fulfil all suspensive conditions pertaining to his offer, and therefore making this sale unconditional, within 3 (three) working days of the date when such notice is delivered to the PURCHASER, or such extended period as the SELLER may allow.  Such notice to the PURCHASER shall include a copy of the competing offer.  If the PURCHASER fails to waive his rights or advise the SELLER that the suspensive conditions have been fulfilled, in writing within the waiver period, the SELLER shall be entitled to accept the competing offer and this sale shall lapse and be null and void.  Should the SELLER elect not to accept the competing offer, this Agreement shall remain in full force and effect.
""", default=True)])

SUSP_INTRO = "This Agreement of Sale is subject to the following suspensive conditions, failing which this Agreement shall be of no further force and effect.  It is further recorded that this clause is for the benefit of the PURCHASER who may unilaterally waive it at any time prior to the fulfilment of this condition."

clause("sale.suspensive", "24 Suspensive conditions", "suspensive",
       "One of: sale of the purchaser's property, a viewing, or Master's consent for a deceased estate — or none.", 270,
       "SUSPENSIVE CONDITIONS", "24", vs=[
    v("None", "Not applicable.", default=True, ours=True),
    v("Sale of the purchaser's property", f"""
{SUSP_INTRO}

24.1\tThe successful sale and transfer of the PURCHASER’s property known as {{{{purchaser_property}}}}, by no later than {{{{purchaser_property_by}}}}.
"""),
    v("Subject to viewing", f"""
{SUSP_INTRO}

24.1\tThe PURCHASER viewing the Property by no later than {{{{viewing_by}}}} and confirming to the SELLER or his Conveyancer in writing within 2 (TWO) days after such viewing to the effect that he wishes to proceed with the sale.
"""),
    v("Master's consent (deceased estate)", f"""
{SUSP_INTRO}

24.1\tMASTERS CONSENT & FIDUCIARY CAPACITY

This Agreement is subject to the approval of the Master of the High Court of South Africa (Western Cape) for the sale and transfer of the property to the Purchaser.  Should such consent not be obtained or should the Master of the Supreme Court decline for any reason to furnish a certificate in terms of Section 42(2) of the Administration of Estates Act 66 of 1965, then this agreement shall lapse and be null and void.  The Purchasers acknowledge that they are aware that the Seller acts in a fiduciary capacity as Executor of a Deceased Estate and that the sale shall take place in accordance with their powers and authority in their capacity as such.
"""),
])

# --------------------------------------------------------------------------
# Signatures and commission acceptance
# --------------------------------------------------------------------------
clause("sale.signatures", "Signatures — seller and purchaser, witnessed", "signature",
       "Signed at / on / witnesses for each side; completed at signing.", 280, vs=[v("Master", """
THUS DONE AND SIGNED BY THE PARTIES HERETO:

SIGNED AT  _____________________________ ON THIS ________  DAY OF _____________________ 202__

AS WITNESSES:

1 ______________________________

2 ______________________________

SELLER, and duly authorised thereto

SIGNED AT  _____________________________ ON THIS ________  DAY OF _____________________ 202__

AS WITNESSES:

1 ______________________________

2 ______________________________

PURCHASER, and duly authorised thereto
""", default=True)])

clause("sale.commission_acceptance", "Commission clause acceptance", "signature",
       "Dream accepts the benefit of the commission clause (stipulatio alteri).", 290, vs=[v("Master", """
COMMISSION CLAUSE ACCEPTANCE

DREAM KNYSNA (PTY) LIMITED, duly represented by {{principal_name}} and duly authorized thereto hereby accept the benefits of this Commission Clause.

__________________________________________   Date:  _______________________
""", default=True)])


# --------------------------------------------------------------------------
# Emit SQL
# --------------------------------------------------------------------------
def q(s):
    return "null" if s is None else "'" + s.replace("'", "''") + "'"


def dollar(s):
    assert "$body$" not in s
    return "$body$" + s + "$body$"


import json

ours = [(k, x["label"], x["body"]) for k, vs in variants.items() for x in vs if x["ours"]]

out = []
out.append("""-- ============================================================================
-- Dream Knysna OS — 0078 Agreement of Sale — Freehold House (Bronwyn's 2026 master)
-- ----------------------------------------------------------------------------
-- GENERATED by scripts/seed-sale-house.py — edit the script, not this file.
--
-- Plan 019 Arc A (sale agreements). Wording verbatim from
-- docs/templates/2026-final/dream-properties-agreement-of-sale-freehold-
-- house-template-2026.md. Blanks are {{tokens}}; the master's "DELETE /
-- OR / IF APPLICABLE" alternatives are library variants:
--   * BOND (contract info + clause 8): chosen by the deal — a bond amount
--     prints the bond clause, none prints "Not applicable" (cash sale).
--   * 15.1–15.5 certificates: each "Applies" or "Not applicable".
--   * 5.5 existing lease, 19 building plans, 22.1 estate, 22.2 Thesen
--     Islands, 24 suspensive condition: picked by the agent; 22.1 and 22.2
--     are pre-picked from the property's estate and suburb.
-- The only wording that is ours, not Bronwyn's — the "Not applicable"
-- lines that keep the numbering when an alternative doesn't apply — is:
""")
for k, label, body in ours:
    out.append(f"--   {k} [{label}]: {body.splitlines()[0]}\n")
out.append("""-- Signature blocks keep their blanks; they are completed at signing.
-- ============================================================================

""")

out.append("insert into clause (key, label, category, description) values\n")
out.append(",\n".join(f"  ({q(k)}, {q(l)}, {q(c)}, {q(d)})" for k, l, c, d in clauses))
out.append("\non conflict (key) do nothing;\n\n")

for key, vs in variants.items():
    for x in vs:
        aw = "null" if x["applies_when"] is None else q(json.dumps(x["applies_when"])) + "::jsonb"
        out.append(
            "insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)\n"
            f"select (select id from clause where key = {q(key)}), {q(x['label'])}, {dollar(x['body'])}, {aw}, {str(x['default']).lower()}, "
            f"{q('manual' if x['ours'] else 'master_template')}, true\n"
            "on conflict (clause_id, label) do nothing;\n\n"
        )

out.append(f"""-- The template: activate it and lay out its slots.
update doc_template set active = true,
       doc_type_id = coalesce(doc_type_id, (select id from document_type where code = 'agreement_of_sale')),
       description = 'Bronwyn''s 2026 master for a freehold house. The agreement IS the offer: first signature is an irrevocable offer until 12h00 on the expiry date (clause 13). Filled from the deal; bond, certificates, building plans, recordals and suspensive conditions are choices.'
 where code = {q(T)};

insert into doc_template_slot (template_id, clause_id, ordinal, heading, numbering, condition, is_optional, default_on) values
""")
rows = []
for ordinal, key, heading, numbering, optional, default_on in slots:
    rows.append(
        f"  ((select id from doc_template where code = {q(T)}), (select id from clause where key = {q(key)}), {ordinal}, {q(heading)}, {q(numbering)}, null, {str(optional).lower()}, {str(default_on).lower()})"
    )
out.append(",\n".join(rows))
out.append("\non conflict (template_id, ordinal) do nothing;\n")

print("".join(out), end="")
