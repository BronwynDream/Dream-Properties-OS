// Content-based classifier for documents whose filename gave nothing away.
// Complements lib/classify.ts (filename-based). Runs against extracted text
// (from PDF text layer, docx, or OCR of a scan) and returns a document_type
// code + confidence. The reclassify pipeline calls this first, then falls
// back to an LLM ask for the stragglers.

type ContentRule = { code: string; test: (t: string) => boolean; confidence?: number };

// Ordered — first hit wins. Specific patterns come before generic ones.
const RULES: ContentRule[] = [
  // Compliance certificates — always dead giveaways in the header text.
  {
    code: "gas_coc",
    test: (t) =>
      /SAQCC\s*GAS/i.test(t) ||
      /LP\s*Gas\b/i.test(t) ||
      /\bLPGSA\b/i.test(t) ||
      /Certificate of Conformity for Gas Installations/i.test(t) ||
      /gas\s+installation.*(certificate|conformity)/i.test(t),
    confidence: 0.95,
  },
  {
    code: "electrical_coc",
    test: (t) =>
      /Electrical Installation.*(Certificate of Compliance|COC)/i.test(t) ||
      /Certificate of Compliance.*(Electrical|Installation)/i.test(t) ||
      /Electrical Contractor.*Registration/i.test(t),
    confidence: 0.95,
  },
  {
    code: "beetle_cert",
    test: (t) =>
      /Timber Infestation/i.test(t) ||
      /Beetle Certificate/i.test(t) ||
      /Wood Boring.*Beetle/i.test(t) ||
      /Entomologist.*Certificate/i.test(t),
    confidence: 0.95,
  },

  // FICA / KYC forms
  {
    code: "fica_questionnaire",
    test: (t) =>
      /FICA.*(Compliance )?Questionnaire/i.test(t) ||
      /Financial Intelligence Centre Act/i.test(t) ||
      /Know Your Client.*Compliance/i.test(t),
    confidence: 0.9,
  },
  {
    code: "kyc_form",
    test: (t) =>
      /KYC\b.*Form/i.test(t) ||
      /Know Your Client\s+Form/i.test(t),
    confidence: 0.85,
  },

  // ID / passport
  {
    code: "id_document",
    test: (t) =>
      (/REPUBLIC OF SOUTH AFRICA/i.test(t) && /IDENTITY|IDENTIFICATION|IDENTITEIT/i.test(t)) ||
      /Republiek van Suid-Afrika/i.test(t) ||
      /South African Identity/i.test(t),
    confidence: 0.9,
  },
  {
    code: "passport",
    test: (t) => /\bPASSPORT\b/i.test(t) && /REPUBLIC OF|United Kingdom|United States/i.test(t),
    confidence: 0.85,
  },
  {
    code: "marriage_certificate",
    test: (t) => /Marriage Certificate/i.test(t) || /Certificate of Marriage/i.test(t),
    confidence: 0.9,
  },

  // Deed / title
  {
    code: "title_deed",
    test: (t) =>
      /Deed of Transfer/i.test(t) ||
      /Registrar of Deeds/i.test(t) ||
      /Title\s+Deed\b/i.test(t) ||
      /\bT\s*\d{4,}\/\d{4}\b/.test(t),
    confidence: 0.9,
  },

  // Rates / utility statements
  {
    code: "rates_account",
    test: (t) =>
      /Municipal Rates Account/i.test(t) ||
      /Property Rates.*Account/i.test(t) ||
      /Rates and Refuse/i.test(t) ||
      /Levy Statement/i.test(t) ||
      /Telkom.*Invoice/i.test(t),
    confidence: 0.85,
  },

  // Company / juristic-party paperwork
  {
    code: "company_resolution",
    test: (t) =>
      /Company Resolution/i.test(t) ||
      /Members['’]?\s+Resolution/i.test(t) ||
      /Written Resolution/i.test(t) ||
      /Directors['’]?\s+Resolution/i.test(t),
    confidence: 0.9,
  },
  {
    code: "cipc_form",
    test: (t) => /\bCIPC\b/i.test(t) || /COR\s*14/i.test(t) || /COR\s*15/i.test(t),
    confidence: 0.9,
  },
  {
    code: "trust_deed",
    test: (t) => /Trust Deed/i.test(t) || /Letters of Authority/i.test(t),
    confidence: 0.9,
  },
  {
    code: "share_register",
    test: (t) => /Share Register/i.test(t) || /Register of Members/i.test(t),
    confidence: 0.9,
  },
  {
    code: "vat_certificate",
    test: (t) => /VAT.*(Registration|Certificate)/i.test(t) && /South African Revenue Service|SARS/i.test(t),
    confidence: 0.9,
  },

  // Listing / mandate paperwork
  {
    code: "mandate",
    test: (t) =>
      /Sole Mandate/i.test(t) ||
      /Joint Mandate/i.test(t) ||
      /Open Mandate/i.test(t) ||
      /Exclusive Mandate/i.test(t),
    confidence: 0.85,
  },
  {
    code: "ppra_disclosure",
    test: (t) =>
      /PPRA/i.test(t) && /Disclosure/i.test(t) ||
      /Mandatory Disclosure Form/i.test(t),
    confidence: 0.9,
  },
  {
    code: "cma",
    test: (t) => /Comparative Market Analysis/i.test(t),
    confidence: 0.9,
  },
  {
    code: "lightstone_report",
    test: (t) => /Lightstone/i.test(t) && /Property Report/i.test(t),
    confidence: 0.9,
  },

  // Sale-side paperwork (last because these words appear in lots of other places)
  {
    code: "offer_to_purchase",
    test: (t) => /Offer to Purchase\b/i.test(t) && !/agreement of sale/i.test(t),
    confidence: 0.85,
  },
  {
    code: "agreement_of_sale",
    test: (t) =>
      /Agreement of Sale/i.test(t) ||
      /Deed of Sale\b/i.test(t) ||
      (/PURCHASER/i.test(t) && /SELLER/i.test(t) && /PURCHASE PRICE/i.test(t)),
    confidence: 0.85,
  },
  {
    code: "movables_agreement",
    test: (t) => /Movables.*Agreement/i.test(t) || /Sale of Movables/i.test(t),
    confidence: 0.9,
  },
  {
    code: "addendum",
    test: (t) => /^Addendum\b/im.test(t) || /Addendum to.*Agreement/i.test(t),
    confidence: 0.85,
  },

  // Plans / drawings
  {
    code: "architectural_plan",
    test: (t) =>
      /Site Plan/i.test(t) ||
      /Floor Plan/i.test(t) ||
      /Elevation Drawing/i.test(t) ||
      /Section View/i.test(t) ||
      /SANS 10400/i.test(t),
    confidence: 0.8,
  },
  {
    code: "estate_design_manual",
    test: (t) => /Design Manual/i.test(t) || /Architectural Design Manual/i.test(t),
    confidence: 0.9,
  },
];

export function classifyContent(text: string): { code: string; confidence: number } | null {
  if (!text || text.length < 40) return null;
  // Focus on the header — most SA property docs identify themselves in the
  // first page or two. Trims noise from long agreements' body text.
  const head = text.slice(0, 4000);
  for (const r of RULES) {
    if (r.test(head) || r.test(text)) {
      return { code: r.code, confidence: r.confidence ?? 0.85 };
    }
  }
  return null;
}

// The set of codes the LLM fallback picks from — keeps its answer in the
// vocabulary we've actually seeded.
export const CLASSIFIABLE_CODES = [
  "gas_coc", "electrical_coc", "beetle_cert", "boundary_relaxation",
  "fica_questionnaire", "kyc_form", "id_document", "passport",
  "marriage_certificate", "proof_of_address",
  "title_deed", "rates_account",
  "company_resolution", "cipc_form", "trust_deed", "share_register", "vat_certificate",
  "mandate", "ppra_disclosure", "cma", "lightstone_report",
  "property_info", "detailed_listing",
  "offer_to_purchase", "agreement_of_sale", "land_freehold_agreement",
  "movables_agreement", "addendum",
  "architectural_plan", "concept_plan", "estate_design_manual",
  "transfer_instruction", "email_thread",
  "photo",
  "other",
];
