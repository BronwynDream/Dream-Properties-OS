"use client";

import { useState } from "react";

// Inline seller-capture block used by NewPropertyForm and by /contacts/new.
// Collapsed by default — an agent can create a property without a seller
// (still useful for prospecting / market listings) but capturing the seller
// here means "Prepare Mandate" is one click away on the resulting record.
//
// Two tabs: Individual (natural person, ID or passport, marital regime) and
// Entity (trust / company / close corp, registration number). Matches the
// party.party_type enum and the fields FICA/PPRA actually need on a mandate.

export type SellerFormValue = {
  partyType: "individual" | "trust" | "company" | "close_corporation";
  // individual
  fullName: string;
  idNumber: string;
  passportNo: string;
  matrimonialRegime:
    | "single"
    | "married_in_community"
    | "married_anc_no_accrual"
    | "married_anc_with_accrual"
    | "foreign_marriage"
    | "divorced"
    | "widowed"
    | "unknown";
  // entity
  entityName: string;
  registrationNo: string;
  // shared
  email: string;
  phone: string;
};

export const emptySeller: SellerFormValue = {
  partyType: "individual",
  fullName: "",
  idNumber: "",
  passportNo: "",
  matrimonialRegime: "unknown",
  entityName: "",
  registrationNo: "",
  email: "",
  phone: "",
};

// Returns null when the block hasn't been opened / no meaningful data was
// captured, or the seller shape ready for the server action. Empty-string
// stripping so we don't push blank strings into optional columns.
export function normaliseSeller(v: SellerFormValue): SellerFormValue | null {
  const trimmed = {
    partyType: v.partyType,
    fullName: v.fullName.trim(),
    idNumber: v.idNumber.trim(),
    passportNo: v.passportNo.trim(),
    matrimonialRegime: v.matrimonialRegime,
    entityName: v.entityName.trim(),
    registrationNo: v.registrationNo.trim(),
    email: v.email.trim(),
    phone: v.phone.trim(),
  };
  const nameMissing =
    trimmed.partyType === "individual"
      ? trimmed.fullName === ""
      : trimmed.entityName === "";
  if (nameMissing) return null;
  return trimmed;
}

