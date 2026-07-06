"use client";

import Link from "next/link";
import { PropertyDiff, FieldDiff } from "@/lib/diff";

function money(v: string | null): string {
  if (!v) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? `R ${n.toLocaleString("en-ZA")}` : v;
}

function fieldStyle(kind: FieldDiff["kind"]): React.CSSProperties {
  const base: React.CSSProperties = { padding: "8px 12px", verticalAlign: "top", fontSize: 13 };
  if (kind === "adds") return { ...base, color: "#0E4A2A", background: "#e2f2e8" };
  if (kind === "conflict") return { ...base, color: "#681B16", background: "#fdecec" };
  return { ...base, color: "#5b6885" };
}

function kindLabel(kind: FieldDiff["kind"]): { text: string; className: string } {
  if (kind === "adds") return { text: "adds", className: "tier tier-green" };
  if (kind === "conflict") return { text: "conflict", className: "tier tier-red" };
  if (kind === "same") return { text: "same", className: "pill" };
  return { text: "empty", className: "pill" };
}

export default function DiffPanel({ diff }: { diff: PropertyDiff }) {
  const anyFieldChanges = diff.fields.some(
    (f) => f.kind === "adds" || f.kind === "conflict",
  );
  const totalFiles = diff.files.new.length + diff.files.duplicate.length;

  return (
    <div
      className="match-panel"
      style={{
        marginTop: 32,
        background: "#fbfcfe",
        border: "1px solid #d7deef",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>What this batch adds</h2>
        <span style={{ color: "#5b6885", fontSize: 13 }}>
          to{" "}
          <Link
            href={`/properties/${diff.propertyId}`}
            className="row-link"
            style={{ fontWeight: 600 }}
          >
            {diff.propertyLabel}
          </Link>
        </span>
      </div>
      <p style={{ color: "#5b6885", fontSize: 13, margin: "0 0 16px" }}>
        The reviewer chose to link this batch to an existing property. Everything below
        summarises what changes on that record if you commit as-is.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <SummaryTile
          label="New files"
          value={diff.files.new.length}
          tone="adds"
        />
        <SummaryTile
          label="Duplicate files"
          value={diff.files.duplicate.length}
          tone="muted"
        />
        <SummaryTile
          label="Fields filled"
          value={diff.counts.adds}
          tone="adds"
        />
        <SummaryTile
          label="Field conflicts"
          value={diff.counts.conflicts}
          tone={diff.counts.conflicts > 0 ? "conflict" : "muted"}
        />
        <SummaryTile
          label="Existing transfers"
          value={diff.existingTransfers.length}
          tone="muted"
        />
      </div>

      {/* Property field diff */}
      {anyFieldChanges && (
        <>
          <h3 style={sectionHeading}>Property fields</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={diffTable}>
              <thead>
                <tr>
                  <th style={thStyle}>Field</th>
                  <th style={thStyle}>On record now</th>
                  <th style={thStyle}>This batch proposes</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {diff.fields
                  .filter((f) => f.kind === "adds" || f.kind === "conflict")
                  .map((f) => {
                    const k = kindLabel(f.kind);
                    return (
                      <tr key={f.label}>
                        <td style={fieldStyle(f.kind)}>{f.label}</td>
                        <td style={fieldStyle(f.kind)}>{f.existing ?? "—"}</td>
                        <td style={fieldStyle(f.kind)}>
                          <b>{f.proposed ?? "—"}</b>
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <span className={k.className}>{k.text}</span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!anyFieldChanges && (
        <p style={{ color: "#5b6885", fontSize: 13, marginTop: 14 }}>
          No property field changes — every value this batch proposes either matches the
          existing record or is missing.
        </p>
      )}

      {/* File diff */}
      {totalFiles > 0 && (
        <>
          <h3 style={sectionHeading}>Documents</h3>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <FileList
              title={`New (${diff.files.new.length})`}
              files={diff.files.new}
              tone="adds"
            />
            <FileList
              title={`Duplicate (${diff.files.duplicate.length})`}
              files={diff.files.duplicate}
              tone="muted"
              emptyText="No obvious duplicates by filename."
            />
          </div>
          <p style={{ color: "#5b6885", fontSize: 12, marginTop: 8 }}>
            Duplicate detection is by normalised filename only — extension and{" "}
            <code>(1)</code>-style copy markers stripped, whitespace / underscores collapsed.
            A file only counts if it&apos;s been classified (unclassified rows aren&apos;t
            promoted to documents on commit).
          </p>
        </>
      )}

      {/* Transfer diff */}
      <h3 style={sectionHeading}>Transfers</h3>
      {diff.existingTransfers.length === 0 ? (
        <p style={{ color: "#5b6885", fontSize: 13 }}>
          No transfers on this property yet. This batch would create the first one.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={diffTable}>
            <thead>
              <tr>
                <th style={thStyle}>Existing transfer</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Agreement price</th>
                <th style={thStyle}>Transfer date</th>
              </tr>
            </thead>
            <tbody>
              {diff.existingTransfers.map((t) => (
                <tr key={t.id}>
                  <td style={{ padding: "8px 12px", fontSize: 13 }}>{t.name}</td>
                  <td style={{ padding: "8px 12px", fontSize: 12, color: "#5b6885" }}>
                    {t.status?.replace(/_/g, " ") ?? "—"}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 13 }}>
                    {t.price != null ? `R ${t.price.toLocaleString("en-ZA")}` : "—"}
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 13 }}>
                    {t.transferDate ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {diff.wouldCreateNewTransfer && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "#fbefd9",
            border: "1px solid #eddfb6",
            borderRadius: 8,
            fontSize: 13,
            color: "#7A5814",
          }}
        >
          <b>Heads up:</b> committing this batch will create a NEW transfer on this
          property. Proposed: <b>{money(diff.proposedTransfer.price)}</b>
          {diff.proposedTransfer.date ? ` on ${diff.proposedTransfer.date}` : ""}
          {diff.proposedTransfer.parties.length > 0
            ? ` — parties: ${diff.proposedTransfer.parties.join(", ")}`
            : ""}
          . If this is the same deal an existing transfer already captures, that would
          duplicate. Reset the property link and pick a different property, or continue
          if it&apos;s a legitimately separate transfer.
        </div>
      )}
    </div>
  );
}

const sectionHeading: React.CSSProperties = {
  fontFamily: "Fraunces, Georgia, serif",
  fontSize: 15,
  color: "#0F2A63",
  margin: "22px 0 10px",
};

const diffTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "#fff",
  border: "1px solid #e2e8f5",
  borderRadius: 8,
  overflow: "hidden",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#6b78a0",
  padding: "10px 12px",
  borderBottom: "1px solid #EDF0F8",
  fontFamily: "'Spline Sans Mono', monospace",
};

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "adds" | "conflict" | "muted";
}) {
  const colours = {
    adds: { bg: "#e2f2e8", fg: "#0E4A2A" },
    conflict: { bg: "#fdecec", fg: "#a12020" },
    muted: { bg: "#fff", fg: "#0F2A63" },
  }[tone];
  return (
    <div
      style={{
        background: colours.bg,
        border: "1px solid #e2e8f5",
        borderRadius: 10,
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          fontFamily: "'Spline Sans Mono', monospace",
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "#6b78a0",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "Fraunces, Georgia, serif",
          fontSize: 22,
          fontWeight: 600,
          color: colours.fg,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function FileList({
  title,
  files,
  tone,
  emptyText,
}: {
  title: string;
  files: { name: string }[];
  tone: "adds" | "muted";
  emptyText?: string;
}) {
  const bg = tone === "adds" ? "#e2f2e8" : "#EDF0F8";
  const fg = tone === "adds" ? "#0E4A2A" : "#5b6885";
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f5", borderRadius: 8, padding: 12 }}>
      <div
        style={{
          fontFamily: "'Spline Sans Mono', monospace",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#6b78a0",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {files.length === 0 ? (
        <p style={{ color: "#8090b5", fontSize: 13, margin: 0 }}>
          {emptyText ?? "—"}
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
          {files.slice(0, 12).map((f) => (
            <li
              key={f.name}
              style={{
                background: bg,
                color: fg,
                padding: "5px 9px",
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "'Spline Sans Mono', monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={f.name}
            >
              {f.name}
            </li>
          ))}
          {files.length > 12 && (
            <li style={{ color: "#8090b5", fontSize: 12 }}>
              …and {files.length - 12} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
