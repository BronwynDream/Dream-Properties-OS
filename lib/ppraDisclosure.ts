// Canonical PPRA Section 67 disclosure questions.
//
// Two forms are in circulation at Dream:
//   HOUSE — full defects / structural / heritage checklist. Source of
//           truth is Bronwyn's "Mandatory PPRA Disclosure Form.pdf"
//           (Master Sale bundle 2026). Wording matches the PPRA
//           regulations verbatim so a re-scan matches word-for-word.
//   PLOT  — vacant-land variant. The scanned PDF has no text layer;
//           the question set below is our best-effort mirror of the
//           vacant-land items typically included on Dream's plot
//           forms (zoning, servitudes, NEMBA, water, mineral rights,
//           access). When Bronwyn confirms verbatim wording, update
//           these labels and bump the schema version — historical
//           answer rows snapshot the label they were captured under.
//
// question_key is a stable API token; question_label is what the user
// sees AND what gets snapshotted into the answer row. If wording
// changes, add a new key rather than mutating an old one so historical
// disclosures retain their original meaning.

export type PpraFormType = "house" | "plot";

export type PpraQuestion = {
  key: string;
  label: string;
  // Some questions are inverted ("I am aware that additions WERE
  // made with required consents") — a "no" is the concerning answer.
  // The UI + compliance summary use this to decide which answer to flag.
  concerningAnswer: "yes" | "no";
  category: "condition" | "structural" | "boundary" | "regulatory" | "environmental";
};

export const HOUSE_QUESTIONS: PpraQuestion[] = [
  { key: "defect_roof",           label: "I am aware of the defects in the roof.",                                                                                                                              concerningAnswer: "yes", category: "condition"    },
  { key: "defect_electrical",     label: "I am aware of the defects in the electrical systems.",                                                                                                                concerningAnswer: "yes", category: "condition"    },
  { key: "defect_plumbing",       label: "I am aware of the defects in the plumbing system, including in the swimming pool (if any).",                                                                          concerningAnswer: "yes", category: "condition"    },
  { key: "defect_hvac",           label: "I am aware of the defects in the heating and air conditioning systems, including the air filters and humidifiers.",                                                   concerningAnswer: "yes", category: "condition"    },
  { key: "defect_sanitary",       label: "I am aware of the defects in the septic or other sanitary disposal systems.",                                                                                         concerningAnswer: "yes", category: "condition"    },
  { key: "defect_basement",       label: "I am aware of any defects to the property and/or in the basement or foundations of the property, including cracks, seepage, bulges, flooding, dampness, wet walls, mould, drain tiling or sump pumps.", concerningAnswer: "yes", category: "structural"   },
  { key: "defect_structural",     label: "I am aware of structural defects in the Property.",                                                                                                                    concerningAnswer: "yes", category: "structural"   },
  { key: "boundary_dispute",      label: "I am aware of boundary line dispute, encroachments or encumbrances in connection with the Property.",                                                                  concerningAnswer: "yes", category: "boundary"     },
  { key: "remodel_affected_structure", label: "I am aware that remodeling and refurbishment have affected the structure of the Property.",                                                                       concerningAnswer: "yes", category: "structural"   },
  { key: "additions_with_consent", label: "I am aware that any additions or improvements made to or any erections made on the property have been done or were made only after the required consents, permissions and permits to do so were properly obtained.", concerningAnswer: "no",  category: "regulatory"   },
  { key: "heritage",              label: "I am aware that a structure on the Property has been earmarked as a historic structure or heritage site.",                                                             concerningAnswer: "yes", category: "regulatory"   },
];

// Plot / vacant-land. Bronwyn's "Mandatory PPRA Disclosure Form Vacant
// Land 2026" (docs/templates/2026-final/) is the SAME prescribed form, not a
// different question set: every statement is pre-answered N/A except the
// boundary-dispute one (NO), with "This Property is Vacant Land." as the
// additional information. Section 67's form is prescribed, so a vacant-land
// question set of our own would not be the statutory disclosure. The
// earlier invented plot questions (zoning, NEMBA, water rights…) are gone;
// the preset below is applied to the structured record when a plot
// disclosure is created, and the seller can still change any answer.
export const PLOT_QUESTIONS: PpraQuestion[] = HOUSE_QUESTIONS;

export const PLOT_PRESET: { answers: Record<string, "yes" | "no" | "na">; additionalInfo: string } = {
  answers: Object.fromEntries(HOUSE_QUESTIONS.map((q) => [q.key, q.key === "boundary_dispute" ? "no" : "na"])) as Record<string, "yes" | "no" | "na">,
  additionalInfo: "This Property is Vacant Land.",
};

/** Which form a property takes, from its type label ("Vacant land", "House - 27"…). */
export function ppraFormTypeFor(propertyTypeLabel: string | null | undefined): PpraFormType {
  return /vacant|plot|land|erf$/.test((propertyTypeLabel ?? "").toLowerCase()) ? "plot" : "house";
}

/** The answer as it prints on the prescribed form. Unanswered → null (a gap). */
export function answerMark(answer: "yes" | "no" | "na" | "unanswered" | null | undefined): string | null {
  if (!answer || answer === "unanswered") return null;
  const box = (on: boolean) => (on ? "[X]" : "[ ]");
  return `YES ${box(answer === "yes")}    NO ${box(answer === "no")}    N/A ${box(answer === "na")}`;
}

export function questionsFor(form: PpraFormType): PpraQuestion[] {
  return form === "house" ? HOUSE_QUESTIONS : PLOT_QUESTIONS;
}

// Given the raw answer rows for a disclosure, count how many are
// unanswered vs concerning (i.e. answered in the flagging direction
// and therefore require a written explanation). Used by /compliance
// to summarise "18 questions · 4 unanswered · 2 concerning" at a glance.
export function summariseAnswers(
  rows: { question_key: string; answer: "yes" | "no" | "na" | "unanswered"; explanation: string | null }[],
  form: PpraFormType,
): { total: number; unanswered: number; concerning: number; concerningMissingExplanation: number } {
  const qs = questionsFor(form);
  const byKey = new Map(rows.map((r) => [r.question_key, r]));
  let unanswered = 0;
  let concerning = 0;
  let concerningMissingExplanation = 0;
  for (const q of qs) {
    const r = byKey.get(q.key);
    if (!r || r.answer === "unanswered") {
      unanswered++;
      continue;
    }
    if (r.answer === q.concerningAnswer) {
      concerning++;
      if (!r.explanation || r.explanation.trim().length === 0) {
        concerningMissingExplanation++;
      }
    }
  }
  return { total: qs.length, unanswered, concerning, concerningMissingExplanation };
}

// Overall readiness: a disclosure is "complete" when every canonical
// question has a non-unanswered answer AND every concerning answer
// has an explanation AND the owner has signed.
export type DisclosureReadiness = "complete" | "in_progress" | "gaps" | "not_started";

export function readinessOf(
  hasHeader: boolean,
  signed: boolean,
  summary: { total: number; unanswered: number; concerning: number; concerningMissingExplanation: number },
): DisclosureReadiness {
  if (!hasHeader) return "not_started";
  if (summary.unanswered === summary.total && !signed) return "not_started";
  if (summary.unanswered === 0 && summary.concerningMissingExplanation === 0 && signed) return "complete";
  if (summary.unanswered === 0 && summary.concerningMissingExplanation === 0) return "gaps"; // signature missing counts as a gap
  return "in_progress";
}
