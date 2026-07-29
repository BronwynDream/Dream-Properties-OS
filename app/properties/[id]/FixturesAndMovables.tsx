"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ensureInventory,
  upsertInventoryRow,
  deleteInventoryRow,
  upsertMovablesAgreement,
} from "./actions";
import {
  KIND_LABEL,
  type InventoryCategory,
  type InventoryKind,
} from "@/lib/inventory";
import { randString } from "@/app/components/format";

// Fixtures & Movables inventory panel — sits under PPRA + Certs inside
// the Deal Compliance card on the Property Record.
//
// Fixtures: clause 14 items sold WITH the immovable property (no
//           separate price). The buyer receives them at the sale price.
// Movables: Annexure A items sold as a SEPARATE agreement with its own
//           price + effective date, running alongside the main sale.
//
// UI shape:
//   Two side-by-side lists. Each list has a "Start from Dream default"
//   button that seeds the canonical list on first click. Every row is
//   editable inline; include-toggle flips whether the row prints on
//   the signed contract; delete removes it entirely.
//
// Movables list carries a small header at the top for price + effective
// date, which writes to the existing agreement table (agreement_type
// = 'movables').

export type InventoryRow = {
  id: string;
  category: InventoryCategory;
  kind: InventoryKind;
  description: string;
  is_included: boolean;
  notes: string | null;
  sort_order: number;
};

export type MovablesAgreement = {
  id: string;
  price: string | number | null;
  transfer_date: string | null;
  signature_date: string | null;
  notes: string | null;
} | null;

type Props = {
  propertyId: string;
  transferId: string;
  rows: InventoryRow[];
  movables: MovablesAgreement;
};

export default function FixturesAndMovables({ propertyId, transferId, rows, movables }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const fixtures = rows.filter((r) => r.category === "fixture").sort((a, b) => a.sort_order - b.sort_order);
  const movablesRows = rows.filter((r) => r.category === "movables").sort((a, b) => a.sort_order - b.sort_order);

  function refresh() { router.refresh(); }

  function seed(category: InventoryCategory) {
    startTransition(async () => {
      await ensureInventory({ transferId, category, propertyId });
      refresh();
    });
  }

  return (
    <section style={{ marginTop: 20 }}>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--ink-700, #423B31)" }}>
        <b>Fixtures &amp; movables</b>
        <span style={{ marginLeft: 10, color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11 }}>
          clause 14 (included with sale) · Annexure A (separate sale)
        </span>
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 12,
        }}
      >
        <InventoryColumn
          title="Fixtures — included with the sale"
          subtitle="Clause 14 · sold with the immovable property"
          category="fixture"
          rows={fixtures}
          propertyId={propertyId}
          transferId={transferId}
          onSeed={() => seed("fixture")}
          seeding={pending}
        />
        <InventoryColumn
          title="Movables — separate sale (Annexure A)"
          subtitle="Movables Agreement · own price + effective date"
          category="movables"
          rows={movablesRows}
          propertyId={propertyId}
          transferId={transferId}
          onSeed={() => seed("movables")}
          seeding={pending}
          movablesHeader={
            <MovablesHeader
              propertyId={propertyId}
              transferId={transferId}
              movables={movables}
            />
          }
        />
      </div>
    </section>
  );
}

// -------- one column (fixture / movables) --------

