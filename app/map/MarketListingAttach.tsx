"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchProperties, type PropertyHit } from "@/app/triage/actions";
import { linkExternalListingsToProperty, createPropertyFromExternalListings } from "./actions";

// Small search-driven attach flow shown on the map's market-listing panel
// when the pin isn't yet linked to an OS property. Mirrors PropertyAttach
// on the triage batch page — same debounced search, same result list, but
// wires into external_listing.matched_property_id instead of match_candidate.
export default function MarketListingAttach({
  externalIds,
}: {
  externalIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PropertyHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, startLinking] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await searchProperties(q);
        setResults(hits);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, open]);

  function pick(propertyId: string) {
    startLinking(async () => {
      const res = await linkExternalListingsToProperty(externalIds, propertyId);
      if (res.ok) {
        setMsg(`Linked (${res.linked}). Reloading…`);
        setOpen(false);
        router.refresh();
      } else {
        setMsg(`Link failed: ${res.error}`);
      }
    });
  }

  // Create a fresh OS property from the external listing(s) and navigate
  // straight into the new record. Used when no existing property is the
  // right match — e.g. Bronwyn's Dream-website listing exists but nothing
  // in OS represents it yet.
  function createFresh() {
    setMsg(null);
    startLinking(async () => {
      const res = await createPropertyFromExternalListings(externalIds);
      if (res.ok && res.propertyId) {
        router.push(`/properties/${res.propertyId}`);
      } else {
        setMsg(`Create failed: ${res.error ?? "unknown"}`);
      }
    });
  }

  if (!open) {
    return (
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="ghost-dark"
          onClick={() => setOpen(true)}
          style={{ width: "100%", padding: "10px 14px", fontSize: 13 }}
        >
          Link to an OS property…
        </button>
        {msg && (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--estuary)" }}>{msg}</p>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search address, erf, or deed no…"
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: 13,
          borderRadius: 8,
          border: "1px solid #e2e8f5",
        }}
      />
      {searching && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "#7a86a8" }}>Searching…</p>
      )}
      {!searching && results.length === 0 && q.trim().length >= 2 && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "#7a86a8" }}>No matches.</p>
      )}
      {results.length > 0 && (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, maxHeight: 200, overflowY: "auto" }}>
          {results.map((r) => (
            <li
              key={r.id}
              onClick={() => !linking && pick(r.id)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                cursor: linking ? "wait" : "pointer",
                background: "#fbfcfe",
                marginTop: 4,
                border: "1px solid #e2e8f5",
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--estuary)" }}>{r.address}</div>
              <div style={{ color: "#7a86a8", fontSize: 11, marginTop: 2 }}>
                {[r.suburb, r.deed, r.erven.length > 0 ? `Erf ${r.erven.join(", ")}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="cta"
          onClick={createFresh}
          disabled={linking}
          title="Create a fresh OS property record from this market listing and navigate to it"
          style={{ padding: "8px 12px", fontSize: 12 }}
        >
          {linking ? "Creating…" : "+ Create new OS property"}
        </button>
        <button
          type="button"
          className="ghost-dark"
          onClick={() => {
            setOpen(false);
            setQ("");
            setResults([]);
          }}
          disabled={linking}
          style={{ padding: "8px 12px", fontSize: 12 }}
        >
          Cancel
        </button>
      </div>
      {msg && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--estuary)" }}>{msg}</p>
      )}
    </div>
  );
}