export default function AddSellerFields({
  value,
  onChange,
  disabled = false,
  open,
  onOpenChange,
}: {
  value: SellerFormValue;
  onChange: (next: SellerFormValue) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const isIndividual = value.partyType === "individual";

  function patch(p: Partial<SellerFormValue>) {
    onChange({ ...value, ...p });
  }

  if (!open) {
    return (
      <div style={rowStyle}>
        <button
          type="button"
          className="ghost-dark"
          onClick={() => onOpenChange(true)}
          disabled={disabled}
          style={{ padding: "8px 12px", fontSize: 13 }}
        >
          + Add seller
        </button>
        <span style={{ color: "#6b78a0", fontSize: 12 }}>
          Optional — capture the seller now so mandates and OTPs pre-fill later
        </span>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <div>
          <p style={eyebrowStyle}>Seller</p>
          <h4 style={panelTitleStyle}>Capture the owner-of-record</h4>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={disabled}
          style={{
            background: "none",
            border: "none",
            color: "#7a86a8",
            fontSize: 12,
            cursor: "pointer",
            padding: 4,
          }}
        >
          Remove seller
        </button>
      </div>

      {/* Individual / entity tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(
          [
            ["individual", "Individual"],
            ["trust", "Trust"],
            ["company", "Company"],
            ["close_corporation", "CC"],
          ] as const
        ).map(([code, label]) => {
          const active = value.partyType === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => patch({ partyType: code })}
              disabled={disabled}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid",
                borderColor: active ? "var(--navy)" : "#d7deef",
                background: active ? "rgba(19,43,132,0.06)" : "#fff",
                color: "var(--estuary)",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isIndividual ? "1.5fr 1fr 1fr" : "1.5fr 1fr",
          gap: 10,
          alignItems: "end",
        }}
      >
        {isIndividual ? (
          <>
            <label style={{ display: "block" }}>
              <span style={fieldLabel}>Legal name *</span>
              <input
                type="text"
                value={value.fullName}
                onChange={(e) => patch({ fullName: e.target.value })}
                placeholder="e.g. Bronwyn Anne Eyre"
                disabled={disabled}
                style={inputStyle}
                required
              />
            </label>
            <label style={{ display: "block" }}>
              <span style={fieldLabel}>SA ID number</span>
              <input
                type="text"
                value={value.idNumber}
                onChange={(e) => patch({ idNumber: e.target.value })}
                placeholder="13 digits"
                disabled={disabled}
                style={inputStyle}
                inputMode="numeric"
              />
            </label>
            <label style={{ display: "block" }}>
              <span style={fieldLabel}>Passport (if no SA ID)</span>
              <input
                type="text"
                value={value.passportNo}
                onChange={(e) => patch({ passportNo: e.target.value })}
                placeholder="e.g. GB1234567"
                disabled={disabled}
                style={inputStyle}
              />
            </label>
          </>
        ) : (
          <>
            <label style={{ display: "block" }}>
              <span style={fieldLabel}>Registered name *</span>
              <input
                type="text"
                value={value.entityName}
                onChange={(e) => patch({ entityName: e.target.value })}
                placeholder="e.g. The Eyre Family Trust"
                disabled={disabled}
                style={inputStyle}
                required
              />
            </label>
            <label style={{ display: "block" }}>
              <span style={fieldLabel}>Registration / trust no.</span>
              <input
                type="text"
                value={value.registrationNo}
                onChange={(e) => patch({ registrationNo: e.target.value })}
                placeholder="e.g. IT001234/2015"
                disabled={disabled}
                style={inputStyle}
              />
            </label>
          </>
        )}

        {isIndividual && (
          <label style={{ display: "block", gridColumn: "1 / -1" }}>
            <span style={fieldLabel}>Marital regime</span>
            <select
              value={value.matrimonialRegime}
              onChange={(e) =>
                patch({
                  matrimonialRegime: e.target.value as SellerFormValue["matrimonialRegime"],
                })
              }
              disabled={disabled}
              style={inputStyle}
            >
              <option value="unknown">Not yet captured</option>
              <option value="single">Single / never married</option>
              <option value="married_in_community">Married in community of property</option>
              <option value="married_anc_no_accrual">Married ANC (no accrual)</option>
              <option value="married_anc_with_accrual">Married ANC (with accrual)</option>
              <option value="foreign_marriage">Foreign marriage</option>
              <option value="divorced">Divorced</option>
              <option value="widowed">Widowed</option>
            </select>
          </label>
        )}

        <label style={{ display: "block" }}>
          <span style={fieldLabel}>Email</span>
          <input
            type="email"
            value={value.email}
            onChange={(e) => patch({ email: e.target.value })}
            placeholder="seller@example.com"
            disabled={disabled}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "block" }}>
          <span style={fieldLabel}>Phone</span>
          <input
            type="tel"
            value={value.phone}
            onChange={(e) => patch({ phone: e.target.value })}
            placeholder="+27 82 000 0000"
            disabled={disabled}
            style={inputStyle}
          />
        </label>
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  gridColumn: "1 / -1",
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginTop: 4,
};

const panelStyle: React.CSSProperties = {
  gridColumn: "1 / -1",
  background: "#fbfcfe",
  border: "1px solid #eef1f8",
  borderRadius: 10,
  padding: 14,
  marginTop: 4,
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
};

const eyebrowStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--gold)",
  margin: 0,
};

const panelTitleStyle: React.CSSProperties = {
  fontFamily: "Inter, -apple-system, sans-serif",
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--estuary)",
  margin: "2px 0 0",
};

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
  background: "#fbfcfe",
};
