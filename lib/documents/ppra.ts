import type { SupabaseClient } from "@supabase/supabase-js";
import { questionsFor, answerMark, ppraFormTypeFor, PLOT_PRESET, type PpraFormType } from "@/lib/ppraDisclosure";
import type { DocContext } from "./resolve";

// PPRA Section 67 disclosure ↔ the document engine (plan 019 Arc A6).
//
// ensureDisclosureRows: the structured record exists for (transfer, form),
// with one answer row per prescribed statement. Plot disclosures start from
// Bronwyn's vacant-land preset. Idempotent; safe to call on every open.
//
// ppraContext: the tokens the ppra_disclosure template needs — one
// ans_<key> per statement as "YES [X]  NO [ ]  N/A [ ]", the additional
// information with every explanation folded in, and the property
// description. Unanswered statements stay unresolved so the editor shows
// the gap and finalise warns.

export async function ensureDisclosureRows(
  supabase: SupabaseClient,
  transferId: string,
  formType: PpraFormType,
): Promise<{ ok: true; disclosureId: string } | { ok: false; error: string }> {
  const { data: existing } = await supabase
    .from("ppra_disclosure")
    .select("id")
    .eq("transfer_id", transferId)
    .eq("form_type", formType)
    .maybeSingle();
  let disclosureId = existing?.id as string | undefined;
  const fresh = !disclosureId;

  if (!disclosureId) {
    const { data: created, error: insErr } = await supabase
      .from("ppra_disclosure")
      .insert({
        transfer_id: transferId,
        form_type: formType,
        additional_info: formType === "plot" ? PLOT_PRESET.additionalInfo : null,
      })
      .select("id")
      .single();
    if (insErr || !created) return { ok: false, error: insErr?.message ?? "Could not start the disclosure." };
    disclosureId = created.id;
  }

  const canonical = questionsFor(formType);
  const { data: existingRows } = await supabase
    .from("ppra_disclosure_answer_row")
    .select("question_key")
    .eq("disclosure_id", disclosureId);
  const have = new Set((existingRows ?? []).map((r: { question_key: string }) => r.question_key));
  const toInsert = canonical
    .filter((q) => !have.has(q.key))
    .map((q) => ({
      disclosure_id: disclosureId!,
      question_key: q.key,
      question_label: q.label,
      answer: fresh && formType === "plot" ? PLOT_PRESET.answers[q.key] ?? "unanswered" : "unanswered",
    }));
  if (toInsert.length > 0) {
    const { error: rowErr } = await supabase.from("ppra_disclosure_answer_row").insert(toInsert);
    if (rowErr) return { ok: false, error: rowErr.message };
  }
  return { ok: true, disclosureId: disclosureId! };
}

export const PPRA_TOKEN_LABELS: Record<string, string> = {
  property_description: "Property description (deeds and physical)",
  ppra_additional_info: "Additional information",
};

/** Prefix of the statement tokens; the editor hides these from Fields. */
export const PPRA_ANSWER_PREFIX = "ans_";

export async function ppraContext(
  supabase: SupabaseClient,
  transferId: string,
  formType: PpraFormType,
): Promise<DocContext> {
  const ctx: DocContext = {};
  const { data: header } = await supabase
    .from("ppra_disclosure")
    .select("id, additional_info")
    .eq("transfer_id", transferId)
    .eq("form_type", formType)
    .maybeSingle();
  if (!header) return ctx;

  const { data: rows } = await supabase
    .from("ppra_disclosure_answer_row")
    .select("question_key, answer, explanation")
    .eq("disclosure_id", header.id);
  const byKey = new Map(((rows ?? []) as { question_key: string; answer: "yes" | "no" | "na" | "unanswered"; explanation: string | null }[]).map((r) => [r.question_key, r]));

  const explanations: string[] = [];
  for (const q of questionsFor(formType)) {
    const r = byKey.get(q.key);
    const mark = answerMark(r?.answer);
    if (mark) ctx[`${PPRA_ANSWER_PREFIX}${q.key}`] = mark;
    if (r?.explanation?.trim()) explanations.push(`${shortLabel(q.label)}: ${r.explanation.trim()}`);
  }
  const extra = [header.additional_info?.trim(), ...explanations].filter(Boolean);
  if (extra.length > 0) ctx.ppra_additional_info = extra.join("\n\n");
  return ctx;
}

/** "I am aware of the defects in the roof." → "Defects in the roof". */
function shortLabel(label: string): string {
  const s = label.replace(/^I am aware (of|that)\s+/i, "").replace(/\.$/, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The statement answers live on the property record, not on the draft, so a
 * PPRA draft re-reads them every time it is opened or finalised. Returns the
 * field values with the ans_* tokens and additional information refreshed;
 * other drafts come back unchanged.
 */
export async function refreshPpraTokens(
  supabase: SupabaseClient,
  draft: { template_code: string | null; transfer_id: string | null; property_id: string | null; field_values: DocContext },
): Promise<DocContext> {
  if (draft.template_code !== "ppra_disclosure" || !draft.transfer_id || !draft.property_id) return draft.field_values;
  const { data: p } = await supabase.from("property").select("property_type:property_type_id(label)").eq("id", draft.property_id).maybeSingle();
  const typeLabel = ((Array.isArray(p?.property_type) ? p?.property_type[0] : p?.property_type) as { label: string } | null | undefined)?.label ?? null;
  const live = await ppraContext(supabase, draft.transfer_id, ppraFormTypeFor(typeLabel));
  const next: DocContext = { ...draft.field_values };
  for (const k of Object.keys(next)) if (k.startsWith(PPRA_ANSWER_PREFIX)) delete next[k];
  for (const [k, v] of Object.entries(live)) {
    // Additional information typed on the draft wins over the record's.
    if (k === "ppra_additional_info" && next[k]) continue;
    next[k] = v;
  }
  return next;
}
