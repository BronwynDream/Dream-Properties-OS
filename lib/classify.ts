// Deterministic filename → document_type classifier.
// Filenames in Dream's folders are highly informative ("Final Signed Agreement…",
// "kyc katie", "Sellers ID"), so a rules pass gets most files right with zero AI cost.
// The returned `code` matches a document_type.code seeded in the database.
// Order matters: specific patterns first, generic last.

type Rule = { re: RegExp; code: string };

const RULES: Rule[] = [
  { re: /land.*(freehold|agreement)|freehold agreement/i, code: "land_freehold_agreement" },
  { re: /movable/i, code: "movables_agreement" },
  { re: /addendum/i, code: "addendum" },
  { re: /agreement of sale|deed of sale|final.*agreement|signed agreement|\baos\b/i, code: "agreement_of_sale" },
  { re: /offer to purchase|\botp\b/i, code: "offer_to_purchase" },
  { re: /ppra|mandatory disclosure|disclosure form/i, code: "ppra_disclosure" },
  { re: /joint mandate|sole mandate|open mandate|\bmandate\b/i, code: "mandate" },
  { re: /\bcma\b|comparative market/i, code: "cma" },
  { re: /detailed listing/i, code: "detailed_listing" },
  { re: /property info/i, code: "property_info" },
  { re: /light?stone|property[_ ]report/i, code: "lightstone_report" },
  { re: /transfer instruction/i, code: "transfer_instruction" },
  { re: /marriage cert/i, code: "marriage_certificate" },
  { re: /passport/i, code: "passport" },
  { re: /kyc/i, code: "kyc_form" },
  { re: /fica.*(questionnaire|compliance|natural person|rates)|questionnaire fica/i, code: "fica_questionnaire" },
  { re: /vat (certificate|cert)/i, code: "vat_certificate" },
  { re: /share register/i, code: "share_register" },
  { re: /company resolution|\bresolution\b|\bres for\b/i, code: "company_resolution" },
  { re: /cor ?14|cor ?15|\bcipc\b/i, code: "cipc_form" },
  { re: /trust deed|letters of authority/i, code: "trust_deed" },
  { re: /gas.*(coc|cert)|lpgas/i, code: "gas_coc" },
  { re: /electric(al)?.*(coc|cert|fence)/i, code: "electrical_coc" },
  { re: /beetle/i, code: "beetle_cert" },
  { re: /relaxation|boundary/i, code: "boundary_relaxation" },
  { re: /design manual/i, code: "estate_design_manual" },
  { re: /concept/i, code: "concept_plan" },
  { re: /elevation|section view|floor plan|\bplans?\b|proposed plan|level \d/i, code: "architectural_plan" },
  { re: /rates|municipal account|telkom|utility/i, code: "rates_account" },
  { re: /proof of address/i, code: "proof_of_address" },
  { re: /registered deed|title deed|\bt\d{4,}\b/i, code: "title_deed" },
  { re: /certified id|rsa id|\bid\b|identity|_id[ ._]|id\.(pdf|jpe?g)/i, code: "id_document" },
  { re: /\bfica\b/i, code: "fica_questionnaire" },
  { re: /\.eml$|^fw[:_ ]|^re[:_ ]|email/i, code: "email_thread" },
];

// Codes that mean "this deal has a juristic party" → forces a RED (manual-review) tier.
export const JURISTIC_CODES = new Set([
  "company_resolution",
  "share_register",
  "cipc_form",
  "trust_deed",
]);

// Image extensions we treat as property photos when no textual rule matched.
// Rules-first still wins: a file named "Front Elevation.jpg" hits the plan rule
// above; a file named "IMG_1234.jpg" falls through to here.
const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp|tiff?|gif|bmp)$/i;

export function classifyFilename(filename: string): string {
  for (const { re, code } of RULES) {
    if (re.test(filename)) return code;
  }
  if (IMAGE_EXT.test(filename)) return "photo";
  return "other";
}
