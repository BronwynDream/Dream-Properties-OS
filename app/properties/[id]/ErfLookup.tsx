"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { attachErfToProperty } from "./actions";

type Candidate = {
  sgNumber: string;
  erfNumber: string;
  streetNo: string | null;
  streetName: string;
  suburb: string | null;
  suburbHint: string | null;
  muniValuation: number | null;
  extentSqm: number | null;
  zoning: string | null;
  titleDeedNo: string | null;
};

function formatRands(n: number | null): string {
  if (n == null) return "—";
  return `R ${n.toLocaleString("en-ZA")}`;
}

type LookupResponse = {
  ok: boolean;
  candidates?: Candidate[];
  parsed?: { streetNo: string | null; streetName: string };
  error?: string;
};

// The muni packs suburb into the street field for some entries
// ("EAGLESWAY BELVIDERE HEIG"). Split off the trailing capitalised tokens
// that don't look like part of the street name so the reviewer can see
// "Belvidere Heig" vs blank (implicitly The Heads / other primary suburb).
function extractSuburbHint(streetName: string, queriedStreet: string): string | null {
  const s = streetName.trim();
  const q = queriedStreet.trim().toUpperCase().replace(/\s+/g, "");
  const stripped = s.toUpperCase().replace(/\s+/g, "");
  if (!stripped.startsWith(q)) return null;
  // Take whatever's left after the street name — commonly the suburb.
  const rest = s.substring(
    s.toUpperCase().indexOf(q) + q.length,
  ).trim();
  return rest.length > 0 ? rest : null;
}

