"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DocumentPage } from "@/app/documents/DocumentPage";
import ClauseDocument from "@/app/documents/ClauseDocument";
import type { AgencyIdentity } from "@/lib/agency";
import {
  resolveDocument,
  numberToWords,
  percentToWords,
  formatZar,
  type DocContext,
  type TemplateModel,
} from "@/lib/documents/resolve";
import { TOKEN_LABELS } from "@/lib/documents/context";
import { DEAL_TOKEN_LABELS } from "@/lib/documents/context-deal";
import { saveDraft, type DraftState } from "./actions";

// The draft editor (plan 019 Arc A4). Works for any template in the clause
// library because it is driven by the template, not written per document:
//
//   Fields   — one input per {{token}} the template's wording uses, minus the
//              *_words tokens, which derive from their numeric sibling.
//   Clauses  — for each slot: pick another library wording when the clause
//              has more than one, edit the wording for this document only
//              (kept separately so the library is never touched), or leave an
//              optional clause out.
//   Preview  — the resolved document, gaps highlighted, re-rendered on every
//              change. Print is the browser's print of the preview.
//
// Save keeps the previous state as a version (migration 0072).

type Draft = {
  id: string;
  title: string;
  status: "draft" | "final" | "superseded";
  version: number;
  field_values: DocContext;
  clause_selections: Record<string, string>;
  clause_overrides: Record<string, string>;
  omitted_clauses: string[];
};

const LABELS: Record<string, string> = { ...TOKEN_LABELS, ...DEAL_TOKEN_LABELS };
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Tokens whose value is computed from another field. */
const DERIVED: Record<string, (ctx: DocContext) => string | null> = {
  asking_price_words: (c) => wordsOfZar(c.asking_price),
  purchase_price_words: (c) => wordsOfZar(c.purchase_price),
  movables_price_words: (c) => wordsOfZar(c.movables_price),
  commission_pct_words: (c) => (numOf(c.commission_pct) != null ? percentToWords(numOf(c.commission_pct)!) : null),
  term_months_words: (c) => (numOf(c.term_months) != null ? numberToWords(numOf(c.term_months)!).toLowerCase() : null),
};

function numOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[R\s,]/gi, ""));
  return Number.isFinite(n) ? n : null;
}
function wordsOfZar(v: unknown): string | null {
  const n = numOf(v);
  return n != null && n > 0 ? numberToWords(n) : null;
}

