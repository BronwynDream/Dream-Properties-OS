"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Kind = "full_gv" | "supplement";

export default function UploadForm() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("supplement");
  const [supplementNumber, setSupplementNumber] = useState<string>("");
  const [effStart, setEffStart] = useState("");
  const [effEnd, setEffEnd] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    if (!file) {
      setErr("Choose a PDF first.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    if (kind === "supplement") fd.append("supplement_number", supplementNumber);
    if (effStart) fd.append("effective_period_start", effStart);
    if (effEnd) fd.append("effective_period_end", effEnd);
    if (notes) fd.append("notes", notes);

    startTransition(async () => {
      try {
        const res = await fetch("/api/valuation-rolls/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok || json.error) {
          setErr(json.error ?? `HTTP ${res.status}`);
          return;
        }
        setMsg("Uploaded. Redirecting to detail page…");
        router.push(`/admin/valuation-rolls/${json.id}`);
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 10,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "var(--paper-mute, #6a7692)",
  };
  const inputStyle: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 13,
    padding: "8px 10px",
    borderRadius: 3,
    border: "1px solid var(--hairline, #e2e8f5)",
    background: pending ? "var(--paper-bg, #f5f1e8)" : "#fff",
  };

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={labelStyle}>Kind</span>
        {(["full_gv", "supplement"] as Kind[]).map((k) => (
          <label
            key={k}
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 12,
              letterSpacing: "0.06em",
              color: kind === k ? "var(--estuary, #132B84)" : "var(--paper-mute, #6a7692)",
              fontWeight: kind === k ? 600 : 400,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <input
              type="radio"
              name="kind"
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
              disabled={pending}
            />
            {k === "full_gv" ? "Full General Valuation" : "Supplementary"}
          </label>
        ))}
      </div>

      {kind === "supplement" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>Supplement number</label>
          <input
            type="number"
            min={1}
            required
            value={supplementNumber}
            onChange={(e) => setSupplementNumber(e.target.value)}
            style={{ ...inputStyle, maxWidth: 120 }}
            placeholder="e.g. 4"
            disabled={pending}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
          <label style={labelStyle}>Effective period (start)</label>
          <input
            type="date"
            value={effStart}
            onChange={(e) => setEffStart(e.target.value)}
            style={inputStyle}
            disabled={pending}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
          <label style={labelStyle}>Effective period (end)</label>
          <input
            type="date"
            value={effEnd}
            onChange={(e) => setEffEnd(e.target.value)}
            style={inputStyle}
            disabled={pending}
          />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={labelStyle}>PDF file (max 20 MB)</label>
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={pending}
          style={{ fontSize: 13, padding: "6px 0" }}
          required
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={labelStyle}>Notes (optional)</label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={inputStyle}
          placeholder="Anything worth remembering about this upload"
          disabled={pending}
        />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
        <button
          type="submit"
          disabled={pending || !file}
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "10px 20px",
            borderRadius: 3,
            border: "1px solid var(--estuary, #132B84)",
            background: pending || !file ? "var(--paper-bg, #f5f1e8)" : "var(--estuary, #132B84)",
            color: pending || !file ? "var(--paper-mute, #6a7692)" : "#fff",
            cursor: pending ? "wait" : !file ? "not-allowed" : "pointer",
          }}
        >
          {pending ? "Uploading…" : "Upload"}
        </button>
        {msg && <span style={{ fontSize: 12, color: "var(--green, #1F7A4D)", fontWeight: 600 }}>{msg}</span>}
        {err && <span style={{ fontSize: 12, color: "var(--amber, #D17E22)", fontWeight: 600 }}>{err}</span>}
      </div>
    </form>
  );
}
