// Document resolver — plan 019 Arc A2.
//
// Turns a template in the clause library into a rendered document model:
//
//   doc_template ─┬─ doc_template_slot (order) ─ clause ─ clause_variant[]
//                 └─ DocContext (field values from the record / the agent)
//
//   → ResolvedDocument { sections[], unresolved[] }
//
// Three rules, in this order, decide the wording of every slot:
//   1. an explicit selection on the draft (clause_selections[clause_id]),
//   2. the first approved variant whose `applies_when` matches the context,
//   3. the clause's default variant, else its first approved variant.
//
// Fill-source rule (plan 007): a token's value comes from the record first,
// then from what the agent typed in the interview, and is never defaulted
// silently — a token the context cannot supply stays a visible blank and is
// reported in `unresolved` so the editor can ask for it. Commission % and
// term are always interviewed, never defaulted (Simon, 2026-08-05).
//
// Pure where it can be: loadTemplate() talks to Supabase, resolveDocument()
// does not, so the editor can re-resolve on every keystroke.

import type { SupabaseClient } from "@supabase/supabase-js";

export type DocContext = Record<string, string | number | boolean | null | undefined>;

export type TemplateVariant = {
  id: string;
  label: string;
  body: string;
  applies_when: Record<string, unknown> | null;
  is_default: boolean;
  approved: boolean;
  source: string;
};

export type TemplateSlot = {
  id: string;
  ordinal: number;
  heading: string | null;
  numbering: string | null;
  condition: Record<string, unknown> | null;
  is_optional: boolean;
  default_on: boolean;
  clause: { id: string; key: string; label: string; category: string };
  variants: TemplateVariant[];
};

export type TemplateModel = {
  id: string;
  code: string;
  label: string;
  requires_property: boolean;
  requires_purchaser: boolean;
  slots: TemplateSlot[];
};

export type ResolvedSection = {
  slotId: string;
  clauseId: string;
  clauseKey: string;
  clauseLabel: string;
  ordinal: number;
  heading: string | null;
  numbering: string | null;
  variantId: string | null;
  variantLabel: string | null;
  /** Rendered body with tokens filled. Blank lines separate paragraphs. */
  body: string;
  /** Tokens in this section the context could not fill. */
  unresolved: string[];
  optional: boolean;
  included: boolean;
  /** True when the body came from clause_overrides, not the library. */
  overridden: boolean;
  /** Alternatives the agent may switch to (approved only). */
  choices: { id: string; label: string }[];
};

export type ResolvedDocument = {
  templateCode: string;
  templateLabel: string;
  sections: ResolvedSection[];
  /** Union of every included section's unresolved tokens, deduplicated. */
  unresolved: string[];
};

export type DraftOverrides = {
  clause_selections?: Record<string, string>; // clause_id → variant_id
  clause_overrides?: Record<string, string>;  // clause_id → edited body
  omitted_clauses?: string[];                 // clause_ids switched off
};

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
export const BLANK = "________________";

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadTemplate(
  supabase: SupabaseClient,
  code: string,
): Promise<TemplateModel | null> {
  const { data: tpl, error } = await supabase
    .from("doc_template")
    .select("id, code, label, requires_property, requires_purchaser")
    .eq("code", code)
    .maybeSingle();
  if (error || !tpl) return null;

  const { data: slotRows } = await supabase
    .from("doc_template_slot")
    .select(
      "id, ordinal, heading, numbering, condition, is_optional, default_on, clause:clause_id(id, key, label, category, variants:clause_variant(id, label, body, applies_when, is_default, approved, source))",
    )
    .eq("template_id", tpl.id)
    .order("ordinal", { ascending: true });

  const slots: TemplateSlot[] = ((slotRows ?? []) as unknown as RawSlot[]).map((r) => {
    const clause = Array.isArray(r.clause) ? r.clause[0] : r.clause;
    return {
      id: r.id,
      ordinal: r.ordinal,
      heading: r.heading,
      numbering: r.numbering,
      condition: r.condition,
      is_optional: r.is_optional,
      default_on: r.default_on,
      clause: { id: clause.id, key: clause.key, label: clause.label, category: clause.category },
      variants: (clause.variants ?? []).filter((v) => v.approved),
    };
  });

  return {
    id: tpl.id,
    code: tpl.code,
    label: tpl.label,
    requires_property: tpl.requires_property,
    requires_purchaser: tpl.requires_purchaser,
    slots,
  };
}

type RawSlot = {
  id: string;
  ordinal: number;
  heading: string | null;
  numbering: string | null;
  condition: Record<string, unknown> | null;
  is_optional: boolean;
  default_on: boolean;
  clause:
    | { id: string; key: string; label: string; category: string; variants: TemplateVariant[] }
    | { id: string; key: string; label: string; category: string; variants: TemplateVariant[] }[];
};

// ---------------------------------------------------------------------------
// Resolving (pure)
// ---------------------------------------------------------------------------