function InventoryColumn({
  title,
  subtitle,
  category,
  rows,
  propertyId,
  transferId,
  onSeed,
  seeding,
  movablesHeader,
}: {
  title: string;
  subtitle: string;
  category: InventoryCategory;
  rows: InventoryRow[];
  propertyId: string;
  transferId: string;
  onSeed: () => void;
  seeding: boolean;
  movablesHeader?: React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--paper-0, #FBF9F4)",
        border: "1px solid var(--line-soft, #E7E0D2)",
        borderRadius: 4,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <p style={{ margin: 0, fontFamily: "'Fraunces', serif", fontSize: 15, color: "var(--estuary, #132B84)", fontWeight: 500 }}>
          {title}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
          {subtitle}
        </p>
      </div>

      {movablesHeader}

      {rows.length === 0 ? (
        <div style={{ padding: "12px 0", borderTop: "1px dashed var(--line-strong, #D8CFBE)", marginTop: 8 }}>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-700, #423B31)" }}>
            No {category === "fixture" ? "fixtures" : "movables"} listed yet.
          </p>
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" onClick={onSeed} disabled={seeding} style={btnPrimary}>
              {seeding ? "Seeding…" : "Start from Dream default"}
            </button>
            <button type="button" onClick={() => setAdding(true)} style={btnGhost}>
              Add row
            </button>
          </div>
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <InventoryRowEditor key={r.id} row={r} propertyId={propertyId} transferId={transferId} />
          ))}
        </ul>
      )}

      {rows.length > 0 && !adding && (
        <button type="button" onClick={() => setAdding(true)} style={{ ...btnGhost, marginTop: 8 }}>
          + Add row
        </button>
      )}

      {adding && (
        <NewRowForm
          propertyId={propertyId}
          transferId={transferId}
          category={category}
          nextSort={rows.length}
          onDone={() => setAdding(false)}
        />
      )}
    </div>
  );
}

// -------- single row editor (autosave on blur / toggle) --------

