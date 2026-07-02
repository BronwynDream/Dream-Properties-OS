// Prompt + schema + mapping for AI field extraction.
// The model receives a deal's document text and returns strict JSON; we flatten that
// into `extraction` rows (target_table.target_field) for human review.

export const SYSTEM_PROMPT = `You are a South African property data extractor for a Knysna estate agency.
The document may be a SALE (agreement of sale) OR just a LISTING (mandate, property
information sheet, CMA). Read whatever it is and return ONLY a JSON object matching the
given schema. Rules:
- Extract only what is explicitly present. If a value is not stated, use null. NEVER invent.
- Money as plain integers in Rand (e.g. 7600000), no symbols or spaces.
- A sale price/deposit go under "agreement"; an asking/listing price goes under "listing".
- Dates as ISO YYYY-MM-DD.
- id_number is the SA ID number if shown; otherwise null.
- party_type is one of: individual, company, close_corporation, trust, partnership.
- For a company/CC/trust/partnership, set entity_name and registration_no, and list its
  directors / members / shareholders / trustees under "members" (name, id_number, role, share_pct).
  role is one of: director, member, trustee, partner, ubo.
- Capture ALL buyers and sellers, including from FICA questionnaires and identity documents.
- suspensive_condition status is one of: pending, fulfilled, waived, failed.
- mandate type is one of: sole, joint, open, exclusive.
- Return JSON only. No commentary, no markdown fences.

CRITICAL — the mandating agency is NOT a party to the sale.
The listing agency for these documents is Dream Knysna (Dream Knysna CC, reg 98/32181/23),
principal Bronwyn Eyre, co-director Camilla Eyre, associate agent Vanessa Eyre. The agency
and its members, directors, or associate agents must NEVER be extracted as sellers or
purchasers, even if they appear on the mandate, FICA questionnaire, CMA, property information
sheet, cover letter, or as signatory on the agent's behalf. The seller is the current title
holder as named in the mandate's "The Seller" section or in the signed agreement of sale,
not the agent signing for the agency. If the only "seller" candidate you can find is Dream
Knysna or one of its members acting in an agency capacity, return sellers: []. The same
applies to Pam Golding Properties Knysna (Knysna Plett Property Professionals Pty Ltd) when
Dream is co-mandated on a joint mandate: the co-agent is not a party to the sale.`;

export const JSON_SHAPE = `{
  "property": { "title_deed_no": null, "erf_number": null, "extent_sqm": null, "address": null, "suburb": null },
  "sellers": [ { "party_type": "individual", "name": "", "entity_name": null, "registration_no": null, "id_number": null, "matrimonial_regime": null, "members": [ { "name": "", "id_number": null, "role": "director", "share_pct": null } ] } ],
  "purchasers": [ { "party_type": "individual", "name": "", "entity_name": null, "registration_no": null, "id_number": null, "members": [] } ],
  "agreement": { "price": null, "deposit": null, "transfer_date": null },
  "listing": { "asking_price": null },
  "mandate": { "type": null, "expiry": null },
  "suspensive_conditions": [ { "description": "", "status": "pending" } ],
  "commission": { "amount": null }
}`;

export function buildUserPrompt(docText: string): string {
  return `Extract the transaction data from the document text below into this exact JSON shape:

${JSON_SHAPE}

DOCUMENT TEXT:
"""
${docText.slice(0, 45000)}
"""`;
}

type Extracted = {
  property?: Record<string, unknown>;
  sellers?: Array<Record<string, unknown>>;
  purchasers?: Array<Record<string, unknown>>;
  agreement?: Record<string, unknown>;
  listing?: Record<string, unknown>;
  mandate?: Record<string, unknown>;
  suspensive_conditions?: Array<Record<string, unknown>>;
  commission?: Record<string, unknown>;
};

export type ExtractionRow = {
  target_table: string;
  target_field: string;
  entity_hint: string | null;
  proposed_value: string;
  confidence: number;
};

function val(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

// Flatten the model JSON into extraction rows (only non-null values).
export function mapExtractionToRows(data: Extracted): ExtractionRow[] {
  const rows: ExtractionRow[] = [];
  const push = (
    table: string,
    field: string,
    v: unknown,
    hint: string | null = null,
    conf = 0.8,
  ) => {
    const s = val(v);
    if (s !== null) rows.push({ target_table: table, target_field: field, entity_hint: hint, proposed_value: s, confidence: conf });
  };

  const p = data.property ?? {};
  push("property", "title_deed_no", p.title_deed_no);
  push("property", "extent_sqm", p.extent_sqm);
  push("property", "primary_address", p.address);
  push("property", "suburb", p.suburb);
  push("erf", "erf_number", p.erf_number);

  const pushParty = (side: "seller" | "purchaser", s: Record<string, unknown>, i: number) => {
    const hint = `${side}_${i + 1}`;
    push("party", "party_type", s.party_type, hint);
    push("party", "display_name", s.name, hint);
    push("party", "entity_name", s.entity_name, hint);
    push("party", "registration_no", s.registration_no, hint);
    push("party", "id_number", s.id_number, hint);
    push("party", "matrimonial_regime", s.matrimonial_regime, hint);
    const members = Array.isArray(s.members) ? (s.members as Array<Record<string, unknown>>) : [];
    members.forEach((m, j) => {
      const mhint = `${hint}_member_${j + 1}`;
      push("party_member", "name", m.name, mhint);
      push("party_member", "id_number", m.id_number, mhint);
      push("party_member", "role", m.role, mhint);
      push("party_member", "share_pct", m.share_pct, mhint);
    });
  };

  (data.sellers ?? []).forEach((s, i) => pushParty("seller", s, i));
  (data.purchasers ?? []).forEach((b, i) => pushParty("purchaser", b, i));

  const a = data.agreement ?? {};
  push("agreement", "price", a.price);
  push("agreement", "deposit", a.deposit);
  push("agreement", "transfer_date", a.transfer_date);

  const l = data.listing ?? {};
  push("listing", "asking_price", l.asking_price);

  const m = data.mandate ?? {};
  push("mandate", "type", m.type);
  push("mandate", "expiry_date", m.expiry);

  (data.suspensive_conditions ?? []).forEach((c, i) => {
    const hint = `condition_${i + 1}`;
    push("suspensive_condition", "description", c.description, hint);
    push("suspensive_condition", "status", c.status, hint);
  });

  push("commission", "gross_amount", (data.commission ?? {}).amount);

  return rows;
}

// Parse a model response that should be JSON, tolerating code fences / stray text.
export function parseModelJson(content: string): Extracted {
  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s) as Extracted;
}
