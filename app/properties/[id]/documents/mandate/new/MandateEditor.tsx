"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DocumentPage } from "@/app/documents/DocumentPage";
import ClauseDocument from "@/app/documents/ClauseDocument";
import type { AgencyIdentity } from "@/lib/agency";
import { resolveDocument, type TemplateModel } from "@/lib/documents/resolve";
import { buildMandateContext, TOKEN_LABELS, type MandateRecordInputs } from "@/lib/documents/context";
import { saveMandate } from "./actions";

// Mandate editor (plan 019 Arc A2). The interview bar at the top asks only
// for what the record cannot supply — price, commission, term, and for a
// juristic or represented seller, who signs. Everything else is filled from
// the property and parties. The preview below is the clause-library
// document, re-resolved on every change; gaps are highlighted on screen
// and listed under "Still needed", and print plain.
//
// Commission is always "plus VAT thereon" (decided 2026-09-28 with
// Bronwyn). The rare VAT-inclusive mandate is a per-document edit of the
// commission clause in the draft editor (A4), not a toggle here.

export default function MandateEditor({
  type,
  model,
  record,
  sellerIsJuristic,
  listingId,
  propertyId,
  propertyAddress,
  agency,
  jointAgencyOptions,
}: {
  type: "exclusive" | "joint" | "open";
  model: TemplateModel;
  record: MandateRecordInputs;
  sellerIsJuristic: boolean;
  listingId: string | null;
  propertyId: string;
  propertyAddress: string;
  agency: AgencyIdentity;
  jointAgencyOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [signedDate, setSignedDate] = useState(today);
  const [termMonths, setTermMonths] = useState<string>("");
  const [askingPrice, setAskingPrice] = useState<string>("");
  const [commissionPct, setCommissionPct] = useState<string>("");
  const [representative, setRepresentative] = useState<string>("");
  const [jointAgencyId, setJointAgencyId] = useState<string>(
    // Pre-select Pam Golding for a joint mandate — Dream's usual partner.
    type === "joint"
      ? jointAgencyOptions.find((a) => a.name.toLowerCase().includes("pam golding"))?.id ?? ""
      : "",
  );
  const [saving, startSaving] = useTransition();
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const askingPriceNum = parsePrice(askingPrice);
  const commissionPctNum = parseNum(commissionPct);
  const termMonthsNum = parseNum(termMonths);
  const jointAgencyName = jointAgencyOptions.find((a) => a.id === jointAgencyId)?.name ?? null;
  const expiryDate = useMemo(() => addMonths(signedDate, termMonthsNum), [signedDate, termMonthsNum]);

  const ctx = useMemo(
    () =>
      buildMandateContext(
        {
          ...record,
          jointAgencyName,
          sellerRepresentative: representative.trim() || record.sellerRepresentative,
        },
        { askingPrice: askingPriceNum, commissionPct: commissionPctNum, termMonths: termMonthsNum },
      ),
    [record, jointAgencyName, representative, askingPriceNum, commissionPctNum, termMonthsNum],
  );
  const doc = useMemo(() => resolveDocument(model, ctx), [model, ctx]);

  const stillNeeded = Array.from(new Set(doc.unresolved.map((t) => TOKEN_LABELS[t] ?? t)));
  const asksRepresentative = type !== "exclusive" || sellerIsJuristic;

  const canSave = listingId != null && !saving && !savedId && termMonthsNum != null && commissionPctNum != null;
  const missingListingWarning =
    listingId == null
      ? "This property has no listing yet. Save is disabled — capture a seller on the property first, or add a listing manually before preparing a mandate."
      : null;

  function handlePrint() {
    if (typeof window !== "undefined") window.print();
  }

  function handleSave() {
    if (!listingId || termMonthsNum == null || commissionPctNum == null) return;
    setSaveErr(null);
    startSaving(async () => {
      const res = await saveMandate({
        listingId,
        propertyId,
        templateId: model.id,
        type,
        signedDate,
        expiryDate,
        termMonths: termMonthsNum,
        askingPrice: askingPriceNum,
        commissionPct: commissionPctNum,
        jointAgencyName,
        title: `${model.label} — ${propertyAddress}`,
        fieldValues: ctx,
        clauseSelections: Object.fromEntries(
          doc.sections.filter((s) => s.variantId).map((s) => [s.clauseId, s.variantId as string]),
        ),
      });
      if (!res.ok) {
        setSaveErr(res.error);
        return;
      }
      setSavedId(res.mandateId);
      router.refresh();
    });
  }

  return (
    <>
      <div className="no-print" style={editorBarStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, alignItems: "end" }}>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Marketing price (ZAR)</span>
            <input
              type="text"
              value={askingPrice}
              onChange={(e) => setAskingPrice(e.target.value)}
              placeholder="e.g. 6 500 000"
              disabled={saving}
              style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
              inputMode="numeric"
            />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Commission % (plus VAT)</span>
            <input
              type="number"
              min={0}
              step={0.25}
              value={commissionPct}
              onChange={(e) => setCommissionPct(e.target.value)}
              placeholder="e.g. 5"
              disabled={saving}
              style={inputStyle}
            />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Term (months)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={termMonths}
              onChange={(e) => setTermMonths(e.target.value)}
              placeholder="e.g. 6"
              disabled={saving}
              style={inputStyle}
            />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Signed on</span>
            <input
              type="date"
              value={signedDate}
              onChange={(e) => setSignedDate(e.target.value)}
              disabled={saving}
              style={inputStyle}
            />
          </label>
          <div style={fieldWrap}>
            <span style={fieldLabel}>Expires</span>
            <div style={{ ...inputStyle, background: "transparent", border: "1px dashed #d7deef", fontFamily: "var(--font-mono)", fontSize: 13 }}>
              {expiryDate ?? "— set the term"}
            </div>
          </div>
        </div>

        {(type === "joint" || asksRepresentative) && (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {type === "joint" && (
              <label style={fieldWrap}>
                <span style={fieldLabel}>Joint agency</span>
                <select
                  value={jointAgencyId}
                  onChange={(e) => setJointAgencyId(e.target.value)}
                  disabled={saving}
                  style={inputStyle}
                >
                  <option value="">—</option>
                  {jointAgencyOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            )}
            {asksRepresentative && (
              <label style={fieldWrap}>
                <span style={fieldLabel}>
                  {sellerIsJuristic ? "Signing for the seller (name)" : "Represented by (leave blank if the seller signs)"}
                </span>
                <input
                  type="text"
                  value={representative}
                  onChange={(e) => setRepresentative(e.target.value)}
                  disabled={saving}
                  style={inputStyle}
                />
              </label>
            )}
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn-secondary" onClick={handlePrint} style={{ padding: "9px 14px", fontSize: 13 }}>
            Print
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={!canSave} style={{ padding: "9px 14px", fontSize: 13 }}>
            {savedId ? "Saved ✓" : saving ? "Saving…" : "Save mandate"}
          </button>
          {stillNeeded.length > 0 ? (
            <span style={{ fontSize: 12, color: "#9c6b1a" }}>
              Still needed: {stillNeeded.join(" · ")}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: "#1F7A4D" }}>All fields filled.</span>
          )}
        </div>

        {missingListingWarning && (
          <p style={{ marginTop: 12, color: "#9c6b1a", fontSize: 13 }}>{missingListingWarning}</p>
        )}
        {saveErr && (
          <p style={{ marginTop: 12, color: "#B8434B", fontSize: 13 }}>Save failed: {saveErr}</p>
        )}
        {savedId && (
          <p style={{ marginTop: 12, color: "#1F7A4D", fontSize: 13 }}>
            Mandate saved, and a draft of this document is on file. Return to the property record to see it.
          </p>
        )}
      </div>

      <DocumentPage agency={agency}>
        <ClauseDocument doc={doc} showGaps />
      </DocumentPage>
    </>
  );
}

// Accept prices typed with spaces, commas, and a leading "R".
function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[R\s,]/gi, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseNum(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function addMonths(iso: string, months: number | null): string | null {
  if (!months) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + Math.round(months));
  return d.toISOString().slice(0, 10);
}

const editorBarStyle: React.CSSProperties = {
  maxWidth: 780,
  margin: "0 auto 20px",
  padding: "14px 16px",
  background: "var(--paper)",
  border: "1px solid var(--paper-line)",
  borderRadius: 10,
};

const fieldWrap: React.CSSProperties = { display: "block" };

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#6b78a0",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d7deef",
  borderRadius: 7,
  fontSize: 14,
  fontFamily: "inherit",
  background: "#ffffff",
};
