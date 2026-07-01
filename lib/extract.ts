// Prompt + schema + mapping for AI field extraction.
// The model receives a deal's document text and returns strict JSON; we flatten that
// into `extraction` rows (target_table.target_field) for human review.

export const SYSTEM_PROMPT = `You are a South African property-transfer data extractor for a Knysna estate agency.
You read the text of sale agreements and related documents and return ONLY a JSON object
matching the given schema. Rules:
- Extract only what is explicitly present. If a value is not stated, use null. NEVER invent.
- Money as plain integers in Rand (e.g. 7600000), no symbols or spaces.
- Dates as ISO YYYY-MM-DD.
- id_number is the SA ID number if shown; otherwise null.
- party_type is one of: individual, company, close_corporation, trust, partnership.
- suspensive_condition status is one of: pending, fulfilled, waived, failed.
- Return JSON only. No commentary, no markdown fences.`;

export const JSON_SHAPE = `{
  "property": { "title_deed_no": null, "erf_number": null, "extent_sqm": null, "address": null, "suburb": null },
  "sellers": [ { "party_type": "individual", "name": "", "entity_name": null, "id_number": null, "matrimonial_regime": null } ],
  "purchasers": [ { "name": "", "id_number": null } ],
  "agreement": { "price": null, "deposit": null, "transfer_date": null },
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

  (data.sellers ?? []).forEach((s, i) => {
    const hint = `seller_${i + 1}`;
    push("party", "party_type", s.party_type, hint);
    push("party", "display_name", s.name, hint);
    push("party", "entity_name", s.entity_name, hint);
    push("party", "id_number", s.id_number, hint);
    push("party", "matrimonial_regime", s.matrimonial_regime, hint);
  });

  (data.purchasers ?? []).forEach((b, i) => {
    const hint = `purchaser_${i + 1}`;
    push("party", "display_name", b.name, hint);
    push("party", "id_number", b.id_number, hint);
  });

  const a = data.agreement ?? {};
  push("agreement", "price", a.price);
  push("agreement", "deposit", a.deposit);
  push("agreement", "transfer_date", a.transfer_date);

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
