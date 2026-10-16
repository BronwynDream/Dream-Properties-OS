import { numberToWords, percentToWords, formatZar, type DocContext } from "./resolve";

// Derived tokens (plan 019 A4/A5). The editor and the finaliser both go
// through here so the printed PDF is exactly what the agent saw on screen:
// *_words tokens come from their numeric sibling, and ZAR figures are
// pretty-printed however they were typed.

export const DERIVED: Record<string, (ctx: DocContext) => string | null> = {
  asking_price_words: (c) => wordsOfZar(c.asking_price),
  purchase_price_words: (c) => wordsOfZar(c.purchase_price),
  movables_price_words: (c) => wordsOfZar(c.movables_price),
  commission_pct_words: (c) => (numOf(c.commission_pct) != null ? percentToWords(numOf(c.commission_pct)!) : null),
  term_months_words: (c) => (numOf(c.term_months) != null ? numberToWords(numOf(c.term_months)!).toLowerCase() : null),
};

const ZAR_FIELDS = ["asking_price", "purchase_price", "movables_price"];

export function numOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function wordsOfZar(v: unknown): string | null {
  const n = numOf(v);
  return n != null && n > 0 ? numberToWords(n) : null;
}

/** Field values as typed → the context the resolver renders from. */
export function deriveContext(fields: DocContext): DocContext {
  const out: DocContext = { ...fields };
  for (const [k, fn] of Object.entries(DERIVED)) {
    const v = fn(out);
    if (v != null) out[k] = v;
    else delete out[k];
  }
  for (const k of ZAR_FIELDS) {
    const n = numOf(out[k]);
    if (n != null && n > 0) out[k] = formatZar(n);
  }
  return out;
}
