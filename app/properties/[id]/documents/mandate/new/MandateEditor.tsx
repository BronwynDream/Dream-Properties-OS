"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DocumentPage } from "@/app/documents/DocumentPage";
import MandateSole from "@/app/documents/templates/MandateSole";
import type { AgencyIdentity } from "@/lib/agency";
import { saveMandate } from "./actions";

// Client-side editor: form controls at the top (hidden in print via .no-print)
// drive the live preview below. Print → browser print dialog. Save → server
// action creates the mandate row.

type SellerViewModel = {
  displayName: string;
  idOrRegistration: string | null;
  maritalRegimeLabel: string | null;
  addressLine: string | null;
  phone: string | null;
  email: string | null;
};

type PropertyViewModel = {
  id: string;
  primaryAddress: string;
  erfNumber: string | null;
  titleDeed: string | null;
  extentSqm: number | null;
};

export default function MandateEditor({
  type,
  listingId,
  agency,
  seller,
  property,
  jointAgencyOptions,
}: {
  type: "sole" | "joint";
  listingId: string | null;
  agency: AgencyIdentity;
  seller: SellerViewModel | null;
  property: PropertyViewModel;
  jointAgencyOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const sixMonths = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().slice(0, 10);
  })();

  const [signedDate, setSignedDate] = useState(today);
  const [expiryDate, setExpiryDate] = useState(sixMonths);
  const [askingPrice, setAskingPrice] = useState<string>("");
  const [commissionPct, setCommissionPct] = useState<string>("5");
  const [commissionInclVat, setCommissionInclVat] = useState(true);
  const [jointAgencyId, setJointAgencyId] = useState<string>(
    // Pre-select Pam Golding when a joint mandate is being prepared and PG
    // exists in the option list — the most common joint-agency partner per
    // the project memory (Dream ↔ Pam Golding Knysna).
    type === "joint"
      ? jointAgencyOptions.find((a) => a.name.toLowerCase().includes("pam golding"))?.id ?? ""
      : "",
  );
  const [saving, startSaving] = useTransition();
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const askingPriceNum = parsePrice(askingPrice);
  const commissionPctNum = Number(commissionPct) || 0;
  const jointAgencyName =
    jointAgencyOptions.find((a) => a.id === jointAgencyId)?.name ?? null;

  const canSave = listingId != null && !saving && !saved;
  const missingListingWarning =
    listingId == null
      ? "This property has no listing yet. Save is disabled — capture a seller on the property first, or add a listing manually before preparing a mandate."
      : null;

  function handlePrint() {
    if (typeof window !== "undefined") window.print();
  }

  function handleSave() {
    if (!listingId) return;
    setSaveErr(null);
    startSaving(async () => {
      const res = await saveMandate({
        listingId,
        type,
        signedDate,
        expiryDate,
        askingPrice: askingPriceNum,
        commissionPct: commissionPctNum,
        commissionInclVat,
        jointAgencyName,
        propertyId: property.id,
      });
      if (!res.ok) {
        setSaveErr(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <>
      <div className="no-print" style={editorBarStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr)) auto auto", gap: 12, alignItems: "end" }}>
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
          <label style={fieldWrap}>
            <span style={fieldLabel}>Expires</span>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              disabled={saving}
              style={inputStyle}
            />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Asking price (ZAR)</span>
            <input
              type="text"
              value={askingPrice}
              onChange={(e) => setAskingPrice(e.target.value)}
              placeholder="e.g. 6 500 000"
              disabled={saving}
              style={{ ...inputStyle, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
              inputMode="numeric"
            />
          </label>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Commission %</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="number"
                min={0}
                step={0.25}
                value={commissionPct}
                onChange={(e) => setCommissionPct(e.target.value)}
                disabled={saving}
                style={{ ...inputStyle, width: 80 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--paper-mute)" }}>
                <input
                  type="checkbox"
                  checked={commissionInclVat}
                  onChange={(e) => setCommissionInclVat(e.target.checked)}
                  disabled={saving}
                />
                incl VAT
              </label>
            </div>
          </label>
          <button
            type="button"
            className="ghost-dark"
            onClick={handlePrint}
            style={{ padding: "9px 14px", fontSize: 13, whiteSpace: "nowrap" }}
          >
            Print
          </button>
          <button
            type="button"
            className="cta"
            onClick={handleSave}
            disabled={!canSave}
            style={{ padding: "9px 14px", fontSize: 13, whiteSpace: "nowrap" }}
          >
            {saved ? "Saved ✓" : saving ? "Saving…" : "Save mandate"}
          </button>
        </div>

        {type === "joint" && jointAgencyOptions.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <label style={fieldWrap}>
              <span style={fieldLabel}>Joint agency</span>
              <select
                value={jointAgencyId}
                onChange={(e) => setJointAgencyId(e.target.value)}
                disabled={saving}
                style={{ ...inputStyle, maxWidth: 420 }}
              >
                <option value="">—</option>
                {jointAgencyOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {missingListingWarning && (
          <p style={{ marginTop: 12, color: "#9c6b1a", fontSize: 13 }}>{missingListingWarning}</p>
        )}
        {saveErr && (
          <p style={{ marginTop: 12, color: "#B8434B", fontSize: 13 }}>
            Save failed: {saveErr}
          </p>
        )}
        {saved && (
          <p style={{ marginTop: 12, color: "#1F7A4D", fontSize: 13 }}>
            Mandate saved. Return to the property record to see it under this listing.
          </p>
        )}
      </div>

      <DocumentPage agency={agency}>
        <MandateSole
          type={type}
          agency={agency}
          jointAgencyName={jointAgencyName}
          seller={seller}
          property={{
            primaryAddress: property.primaryAddress,
            erfNumber: property.erfNumber,
            titleDeed: property.titleDeed,
            extentSqm: property.extentSqm,
          }}
          terms={{
            askingPrice: askingPriceNum,
            commissionPct: commissionPctNum,
            commissionInclVat,
            signedDate,
            expiryDate,
          }}
        />
      </DocumentPage>
    </>
  );
}

// Accept prices typed with spaces, commas, and a leading "R". Returns null
// for empty input so the template falls back to a blank line.
function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[R\s,]/gi, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
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
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
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
