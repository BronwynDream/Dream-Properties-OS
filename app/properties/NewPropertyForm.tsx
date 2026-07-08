"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProperty } from "./actions";

export type SuburbOption = { id: string; name: string };

type Candidate = {
  propertyId: number;
  addressString: string;
  streetNumber?: string;
  streetName?: string;
  suburb?: string;
  town?: string;
  province?: string;
  postCode?: string;
  estateName?: string;
  relevanceScore?: number;
};

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

  // Lightstone search state
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [source, setSource] = useState<"stub" | "live" | null>(null);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [pickedSuburbName, setPickedSuburbName] = useState<string | null>(null);

  function reset() {
    setAddress("");
    setSuburbId("");
    setErf("");
    setDeed("");
    setErr(null);
    setQuery("");
    setCandidates(null);
    setSearchErr(null);
    setSource(null);
    setPickedId(null);
    setPickedSuburbName(null);
  }

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setSearchErr(null);
    const q = query.trim();
    if (q.length < 3) {
      setSearchErr("Type at least 3 characters.");
      return;
    }
    setSearching(true);
    setCandidates(null);
    try {
      const res = await fetch("/api/lightstone/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setSearchErr(json.error ?? "search failed");
        setSearching(false);
        return;
      }
      setSource(json.source ?? null);
      setCandidates(json.candidates ?? []);
    } catch (e2) {
      setSearchErr((e2 as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function pick(c: Candidate) {
    // Strip a "[SAMPLE] " prefix from stub responses so the address field
    // contains something we're happy to persist.
    const cleaned = c.addressString.replace(/^\[SAMPLE\]\s*/, "").trim();
    setAddress(cleaned || c.addressString);

    if (c.suburb) {
      const match = suburbs.find(
        (s) => s.name.trim().toLowerCase() === c.suburb!.trim().toLowerCase(),
      );
      if (match) setSuburbId(match.id);
      setPickedSuburbName(c.suburb);
    } else {
      setPickedSuburbName(null);
    }

    setPickedId(c.propertyId);
  }

  function clearPick() {
    setPickedId(null);
    setPickedSuburbName(null);
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
        lightstone_property_id: pickedId,
        suburb_name: pickedSuburbName,
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
    <div
      style={{
        background: "var(--white)",
        border: "1px solid #d7deef",
        borderRadius: 12,
        padding: 20,
        boxShadow: "0 4px 20px rgba(15,42,99,0.05)",
        marginBottom: 24,
      }}
    >
      <div style={{ marginBottom: 14 }}>
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

      {/* Lightstone address search */}
      <div
        style={{
          background: "#fbfcfe",
          border: "1px solid #eef1f8",
          borderRadius: 10,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <p
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#7a86a8",
              margin: 0,
            }}
          >
            Lightstone lookup
          </p>
          <span style={{ fontSize: 12, color: "#5b6885" }}>
            optional — pick a match to capture the property id + pre-fill address
          </span>
        </div>

        <form onSubmit={runSearch} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 6 Bowden Park Leisure Isle"
            disabled={searching || pending}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="submit"
            className="ghost-dark"
            disabled={searching || pending || query.trim().length < 3}
            style={{ padding: "8px 14px", fontSize: 13, whiteSpace: "nowrap" }}
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {searchErr && (
          <p className="error" style={{ margin: "8px 0 0" }}>
            {searchErr}
          </p>
        )}

        {candidates && candidates.length === 0 && (
          <p style={{ margin: "8px 0 0", color: "#5b6885", fontSize: 13 }}>
            No matches. Fill the fields below manually.
          </p>
        )}

        {candidates && candidates.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              margin: "10px 0 0",
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {candidates.map((c) => {
              const isPicked = pickedId === c.propertyId;
              return (
                <li key={c.propertyId}>
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid",
                      borderColor: isPicked ? "var(--navy)" : "#d7deef",
                      background: isPicked ? "rgba(19,43,132,0.04)" : "#fff",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "Inter, -apple-system, sans-serif",
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--estuary)",
                        letterSpacing: "-0.015em",
                      }}
                    >
                      {c.addressString}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        marginTop: 3,
                        fontSize: 12,
                        color: "#5b6885",
                      }}
                    >
                      {(c.suburb || c.town) && (
                        <span>
                          {[c.suburb, c.town].filter(Boolean).join(", ")}
                        </span>
                      )}
                      {c.estateName && <span>· {c.estateName}</span>}
                      <span
                        className="mono"
                        style={{ marginLeft: "auto", color: "#7a86a8" }}
                      >
                        LS #{c.propertyId}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {source === "stub" && candidates && candidates.length > 0 && (
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 11,
              color: "#7A5814",
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Sample data — Lightstone not yet connected
          </p>
        )}
      </div>

      <form
        onSubmit={submit}
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
          gap: 10,
          alignItems: "end",
        }}
      >
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

        {pickedId != null && (
          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--estuary)",
              marginTop: 4,
            }}
          >
            <span
              className="mono"
              style={{
                padding: "3px 8px",
                borderRadius: 999,
                background: "rgba(19,43,132,0.06)",
                border: "1px solid rgba(19,43,132,0.15)",
              }}
            >
              Lightstone #{pickedId}
            </span>
            <span style={{ color: "#5b6885" }}>
              will be stored on this property
            </span>
            <button
              type="button"
              onClick={clearPick}
              disabled={pending}
              style={{
                background: "none",
                border: "none",
                color: "#7a86a8",
                fontSize: 12,
                cursor: "pointer",
                padding: 0,
                marginLeft: 4,
              }}
            >
              clear
            </button>
          </div>
        )}

        {err && (
          <p className="error" style={{ gridColumn: "1 / -1", marginTop: 4, marginBottom: 0 }}>
            {err}
          </p>
        )}
      </form>
    </div>
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
