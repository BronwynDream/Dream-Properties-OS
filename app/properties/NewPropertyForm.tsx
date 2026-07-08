"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProperty } from "./actions";

export type SuburbOption = { id: string; name: string };

export default function NewPropertyForm({
  suburbs,
}: {
  suburbs: SuburbOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [suburbId, setSuburbId] = useState("");
  const [erf, setErf] = useState("");
  const [deed, setDeed] = useState("");

  function reset() {
    setAddress("");
    setSuburbId("");
    setErf("");
    setDeed("");
    setErr(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    startTransition(async () => {
      const res = await createProperty({
        primary_address: address,
        suburb_id: suburbId || null,
        erf_number: erf,
        title_deed_no: deed,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      reset();
      setOpen(false);
      router.push(`/properties/${res.id}`);
    });
  }

  if (!open) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
        <button
          type="button"
          className="cta"
          onClick={() => setOpen(true)}
          style={{ padding: "9px 14px", fontSize: 13 }}
        >
          + New property
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: "var(--white)",
        border: "1px solid #d7deef",
        borderRadius: 12,
        padding: 20,
        boxShadow: "0 4px 20px rgba(15,42,99,0.05)",
        display: "grid",
        gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
        gap: 10,
        alignItems: "end",
        marginBottom: 24,
      }}
    >
      <div style={{ gridColumn: "1 / -1", marginBottom: 4 }}>
        <p
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--gold)",
            margin: 0,
          }}
        >
          New property
        </p>
        <h3
          style={{
            fontFamily: "Inter, -apple-system, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: "var(--estuary)",
            margin: "4px 0 0",
          }}
        >
          Start a fresh record, then drop the folder onto it.
        </h3>
      </div>

      <label style={{ display: "block" }}>
        <span style={fieldLabel}>Address *</span>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. 6 Bowden Park, Leisure Isle, Knysna"
          required
          disabled={pending}
          style={inputStyle}
        />
      </label>

      <label style={{ display: "block" }}>
        <span style={fieldLabel}>Suburb</span>
        <select
          value={suburbId}
          onChange={(e) => setSuburbId(e.target.value)}
          disabled={pending}
          style={inputStyle}
        >
          <option value="">—</option>
          {suburbs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "block" }}>
        <span style={fieldLabel}>Erf</span>
        <input
          type="text"
          value={erf}
          onChange={(e) => setErf(e.target.value)}
          placeholder="1444"
          disabled={pending}
          style={inputStyle}
        />
      </label>

      <label style={{ display: "block" }}>
        <span style={fieldLabel}>Title deed</span>
        <input
          type="text"
          value={deed}
          onChange={(e) => setDeed(e.target.value)}
          placeholder="T16806/2025"
          disabled={pending}
          style={inputStyle}
        />
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="cta"
          disabled={pending}
          style={{ padding: "9px 14px", fontSize: 13, whiteSpace: "nowrap" }}
        >
          {pending ? "Creating…" : "Create + take on"}
        </button>
        <button
          type="button"
          className="ghost-dark"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={pending}
          style={{ padding: "9px 12px", fontSize: 13 }}
        >
          Cancel
        </button>
      </div>

      {err && (
        <p className="error" style={{ gridColumn: "1 / -1", marginTop: 4, marginBottom: 0 }}>
          {err}
        </p>
      )}
    </form>
  );
}

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
