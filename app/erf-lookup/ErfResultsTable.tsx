"use client";

import { useState } from "react";
import { Rand, Area } from "@/app/components/format";

// Row shape matches the shapeRow() output in page.tsx. muni_valuation is
// now a SUM across the child muni_valuation rows (a single erf can be
// rated under multiple tariff categories); the breakdown is in
// `valuations` for the detail panel.
export type ValuationLine = {
  tariff: string | null;
  valuation: number | null;
  area_sqm: number | null;
};
export type ErfRow = {
  sg_number: string;
  erf_number: string | null;
  muni_erf_code: string | null;
  street_no: string | null;
  street_name: string | null;
  suburb: string | null;
  suburb_hint: string | null;
  muni_valuation_total: number | null;
  valuations: ValuationLine[];
  zoning: string | null;
  ward_no: string | null;
  sectional_title_flag: string | null;
  usage_: string | null;
  area_sqm_valroll: number | null;
  extent_sqm: number | null;
  property_type: string | null;
  sect_scheme_name: string | null;
  sect_scheme_unit: number | null;
  title_deed_no: string | null;
  old_title_deed_no: string | null;
  deeds_office: string | null;
  purch_date: string | null;
  registration_date: string | null;
  purch_price: number | null;
  bond_number: string | null;
  bond_amount: number | null;
  bond_institution: string | null;
  refreshed_at: string | null;
};

function addressOf(r: ErfRow): string {
  const parts: string[] = [];
  if (r.street_no) parts.push(r.street_no);
  if (r.street_name) parts.push(r.street_name);
  const line = parts.join(" ").trim();
  return line.length > 0 ? line : "(no street on file)";
}

export default function ErfResultsTable({ rows }: { rows: ErfRow[] }) {
  const [openSg, setOpenSg] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "80px 1fr 120px 130px 90px 80px 90px 40px",
          gap: 12,
          padding: "8px 12px",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--paper-mute, #6a7692)",
          borderBottom: "1px solid var(--hairline, #e2e8f5)",
        }}
      >
        <span>Erf</span>
        <span>Address</span>
        <span>Suburb</span>
        <span style={{ textAlign: "right" }}>Muni value</span>
        <span style={{ textAlign: "right" }}>Extent</span>
        <span>Zoning</span>
        <span>Use</span>
        <span />
      </div>

      {rows.map((r) => {
        const open = openSg === r.sg_number;
        return (
          <div
            key={r.sg_number}
            style={{
              border: open ? "1px solid var(--estuary, #132B84)" : "1px solid var(--hairline, #e2e8f5)",
              borderRadius: 3,
              background: open ? "#fbfcfe" : "transparent",
            }}
          >
            <button
              type="button"
              onClick={() => setOpenSg(open ? null : r.sg_number)}
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr 120px 130px 90px 80px 90px 40px",
                gap: 12,
                width: "100%",
                padding: "12px",
                fontFamily: "inherit",
                fontSize: 13,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontWeight: 600,
                  color: "var(--estuary, #132B84)",
                }}
              >
                {r.erf_number ?? "—"}
              </span>
              <span
                style={{
                  fontFamily: "'Fraunces', 'Cormorant Garamond', serif",
                  fontSize: 15,
                }}
              >
                {addressOf(r)}
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 11,
                  color: "var(--paper-mute, #6a7692)",
                  letterSpacing: "0.04em",
                }}
              >
                {r.suburb ?? "—"}
              </span>
              <span
                style={{
                  textAlign: "right",
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontWeight: 600,
                  color: r.muni_valuation_total ? "var(--estuary, #132B84)" : "var(--paper-mute, #6a7692)",
                }}
                title={
                  r.valuations.length > 1
                    ? `Sum of ${r.valuations.length} tariff categories`
                    : undefined
                }
              >
                <Rand value={r.muni_valuation_total} compact fallback="—" mutedPrefix={false} />
                {r.valuations.length > 1 && (
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--gold, #C8A032)",
                      marginLeft: 4,
                      letterSpacing: "0.04em",
                    }}
                  >
                    ×{r.valuations.length}
                  </span>
                )}
              </span>
              <span
                style={{
                  textAlign: "right",
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 12,
                  color: "var(--paper-mute, #6a7692)",
                }}
              >
                <Area value={r.extent_sqm ?? r.area_sqm_valroll} />
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 11,
                  color: "var(--paper-mute, #6a7692)",
                }}
              >
                {r.zoning ?? "—"}
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 11,
                  color: "var(--paper-mute, #6a7692)",
                }}
              >
                {r.usage_ ?? "—"}
              </span>
              <span
                aria-hidden
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 14,
                  color: "var(--paper-mute, #6a7692)",
                  textAlign: "right",
                }}
              >
                {open ? "▾" : "▸"}
              </span>
            </button>

            {open && <DetailPanel r={r} />}
          </div>
        );
      })}
    </div>
  );
}

