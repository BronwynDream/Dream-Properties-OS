// Characterization tests for the document resolver. Run with:
//   npm run test:documents
// No framework — assert() and a process exit code, same as test:dedup.

import assert from "node:assert/strict";
import {
  resolveDocument,
  predicateMatches,
  fillTokens,
  numberToWords,
  percentToWords,
  formatZar,
  BLANK,
  type TemplateModel,
} from "../resolve";
import { buildMandateContext } from "../context";

const model: TemplateModel = {
  id: "t1", code: "mandate_exclusive", label: "Exclusive Mandate",
  requires_property: true, requires_purchaser: false,
  slots: [
    {
      id: "s1", ordinal: 10, heading: null, numbering: null, condition: null, is_optional: false, default_on: true,
      clause: { id: "c_title", key: "mandate.title", label: "Title", category: "general" },
      variants: [
        { id: "v_ex", label: "Exclusive master", body: "EXCLUSIVE MANDATE", applies_when: { mandate_type: "exclusive" }, is_default: true, approved: true, source: "master_template" },
        { id: "v_jt", label: "Joint master", body: "JOINT MANDATE & {{joint_agency_name}}", applies_when: { mandate_type: "joint" }, is_default: false, approved: true, source: "master_template" },
      ],
    },
    {
      id: "s2", ordinal: 20, heading: null, numbering: null, condition: null, is_optional: false, default_on: true,
      clause: { id: "c_comm", key: "mandate.commission", label: "Commission", category: "mandate_terms" },
      variants: [
        { id: "v_c", label: "Standard", body: "Commission at {{commission_pct}}% ({{commission_pct_words}} percent)", applies_when: null, is_default: true, approved: true, source: "master_template" },
      ],
    },
    {
      id: "s3", ordinal: 30, heading: "ESTATE", numbering: "9", condition: { in_estate: true }, is_optional: false, default_on: true,
      clause: { id: "c_estate", key: "sale.estate_recordal", label: "Estate", category: "recordal" },
      variants: [
        { id: "v_e", label: "Standard", body: "Estate rules apply.", applies_when: null, is_default: true, approved: true, source: "master_template" },
      ],
    },
  ],
};

// 1. Predicate picks the right per-type variant; a non-matching default is never used.
{
  const doc = resolveDocument(model, { mandate_type: "joint", joint_agency_name: "Pam Golding", commission_pct: "5", commission_pct_words: "Five" });
  assert.equal(doc.sections[0].variantId, "v_jt");
  assert.equal(doc.sections[0].body, "JOINT MANDATE & Pam Golding");
  const open = resolveDocument(model, { mandate_type: "open" });
  assert.equal(open.sections[0].variantId, null, "no variant applies to open — must not fall back to the exclusive default");
}

// 2. Unfilled tokens print as BLANK and are reported once each.
{
  const doc = resolveDocument(model, { mandate_type: "exclusive" });
  assert.equal(doc.sections[1].body, `Commission at ${BLANK}% (${BLANK} percent)`);
  assert.deepEqual(doc.unresolved, ["commission_pct", "commission_pct_words"]);
}

// 3. Slot condition excludes a section; omitted_clauses and overrides apply.
{
  const a = resolveDocument(model, { mandate_type: "exclusive", in_estate: false });
  assert.equal(a.sections[2].included, false);
  const b = resolveDocument(model, { mandate_type: "exclusive", in_estate: true });
  assert.equal(b.sections[2].included, true);
  const c = resolveDocument(model, { mandate_type: "exclusive", in_estate: true }, { omitted_clauses: ["c_estate"], clause_overrides: { c_comm: "Edited {{commission_pct}}" } });
  assert.equal(c.sections[2].included, false);
  assert.equal(c.sections[1].overridden, true);
  assert.equal(c.sections[1].body, `Edited ${BLANK}`);
}

// 4. Explicit selection wins over predicate.
{
  const doc = resolveDocument(model, { mandate_type: "joint" }, { clause_selections: { c_title: "v_ex" } });
  assert.equal(doc.sections[0].variantId, "v_ex");
}

// 5. Predicate operators.
assert.equal(predicateMatches({ price_gt: 2000000 }, { price: 2500000 }), true);
assert.equal(predicateMatches({ price_gt: 2000000 }, { price: 1500000 }), false);
assert.equal(predicateMatches({ seller_type: ["trust", "company"] }, { seller_type: "trust" }), true);
assert.equal(predicateMatches({ bond_set: true }, { bond: "" }), false);
assert.equal(predicateMatches({ bond_set: true }, { bond: "R 2 000 000" }), true);

// 6. Tokens, number words, ZAR formatting.
assert.deepEqual(fillTokens("a {{x}} b {{ y }} {{x}}", { x: "1" }), { text: "a 1 b " + BLANK + " 1", unresolved: ["y"] });
assert.equal(numberToWords(6500000), "Six Million Five Hundred Thousand");
assert.equal(numberToWords(29950000), "Twenty Nine Million Nine Hundred and Fifty Thousand");
assert.equal(numberToWords(1695000), "One Million Six Hundred and Ninety Five Thousand");
assert.equal(numberToWords(12), "Twelve");
assert.equal(percentToWords(5), "Five");
assert.equal(percentToWords(3.5), "Three Point Five");
assert.equal(formatZar(6500000), "6 500 000");

// 7. Mandate context: record first, interview second, nothing defaulted.
{
  const ctx = buildMandateContext(
    { mandateType: "exclusive", sellerNames: "John and Jane Smith", sellerIdLine: "I.D. 1", sellerRepresentative: null, erfNumber: "1602", propertyKnownAs: "169 Links Drive, Leisure Isle", extentSqm: 1043, jointAgencyName: null },
    { askingPrice: 25200000, commissionPct: 5, termMonths: 6 },
  );
  assert.equal(ctx.asking_price, "25 200 000");
  assert.equal(ctx.asking_price_words, "Twenty Five Million Two Hundred Thousand");
  assert.equal(ctx.term_months_words, "six");
  assert.equal(ctx.extent_sqm, "1 043");
  const empty = buildMandateContext(
    { mandateType: "open", sellerNames: null, sellerIdLine: null, sellerRepresentative: null, erfNumber: null, propertyKnownAs: null, extentSqm: null, jointAgencyName: null },
    { askingPrice: null, commissionPct: null, termMonths: null },
  );
  assert.equal(empty.commission_pct, undefined, "commission is never defaulted");
}

console.log("resolve.test: all assertions passed");

// ---------------------------------------------------------------------------
// Layout conventions (lib/documents/layout.ts) — tabs, or the spaces the
// Supabase SQL editor turns them into on paste.
// ---------------------------------------------------------------------------
import { matchNumbered, matchLabelRow } from "../layout";
assert.deepEqual(matchNumbered("2.1\tThe purchase price"), ["2.1", "The purchase price"]);
assert.deepEqual(matchNumbered("2.1   The purchase price"), ["2.1", "The purchase price"]);
assert.deepEqual(matchNumbered("15.1 ELECTRICAL – Not applicable."), ["15.1", "ELECTRICAL – Not applicable."]);
assert.equal(matchNumbered("1 ______________________________"), null, "witness line is not a sub-clause");
assert.equal(matchNumbered("The purchase price"), null);
assert.deepEqual(matchLabelRow("Full Names:\tJane Doe"), ["Full Names:", "Jane Doe"]);
assert.deepEqual(matchLabelRow("Full Names:   Jane Doe"), ["Full Names:", "Jane Doe"]);
assert.equal(matchLabelRow("The transfer.  Both parties shall sign"), null, "double space in prose is not a row");
console.log("layout: all assertions passed");
