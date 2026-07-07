"use client";

import { useState, useTransition } from "react";
import { mergeProperties, mergeParties, dismissDupe } from "./actions";

export type PropertyPair = {
  kind: "property";
  a_id: string;
  a_label: string;
  a_deed: string | null;
  a_suburb: string | null;
  a_extent: number | null;
  a_transfer_count: number;
  a_listing_count: number;
  a_erf_count: number;
  b_id: string;
  b_label: string;
  b_deed: string | null;
  b_suburb: string | null;
  b_extent: number | null;
  b_transfer_count: number;
  b_listing_count: number;
  b_erf_count: number;
  score: number;
};

export type PartyPair = {
  kind: "party";
  a_id: string;
  a_label: string;
  a_type: string;
  a_id_number: string | null;
  a_reg: string | null;
  a_transfer_count: number;
  a_fica_count: number;
  a_member_count: number;
  b_id: string;
  b_label: string;
  b_type: string;
  b_id_number: string | null;
  b_reg: string | null;
  b_transfer_count: number;
  b_fica_count: number;
  b_member_count: number;
  score: number;
};

export type Pair = PropertyPair | PartyPair;

function scoreClass(score: number): string {
  if (score >= 0.9) return "tier-red";
  if (score >= 0.7) return "tier-amber";
  return "tier-green";
}

function fieldRow(label: string, a: string | number | null, b: string | number | null) {
  const a_s = a === null || a === "" ? "—" : String(a);
  const b_s = b === null || b === "" ? "—" : String(b);
  const same = a_s === b_s;
  return (
    <tr key={label}>
      <td style={{ color: "#6b78a0", fontSize: 12, padding: "6px 10px" }}>{label}</td>
      <td style={{ padding: "6px 10px", color: same ? "#15203a" : "#a12020" }}>{a_s}</td>
      <td style={{ padding: "6px 10px", color: same ? "#15203a" : "#a12020" }}>{b_s}</td>
    </tr>
  );
}

export default function PairCard({ pair }: { pair: Pair }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function doMerge(winnerId: string, loserId: string) {
    if (!confirm(`Merge ${loserId.slice(0, 8)} into ${winnerId.slice(0, 8)}? This can't be undone.`)) {
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res =
        pair.kind === "property"
          ? await mergeProperties(winnerId, loserId, note || null)
          : await mergeParties(winnerId, loserId, note || null);
      if (!res.ok) setErr(res.error ?? "merge failed");
    });
  }

  function doDismiss() {
    setErr(null);
    startTransition(async () => {
      const res = await dismissDupe(pair.kind, pair.a_id, pair.b_id, note || null);
      if (!res.ok) setErr(res.error ?? "dismiss failed");
    });
  }

  const rows =
    pair.kind === "property" ? (
      <>
        {fieldRow("Address", pair.a_label, pair.b_label)}
        {fieldRow("Title deed", pair.a_deed, pair.b_deed)}
        {fieldRow("Suburb", pair.a_suburb, pair.b_suburb)}
        {fieldRow("Extent (m²)", pair.a_extent, pair.b_extent)}
        {fieldRow("Erven", pair.a_erf_count, pair.b_erf_count)}
        {fieldRow("Transfers", pair.a_transfer_count, pair.b_transfer_count)}
        {fieldRow("Listings", pair.a_listing_count, pair.b_listing_count)}
      </>
    ) : (
      <>
        {fieldRow("Name", pair.a_label, pair.b_label)}
        {fieldRow("Type", pair.a_type, pair.b_type)}
        {fieldRow("ID number", pair.a_id_number, pair.b_id_number)}
        {fieldRow("Registration", pair.a_reg, pair.b_reg)}
        {fieldRow("On transfers", pair.a_transfer_count, pair.b_transfer_count)}
        {fieldRow("FICA records", pair.a_fica_count, pair.b_fica_count)}
        {fieldRow("Member links", pair.a_member_count, pair.b_member_count)}
      </>
    );

  return (
    <div
      style={{
        background: "var(--white)",
        borderRadius: 12,
        boxShadow: "0 4px 20px rgba(15,42,99,0.06)",
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className={`tier ${scoreClass(pair.score)}`}>{pair.score.toFixed(2)}</span>
          <span style={{ color: "#6b78a0", fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}>
            {pair.a_id.slice(0, 8)} ↔ {pair.b_id.slice(0, 8)}
          </span>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            <th style={{ width: 120, textAlign: "left", fontSize: 11, color: "#6b78a0", padding: "6px 10px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Field
            </th>
            <th style={{ textAlign: "left", fontSize: 11, color: "#6b78a0", padding: "6px 10px" }}>Side A</th>
            <th style={{ textAlign: "left", fontSize: 11, color: "#6b78a0", padding: "6px 10px" }}>Side B</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>

      <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Reason (optional, goes in audit log)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={pending}
          style={{
            flex: "1 1 200px",
            padding: "8px 10px",
            border: "1px solid var(--mist)",
            borderRadius: 6,
            fontSize: 13,
          }}
        />
        <button
          className="ghost-dark"
          disabled={pending}
          onClick={() => doMerge(pair.a_id, pair.b_id)}
          title="Keep A, fold B in"
        >
          Keep A → merge B
        </button>
        <button
          className="ghost-dark"
          disabled={pending}
          onClick={() => doMerge(pair.b_id, pair.a_id)}
          title="Keep B, fold A in"
        >
          Keep B → merge A
        </button>
        <button className="ghost-dark" disabled={pending} onClick={doDismiss}>
          Not a duplicate
        </button>
      </div>

      {err && <p className="error" style={{ marginTop: 10, fontSize: 13 }}>{err}</p>}
    </div>
  );
}