function InventoryRowEditor({ row, propertyId, transferId }: { row: InventoryRow; propertyId: string; transferId: string }) {
  const router = useRouter();
  const [description, setDescription] = useState(row.description);
  const [notes, setNotes] = useState(row.notes ?? "");
  const [kind, setKind] = useState<InventoryKind>(row.kind);
  const [isIncluded, setIsIncluded] = useState(row.is_included);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function persist(overrides?: Partial<InventoryRow>) {
    setErr(null);
    startTransition(async () => {
      const res = await upsertInventoryRow({
        id: row.id,
        transferId,
        propertyId,
        category: row.category,
        kind: overrides?.kind ?? kind,
        description: overrides?.description ?? description,
        is_included: overrides?.is_included ?? isIncluded,
        notes: overrides?.notes ?? notes,
        sort_order: row.sort_order,
      });
      if (!res.ok) setErr(res.error);
      router.refresh();
    });
  }

  function del() {
    if (!confirm(`Delete "${row.description}"?`)) return;
    startTransition(async () => {
      const res = await deleteInventoryRow({ id: row.id, propertyId });
      if (!res.ok) setErr(res.error);
      router.refresh();
    });
  }

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "6px 0",
        borderBottom: "1px solid var(--line-soft, #E7E0D2)",
        opacity: isIncluded ? 1 : 0.55,
      }}
    >
      <input
        type="checkbox"
        checked={isIncluded}
        onChange={(e) => {
          setIsIncluded(e.target.checked);
          persist({ is_included: e.target.checked });
        }}
        disabled={pending}
        aria-label={isIncluded ? "Included" : "Excluded"}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => persist()}
          disabled={pending}
          style={inputStyle}
        />
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={kind}
            onChange={(e) => {
              const v = e.target.value as InventoryKind;
              setKind(v);
              persist({ kind: v });
            }}
            disabled={pending}
            style={{ ...inputStyle, fontSize: 11, padding: "2px 6px", width: "auto" }}
          >
            {Object.entries(KIND_LABEL).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => persist()}
            placeholder="Note (optional)"
            disabled={pending}
            style={{ ...inputStyle, fontSize: 11, padding: "2px 6px", flex: 1, minWidth: 100 }}
          />
        </div>
        {err && <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--critical, #9A3B34)" }}>{err}</p>}
      </div>
      <button
        type="button"
        onClick={del}
        disabled={pending}
        title="Delete row"
        style={{
          background: "none",
          border: "none",
          fontSize: 14,
          cursor: "pointer",
          color: "var(--paper-mute, #6a7692)",
          padding: 4,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </li>
  );
}

// -------- new row form (add-then-collapse) --------

function NewRowForm({
  propertyId,
  transferId,
  category,
  nextSort,
  onDone,
}: {
  propertyId: string;
  transferId: string;
  category: InventoryCategory;
  nextSort: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<InventoryKind>("other");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    if (!description.trim()) return;
    startTransition(async () => {
      const res = await upsertInventoryRow({
        transferId,
        propertyId,
        category,
        kind,
        description,
        is_included: true,
        sort_order: nextSort,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setDescription("");
      onDone();
      router.refresh();
    });
  }

  return (
    <div style={{ marginTop: 10, padding: 8, background: "var(--paper-1, #F5F1E8)", borderRadius: 4, border: "1px dashed var(--line-strong, #D8CFBE)" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="New item"
          disabled={pending}
          style={{ ...inputStyle, flex: 1, minWidth: 160 }}
          autoFocus
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as InventoryKind)} disabled={pending} style={{ ...inputStyle, fontSize: 11, padding: "2px 6px", width: "auto" }}>
          {Object.entries(KIND_LABEL).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <button type="button" onClick={submit} disabled={pending || !description.trim()} style={btnPrimary}>
          {pending ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={onDone} style={btnGhost}>
          Cancel
        </button>
      </div>
      {err && <p style={{ margin: "6px 0 0", fontSize: 10, color: "var(--critical, #9A3B34)" }}>{err}</p>}
    </div>
  );
}

// -------- movables agreement header (price + dates) --------

function MovablesHeader({
  propertyId,
  transferId,
  movables,
}: {
  propertyId: string;
  transferId: string;
  movables: MovablesAgreement;
}) {
  const router = useRouter();
  const [price, setPrice] = useState(movables?.price != null ? String(movables.price) : "");
  const [effective, setEffective] = useState(movables?.transfer_date ?? "");
  const [signed, setSigned] = useState(movables?.signature_date ?? "");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function persist() {
    setErr(null);
    startTransition(async () => {
      const res = await upsertMovablesAgreement({
        transferId,
        propertyId,
        price,
        effective_date: effective,
        signature_date: signed,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 1500);
    });
  }

  const displayPrice = price && Number.isFinite(Number(price)) ? `R ${randString(Number(price))}` : "R —";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 8,
        padding: "8px 10px",
        marginBottom: 8,
        background: "var(--paper-1, #F5F1E8)",
        borderRadius: 3,
        border: "1px solid var(--line-soft, #E7E0D2)",
      }}
    >
      <label style={labelStyle}>
        Price
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            step="1"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={persist}
            placeholder="0"
            disabled={pending}
            style={{ ...inputStyle, flex: 1 }}
          />
        </div>
        <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "var(--paper-mute, #6a7692)" }}>
          {displayPrice}
        </span>
      </label>
      <label style={labelStyle}>
        Effective (usually = registration)
        <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} onBlur={persist} disabled={pending} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Signed
        <input type="date" value={signed} onChange={(e) => setSigned(e.target.value)} onBlur={persist} disabled={pending} style={inputStyle} />
      </label>
      <div style={{ minWidth: 60, alignSelf: "end", fontSize: 10, fontFamily: "'JetBrains Mono', ui-monospace, monospace", textAlign: "right", color: err ? "var(--critical)" : saved ? "var(--positive)" : "transparent" }}>
        {err ?? (saved ? "Saved" : " ")}
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "5px 12px",
  background: "var(--estuary, #132B84)",
  color: "var(--paper-0, #FBF9F4)",
  border: "none",
  borderRadius: 3,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "5px 10px",
  background: "transparent",
  color: "var(--estuary, #132B84)",
  border: "1px solid var(--estuary, #132B84)",
  borderRadius: 3,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--paper-mute, #6a7692)",
};

const inputStyle: React.CSSProperties = {
  padding: "4px 8px",
  border: "1px solid var(--line-strong, #D8CFBE)",
  borderRadius: 3,
  fontFamily: "inherit",
  fontSize: 12,
  background: "var(--paper-0, #FBF9F4)",
  width: "100%",
};