export default function DraftEditor({
  draft,
  model,
  agency,
  versions,
}: {
  draft: Draft;
  model: TemplateModel;
  agency: AgencyIdentity;
  versions: { version: number; saved_at: string; note: string | null; by: string | null }[];
}) {
  const router = useRouter();
  const [fields, setFields] = useState<DocContext>(draft.field_values);
  const [selections, setSelections] = useState<Record<string, string>>(draft.clause_selections);
  const [overrides, setOverrides] = useState<Record<string, string>>(draft.clause_overrides);
  const [omitted, setOmitted] = useState<string[]>(draft.omitted_clauses);
  const [editing, setEditing] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const readOnly = draft.status !== "draft";

  // Which tokens does this template actually use? Scan every variant body
  // (not just the chosen one) so switching a variant never reveals an
  // unasked field.
  const tokens = useMemo(() => {
    const set = new Set<string>();
    for (const s of model.slots) for (const v of s.variants) for (const m of v.body.matchAll(TOKEN_RE)) set.add(m[1]);
    // Overrides can introduce tokens too.
    for (const body of Object.values(overrides)) for (const m of body.matchAll(TOKEN_RE)) set.add(m[1]);
    return Array.from(set).filter((t) => !(t in DERIVED) && t !== "mandate_type");
  }, [model, overrides]);

  const ctx = useMemo(() => {
    const out: DocContext = { ...fields };
    for (const [k, fn] of Object.entries(DERIVED)) {
      const v = fn(out);
      if (v != null) out[k] = v;
      else delete out[k];
    }
    // Pretty ZAR figures in the document, however they were typed.
    for (const k of ["asking_price", "purchase_price", "movables_price"]) {
      const n = numOf(out[k]);
      if (n != null && n > 0) out[k] = formatZar(n);
    }
    return out;
  }, [fields]);

  const doc = useMemo(
    () => resolveDocument(model, ctx, { clause_selections: selections, clause_overrides: overrides, omitted_clauses: omitted }),
    [model, ctx, selections, overrides, omitted],
  );
  const stillNeeded = Array.from(new Set(doc.unresolved.map((t) => LABELS[t] ?? t.replace(/_/g, " "))));

  function setField(k: string, v: string) {
    setFields((f) => ({ ...f, [k]: v === "" ? null : v }));
    setDirty(true);
  }
  function choose(clauseId: string, variantId: string) {
    setSelections((s) => ({ ...s, [clauseId]: variantId }));
    setDirty(true);
  }
  function toggleOmit(clauseId: string) {
    setOmitted((o) => (o.includes(clauseId) ? o.filter((x) => x !== clauseId) : [...o, clauseId]));
    setDirty(true);
  }
  function startEdit(clauseId: string, currentBody: string) {
    setOverrides((o) => (o[clauseId] != null ? o : { ...o, [clauseId]: currentBody }));
    setEditing(clauseId);
  }
  function setOverride(clauseId: string, body: string) {
    setOverrides((o) => ({ ...o, [clauseId]: body }));
    setDirty(true);
  }
  function resetOverride(clauseId: string) {
    setOverrides((o) => {
      const n = { ...o };
      delete n[clauseId];
      return n;
    });
    setEditing(null);
    setDirty(true);
  }

  function handleSave() {
    setMsg(null);
    const state: DraftState = { field_values: fields, clause_selections: selections, clause_overrides: overrides, omitted_clauses: omitted };
    startSaving(async () => {
      const res = await saveDraft(draft.id, state);
      if (!res.ok) {
        setMsg(`Save failed: ${res.error}`);
        return;
      }
      setDirty(false);
      setMsg(`Saved as version ${res.version}.`);
      router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)", gap: 20 }} className="draft-editor">
      <aside className="no-print" style={{ position: "sticky", top: 16, alignSelf: "start", maxHeight: "calc(100vh - 32px)", overflow: "auto", display: "grid", gap: 14 }}>
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <strong style={{ fontSize: 14 }}>{draft.title}</strong>
            <span style={mono}>v{draft.version}{dirty ? " · unsaved" : ""}</span>
          </div>
          <div style={{ ...mono, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.1em", color: readOnly ? "var(--positive)" : "var(--caution)" }}>
            {draft.status}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || readOnly || !dirty} style={btn}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => typeof window !== "undefined" && window.print()} style={btn}>
              Print
            </button>
          </div>
          {msg && <p style={{ ...mono, margin: "10px 0 0", color: msg.startsWith("Save failed") ? "var(--critical)" : "var(--positive)" }}>{msg}</p>}
          {stillNeeded.length > 0 ? (
            <p style={{ fontSize: 12, color: "#9c6b1a", margin: "10px 0 0" }}>Still needed: {stillNeeded.join(" · ")}</p>
          ) : (
            <p style={{ fontSize: 12, color: "#1F7A4D", margin: "10px 0 0" }}>All fields filled.</p>
          )}
        </div>

        {tokens.length > 0 && (
          <div style={panel}>
            <h3 style={h3}>Fields</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {tokens.map((t) => (
                <label key={t} style={{ display: "block" }}>
                  <span style={fieldLabel}>{LABELS[t] ?? t.replace(/_/g, " ")}</span>
                  <input
                    type="text"
                    value={fields[t] == null ? "" : String(fields[t])}
                    onChange={(e) => setField(t, e.target.value)}
                    disabled={readOnly}
                    style={inputStyle}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={panel}>
          <h3 style={h3}>Clauses</h3>
          <p style={{ fontSize: 12, color: "var(--paper-mute)", margin: "0 0 10px" }}>
            Wording comes from Bronwyn&apos;s library. Edits here apply to this document only.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {doc.sections.map((s) => (
              <div key={s.slotId} style={{ borderTop: "1px solid var(--paper-line)", paddingTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, opacity: s.included ? 1 : 0.5 }}>
                    {s.numbering ? `${s.numbering}. ` : ""}{s.clauseLabel}
                  </span>
                  {s.optional && (
                    <label style={{ ...mono, display: "flex", gap: 4, alignItems: "center" }}>
                      <input type="checkbox" checked={s.included} onChange={() => toggleOmit(s.clauseId)} disabled={readOnly} /> include
                    </label>
                  )}
                </div>
                {s.choices.length > 1 && (
                  <select
                    value={s.variantId ?? ""}
                    onChange={(e) => choose(s.clauseId, e.target.value)}
                    disabled={readOnly}
                    style={{ ...inputStyle, marginTop: 6, fontSize: 12 }}
                  >
                    {s.choices.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                )}
                {editing === s.clauseId ? (
                  <div style={{ marginTop: 6 }}>
                    <textarea
                      value={overrides[s.clauseId] ?? s.body}
                      onChange={(e) => setOverride(s.clauseId, e.target.value)}
                      rows={8}
                      style={{ ...inputStyle, fontSize: 12, fontFamily: "inherit", lineHeight: 1.4 }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button type="button" className="btn-secondary" style={btnSm} onClick={() => setEditing(null)}>Done</button>
                      <button type="button" className="btn-secondary" style={btnSm} onClick={() => resetOverride(s.clauseId)}>Reset to library</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                    {!readOnly && (
                      <button type="button" className="btn-secondary" style={btnSm} onClick={() => startEdit(s.clauseId, s.body)}>
                        {s.overridden ? "Edit wording (edited)" : "Edit wording"}
                      </button>
                    )}
                    {s.overridden && (
                      <span style={{ ...mono, color: "var(--caution)" }}>edited on this document</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {versions.length > 0 && (
          <div style={panel}>
            <h3 style={h3}>Versions</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
              {versions.map((v) => (
                <li key={v.version} style={mono}>
                  v{v.version} · {new Date(v.saved_at).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" })}
                  {v.by ? ` · ${v.by}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <div style={{ minWidth: 0 }}>
        <DocumentPage agency={agency}>
          <ClauseDocument doc={doc} showGaps />
        </DocumentPage>
      </div>
      <style>{`@media (max-width: 900px) { .draft-editor { grid-template-columns: 1fr !important; } .draft-editor aside { position: static !important; max-height: none !important; } }`}</style>
    </div>
  );
}

const panel: React.CSSProperties = {
  padding: "12px 14px",
  background: "var(--paper)",
  border: "1px solid var(--paper-line)",
  borderRadius: 10,
};
const h3: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--estuary)", margin: "0 0 8px" };
const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--paper-mute)" };
const btn: React.CSSProperties = { padding: "8px 12px", fontSize: 13 };
const btnSm: React.CSSProperties = { padding: "4px 8px", fontSize: 11 };
const fieldLabel: React.CSSProperties = { display: "block", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b78a0", marginBottom: 4 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "7px 9px", border: "1px solid #d7deef", borderRadius: 7, fontSize: 13, fontFamily: "inherit", background: "#ffffff" };