function DetailPanel({ r }: { r: ErfRow }) {
  return (
    <div
      style={{
        padding: "0 16px 16px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 20,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 12,
      }}
    >
      <Group label="Cadastre">
        <Row k="SG number" v={r.sg_number} mono />
        <Row k="Muni erf code" v={r.muni_erf_code} mono />
        <Row k="Ward" v={r.ward_no} />
        {r.valuations.length === 1 && (
          <Row k="Tariff" v={r.valuations[0].tariff} />
        )}
      </Group>
      <Group label="Valuation">
        <Row k="Muni valuation (total)" v={<Rand value={r.muni_valuation_total} fallback="—" mutedPrefix={false} />} />
        <Row k="Extent (deed)" v={<Area value={r.extent_sqm} />} />
        <Row k="Extent (roll)" v={<Area value={r.area_sqm_valroll} />} />
        <Row k="Property type" v={r.property_type} />
      </Group>
      {r.valuations.length > 1 && (
        <Group label={`Valuation breakdown (${r.valuations.length} tariffs)`}>
          {r.valuations.map((v, i) => (
            <Row
              key={i}
              k={v.tariff ?? "(no tariff)"}
              v={<Rand value={v.valuation} fallback="—" mutedPrefix={false} />}
            />
          ))}
        </Group>
      )}
      <Group label="Zoning & use">
        <Row k="Zoning" v={r.zoning} />
        <Row k="Use" v={r.usage_} />
        <Row k="Sectional title?" v={r.sectional_title_flag} />
        {r.sect_scheme_name && <Row k="Scheme" v={`${r.sect_scheme_name}${r.sect_scheme_unit ? ` #${r.sect_scheme_unit}` : ""}`} />}
      </Group>
      <Group label="Deed">
        <Row k="Title deed" v={r.title_deed_no} mono />
        <Row k="Previous deed" v={r.old_title_deed_no} mono />
        <Row k="Deeds office" v={r.deeds_office} />
      </Group>
      <Group label="Last transaction">
        <Row k="Registered" v={r.registration_date} />
        <Row k="Purchase date" v={r.purch_date} />
        <Row k="Purchase price" v={<Rand value={r.purch_price} fallback="—" mutedPrefix={false} />} />
      </Group>
      {(r.bond_number || r.bond_amount || r.bond_institution) && (
        <Group label="Bond (public)">
          <Row k="Institution" v={r.bond_institution} />
          <Row k="Number" v={r.bond_number} mono />
          <Row k="Amount" v={<Rand value={r.bond_amount} fallback="—" mutedPrefix={false} />} />
        </Group>
      )}
      <div
        style={{
          gridColumn: "1 / -1",
          fontSize: 10,
          color: "var(--paper-mute, #6a7692)",
          letterSpacing: "0.04em",
          borderTop: "1px dashed var(--hairline, #e2e8f5)",
          paddingTop: 8,
        }}
      >
        Refreshed {r.refreshed_at ? new Date(r.refreshed_at).toISOString().slice(0, 10) : "—"}. Source: Knysna Muni public rateable-property roll.
        Owner PII deliberately not stored.
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p
        style={{
          margin: "0 0 6px",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--gold, #C8A032)",
        }}
      >
        {label}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--paper-mute, #6a7692)", fontSize: 11 }}>{k}</span>
      <span
        style={{
          color: v ? "var(--estuary, #132B84)" : "var(--paper-mute, #6a7692)",
          fontFamily: mono ? "'JetBrains Mono', ui-monospace, monospace" : "inherit",
          textAlign: "right",
          fontWeight: v ? 500 : 400,
        }}
      >
        {v ?? "—"}
      </span>
    </div>
  );
}