export function resolveDocument(
  model: TemplateModel,
  ctx: DocContext,
  overrides: DraftOverrides = {},
): ResolvedDocument {
  const selections = overrides.clause_selections ?? {};
  const bodyOverrides = overrides.clause_overrides ?? {};
  const omitted = new Set(overrides.omitted_clauses ?? []);

  const sections: ResolvedSection[] = [];
  for (const slot of model.slots) {
    const clauseId = slot.clause.id;
    const conditionOk = slot.condition ? predicateMatches(slot.condition, ctx) : true;
    const included = conditionOk && !omitted.has(clauseId) && (!slot.is_optional || slot.default_on || selections[clauseId] != null);

    const variant = pickVariant(slot, ctx, selections[clauseId]);
    const rawBody = bodyOverrides[clauseId] ?? variant?.body ?? "";
    const { text, unresolved } = fillTokens(rawBody, ctx);

    sections.push({
      slotId: slot.id,
      clauseId,
      clauseKey: slot.clause.key,
      clauseLabel: slot.clause.label,
      ordinal: slot.ordinal,
      heading: slot.heading,
      numbering: slot.numbering,
      variantId: variant?.id ?? null,
      variantLabel: variant?.label ?? null,
      body: text,
      unresolved,
      optional: slot.is_optional,
      included,
      overridden: bodyOverrides[clauseId] != null,
      choices: slot.variants.map((v) => ({ id: v.id, label: v.label })),
    });
  }

  const unresolved = Array.from(
    new Set(sections.filter((s) => s.included).flatMap((s) => s.unresolved)),
  );
  return { templateCode: model.code, templateLabel: model.label, sections, unresolved };
}

function pickVariant(slot: TemplateSlot, ctx: DocContext, selectedId?: string): TemplateVariant | null {
  const vs = slot.variants;
  if (vs.length === 0) return null;
  if (selectedId) {
    const hit = vs.find((v) => v.id === selectedId);
    if (hit) return hit;
  }
  const byPredicate = vs.find((v) => v.applies_when && predicateMatches(v.applies_when, ctx));
  if (byPredicate) return byPredicate;
  // A variant with a predicate that did NOT match is not a fallback: a
  // "Joint master" body must never print on an exclusive mandate just
  // because it was flagged default.
  const unconditional = vs.filter((v) => !v.applies_when);
  return unconditional.find((v) => v.is_default) ?? unconditional[0] ?? null;
}

/**
 * jsonb predicate semantics, kept deliberately small:
 *   {"k": v}            → ctx.k === v
 *   {"k": [a, b]}       → ctx.k in [a, b]
 *   {"k_gt": n}         → Number(ctx.k) > n       (also _gte, _lt, _lte)
 *   {"k_set": true}     → ctx.k is non-empty
 * All keys must hold (AND).
 */
export function predicateMatches(pred: Record<string, unknown>, ctx: DocContext): boolean {
  for (const [k, v] of Object.entries(pred)) {
    const m = k.match(/^(.*)_(gt|gte|lt|lte|set)$/);
    if (m) {
      const val = ctx[m[1]];
      if (m[2] === "set") {
        if (isEmpty(val) === Boolean(v)) return false;
        continue;
      }
      const n = Number(val);
      const t = Number(v);
      if (!Number.isFinite(n) || !Number.isFinite(t)) return false;
      if (m[2] === "gt" && !(n > t)) return false;
      if (m[2] === "gte" && !(n >= t)) return false;
      if (m[2] === "lt" && !(n < t)) return false;
      if (m[2] === "lte" && !(n <= t)) return false;
      continue;
    }
    const val = ctx[k];
    if (Array.isArray(v)) {
      if (!v.some((x) => looseEq(x, val))) return false;
    } else if (!looseEq(v, val)) return false;
  }
  return true;
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));
}

export function fillTokens(body: string, ctx: DocContext): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const text = body.replace(TOKEN_RE, (_m, name: string) => {
    const v = ctx[name];
    if (isEmpty(v)) {
      if (!unresolved.includes(name)) unresolved.push(name);
      return BLANK;
    }
    return String(v);
  });
  return { text, unresolved };
}

// ---------------------------------------------------------------------------
// Number words — South African contract style ("Six Million Five Hundred
// Thousand", "Five", "Twelve"). Used for the "(... RAND)" and "(... percent)"
// parentheticals the masters require.
// ---------------------------------------------------------------------------

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) {
    if (h) parts.push("and");
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const t = Math.floor(rest / 10), o = rest % 10;
      parts.push(o ? `${TENS[t]} ${ONES[o]}` : TENS[t]);
    }
  }
  return parts.join(" ");
}

export function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return "";
  n = Math.round(Math.abs(n));
  if (n === 0) return "Zero";
  const scales: [number, string][] = [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]];
  const out: string[] = [];
  for (const [div, name] of scales) {
    const q = Math.floor(n / div);
    if (q) { out.push(`${below1000(q)} ${name}`); n %= div; }
  }
  if (n) out.push(below1000(n));
  return out.join(" ");
}

/** "6 500 000" — the way the masters print ZAR figures. */
export function formatZar(n: number): string {
  // Explicit grouping: ICU's en-ZA uses a narrow no-break space, which
  // copies badly out of a PDF and differs across runtimes.
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** 5 → "Five"; 3.5 → "Three Point Five". */
export function percentToWords(n: number): string {
  if (!Number.isFinite(n)) return "";
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100);
  if (!frac) return numberToWords(whole);
  const fracDigits = String(frac).padStart(2, "0").replace(/0+$/, "");
  return `${numberToWords(whole)} Point ${fracDigits.split("").map((d) => ONES[Number(d)] || "Zero").join(" ")}`;
}
