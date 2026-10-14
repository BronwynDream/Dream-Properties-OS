// Builds the DocContext for a mandate from the record plus the agent's
// interview answers. Pure: safe to call on every keystroke in the editor.
//
// Fill-source rule (plan 007): record first, interview second, no silent
// defaults. Anything missing stays undefined so the resolver prints a blank
// and reports it.

import type { DocContext } from "./resolve";
import { formatZar, numberToWords, percentToWords } from "./resolve";

export type MandateRecordInputs = {
  mandateType: "exclusive" | "joint" | "open";
  sellerNames: string | null;          // "John and Jane Smith" / "Smith Family Trust"
  sellerIdLine: string | null;         // "I.D. 7001015009087" / "Reg no. 2001/012345/07"
  sellerRepresentative: string | null; // natural person signing for a juristic seller
  erfNumber: string | null;
  propertyKnownAs: string | null;      // street address without "Knysna"
  extentSqm: number | null;
  jointAgencyName: string | null;
};

export type MandateInterviewInputs = {
  askingPrice: number | null;
  commissionPct: number | null;
  termMonths: number | null;
};

export function buildMandateContext(
  record: MandateRecordInputs,
  interview: MandateInterviewInputs,
): DocContext {
  const ctx: DocContext = {
    mandate_type: record.mandateType,
    seller_names: record.sellerNames,
    seller_id_line: record.sellerIdLine,
    seller_representative: record.sellerRepresentative,
    erf_number: record.erfNumber,
    property_known_as: record.propertyKnownAs,
    extent_sqm: record.extentSqm != null ? formatZar(record.extentSqm) : null,
    joint_agency_name: record.jointAgencyName,
  };
  if (interview.askingPrice != null && interview.askingPrice > 0) {
    ctx.asking_price = formatZar(interview.askingPrice);
    ctx.asking_price_words = numberToWords(interview.askingPrice);
  }
  if (interview.commissionPct != null && interview.commissionPct > 0) {
    ctx.commission_pct = trimNumber(interview.commissionPct);
    ctx.commission_pct_words = percentToWords(interview.commissionPct);
  }
  if (interview.termMonths != null && interview.termMonths > 0) {
    ctx.term_months = String(Math.round(interview.termMonths));
    ctx.term_months_words = numberToWords(interview.termMonths).toLowerCase();
  }
  return ctx;
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(/0+$/, "");
}

/** Human labels for unresolved tokens, for the editor's "still needed" list. */
export const TOKEN_LABELS: Record<string, string> = {
  seller_names: "Seller name(s)",
  seller_id_line: "Seller ID / registration number",
  seller_representative: "Person signing for the seller",
  erf_number: "Erf number",
  property_known_as: "Street address",
  extent_sqm: "Extent (m²)",
  joint_agency_name: "Joint agency",
  asking_price: "Marketing price",
  asking_price_words: "Marketing price",
  commission_pct: "Commission %",
  commission_pct_words: "Commission %",
  term_months: "Mandate term (months)",
  term_months_words: "Mandate term (months)",
};