// Search the Knysna Municipality valuation roll (the same source Bronwyn
// looks up manually) for a property's ERF. Pre-fills with the property's
// current address; agent can edit + search; results show as a picker; pick
// one → attach → the snap trigger repositions the pin to the cadastre
// centroid.
export default function ErfLookup({
  propertyId,
  propertyAddress,
}: {
  propertyId: string;
  propertyAddress: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(propertyAddress);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [parsed, setParsed] = useState<{ streetNo: string | null; streetName: string } | null>(null);
  const [manualErf, setManualErf] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery(propertyAddress);
      setCandidates(null);
      setMsg(null);
      setTimeout(() => inputRef.current?.focus(), 50);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };
      window.addEventListener("keydown", onKey);
      return () => {
        document.body.style.overflow = prevOverflow;
        window.removeEventListener("keydown", onKey);
      };
    }
  }, [open, propertyAddress]);

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    setMsg(null);
    setCandidates(null);
    setParsed(null);
    try {
      const res = await fetch(
        `/api/erf-lookup?address=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as LookupResponse;
      if (json.ok) {
        setCandidates(json.candidates ?? []);
        setParsed(json.parsed ?? null);
        if ((json.candidates ?? []).length === 0) {
          setMsg(
            "No matches in the Knysna Muni valuation roll — property may be a sectional scheme, newly subdivided, or filed under a slightly different street name. Enter the ERF manually below if you know it.",
          );
        }
      } else {
        setMsg(json.error ?? "Lookup failed");
      }
    } catch (e) {
      setMsg(`Lookup failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function attachErf(erf: string, sg?: string | null) {
    setBusy(true);
    setMsg(`Attaching ERF ${erf}…`);
    const res = await attachErfToProperty(propertyId, erf, sg ?? null);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setMsg(`Attach failed: ${res.error}`);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ghost-dark"
        onClick={() => setOpen(true)}
        style={{ padding: "6px 12px", fontSize: 12 }}
      >
        Find ERF from Muni
      </button>

      {open && (
        <div
          className="erf-lookup-backdrop"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Find ERF via Knysna Muni valuation roll"
        >
          <div
            className="erf-lookup-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(90vw, 640px)", maxHeight: "80vh" }}
          >
            <div className="erf-lookup-header">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>Cadastre lookup</p>
                <h2 style={{ margin: "4px 0 0", fontSize: 18 }}>
                  Knysna Muni valuation roll
                </h2>
              </div>
              <button
                type="button"
                className="ghost-dark"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{ padding: "6px 10px" }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: 20 }}>
              <label
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#6b78a0",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Address to search
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                  placeholder="12 Eagles Way"
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    fontSize: 14,
                    borderRadius: 8,
                    border: "1px solid #e2e8f5",
                  }}
                />
                <button
                  type="button"
                  className="cta"
                  onClick={search}
                  disabled={busy || !query.trim()}
                  style={{ padding: "10px 16px", fontSize: 13 }}
                >
                  {busy ? "Searching…" : "Search"}
                </button>
              </div>
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 11,
                  color: "#7a86a8",
                  lineHeight: 1.4,
                }}
              >
                Queries the muni&rsquo;s live rateable-property database
                (the same source the printed valuation roll comes from). We
                don&rsquo;t fetch owner names or ID numbers — those stay
                outside our POPIA scope.
              </p>

              {msg && (
                <p style={{ marginTop: 12, fontSize: 13, color: "#a12020" }}>
                  {msg}
                </p>
              )}

              {candidates && candidates.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p
                    style={{
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      fontSize: 10,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "#6b78a0",
                      margin: "0 0 8px",
                    }}
                  >
                    {candidates.length} match{candidates.length === 1 ? "" : "es"} — pick one
                    {parsed?.streetNo && ` · looking for #${parsed.streetNo}`}
                  </p>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 400, overflowY: "auto" }}>
                    {candidates.map((c) => {
                      const isNumberMatch =
                        parsed?.streetNo && c.streetNo === parsed.streetNo;
                      const suburbLabel = c.suburb ?? c.suburbHint;
                      return (
                        <li
                          key={c.sgNumber}
                          onClick={() => !busy && attachErf(c.erfNumber, c.sgNumber)}
                          style={{
                            padding: "12px 14px",
                            borderRadius: 8,
                            border: `1px solid ${isNumberMatch ? "var(--gold)" : "#e2e8f5"}`,
                            marginBottom: 6,
                            cursor: busy ? "wait" : "pointer",
                            background: isNumberMatch ? "#fff8e6" : "#fbfcfe",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--estuary)" }}>
                              {c.streetNo ? `#${c.streetNo} · ` : "no number · "}
                              {c.streetName.replace(/\s+/g, " ")}
                              {suburbLabel && (
                                <span style={{ color: "#7a86a8", fontWeight: 400, marginLeft: 6 }}>
                                  · {suburbLabel.toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
                                </span>
                              )}
                            </span>
                            <span
                              style={{
                                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                                fontSize: 13,
                                fontWeight: 600,
                                color: "var(--navy)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              ERF {c.erfNumber}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 12, color: "#5b6885" }}>
                            {c.muniValuation != null && (
                              <span><b>{formatRands(c.muniValuation)}</b> · muni value</span>
                            )}
                            {c.extentSqm != null && (
                              <span>{c.extentSqm.toLocaleString("en-ZA")} m²</span>
                            )}
                            {c.zoning && <span>{c.zoning}</span>}
                          </div>
                          {c.titleDeedNo && (
                            <div style={{ fontSize: 11, color: "#7a86a8", marginTop: 3 }}>
                              Deed: {c.titleDeedNo}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: "#a4adc4", marginTop: 3, fontFamily: "monospace" }}>
                            SG: {c.sgNumber}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Manual entry fallback — for properties where the muni
                  doesn't have a matching record, or when the reviewer
                  already knows the ERF from a deed/mandate. */}
              <div
                style={{
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: "1px solid var(--mist)",
                }}
              >
                <label
                  style={{
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "#6b78a0",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Or enter ERF number manually
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={manualErf}
                    onChange={(e) => setManualErf(e.target.value)}
                    placeholder="e.g. 4497"
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      fontSize: 14,
                      borderRadius: 8,
                      border: "1px solid #e2e8f5",
                    }}
                  />
                  <button
                    type="button"
                    className="ghost-dark"
                    onClick={() => manualErf.trim() && attachErf(manualErf.trim())}
                    disabled={busy || !manualErf.trim()}
                    style={{ padding: "10px 16px", fontSize: 13 }}
                  >
                    Attach ERF
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

