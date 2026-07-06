"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchProperties, linkPropertyManually, PropertyHit } from "../actions";

// Search-driven "attach batch to existing property" flow. Renders as a small
// button that expands into an inline search box. Debounced query (~250ms).
// Enter or click on a result → the batch's property target is linked to that
// property (any prior candidates on that target are wiped).
export default function PropertyAttach({
  batchId,
  compact = false,
}: {
  batchId: string;
  compact?: boolean;
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

  // Debounced search
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

  function pick(p: PropertyHit) {
    setMsg(null);
    startLinking(async () => {
      const res = await linkPropertyManually(batchId, p.id, p.address);
      if (res.ok) {
        setMsg(`Linked to ${p.address}. Commit to attach the batch.`);
        setOpen(false);
        setQ("");
        setResults([]);
        router.refresh();
      } else {
        setMsg("Link failed. Try again.");
      }
    });
  }

  return (
    <div style={{ marginTop: compact ? 8 : 14 }}>
      {!open ? (
        <button
          type="button"
          className="ghost-dark"
          style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600 }}
          onClick={() => setOpen(true)}
        >
          Attach to an existing property…
        </button>
      ) : (
        <div
          style={{
            background: "var(--white)",
            border: "1px solid #d7deef",
            borderRadius: 10,
            padding: 12,
            boxShadow: "0 4px 16px rgba(15,42,99,0.06)",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by address, deed, or erf number…"
              disabled={linking}
              style={{
                flex: 1,
                padding: "8px 10px",
                border: "1px solid #d7deef",
                borderRadius: 7,
                fontSize: 14,
                fontFamily: "inherit",
              }}
            />
            <button
              type="button"
              className="ghost-dark"
              style={{ padding: "6px 10px", fontSize: 12 }}
              onClick={() => {
                setOpen(false);
                setQ("");
                setResults([]);
              }}
              disabled={linking}
            >
              Cancel
            </button>
          </div>

          <div style={{ marginTop: 10, minHeight: 20 }}>
            {searching && q.trim().length >= 2 && (
              <p style={{ margin: 0, color: "#5b6885", fontSize: 12 }}>Searching…</p>
            )}
            {!searching && q.trim().length >= 2 && results.length === 0 && (
              <p style={{ margin: 0, color: "#5b6885", fontSize: 12 }}>
                No matches. Try a suburb, deed number, or erf.
              </p>
            )}
            {q.trim().length < 2 && (
              <p style={{ margin: 0, color: "#8090b5", fontSize: 12 }}>
                Type at least 2 characters. The batch will be linked to whichever
                property you pick — its documents attach and its parties become
                seller/buyer records under that property.
              </p>
            )}
            {results.length > 0 && (
              <ul
                style={{
                  margin: "0 0 0 0",
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  maxHeight: 300,
                  overflowY: "auto",
                }}
              >
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => pick(p)}
                      disabled={linking}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: "var(--mist)",
                        border: "1px solid transparent",
                        borderRadius: 7,
                        padding: "8px 10px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget.style.borderColor = "var(--navy)"),
                        (e.currentTarget.style.background = "#fff"))
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget.style.borderColor = "transparent"),
                        (e.currentTarget.style.background = "var(--mist)"))
                      }
                    >
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--estuary)" }}>
                        {p.address}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#6b78a0",
                          fontFamily: "'Spline Sans Mono', monospace",
                          marginTop: 2,
                        }}
                      >
                        {p.suburb ? `${p.suburb} · ` : ""}
                        {p.erven.length > 0 ? `Erf ${p.erven.join(", ")}` : ""}
                        {p.deed ? ` · Deed ${p.deed}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {msg && (
        <p style={{ margin: "8px 0 0", color: "var(--estuary)", fontSize: 13, fontWeight: 600 }}>
          {msg}
        </p>
      )}
    </div>
  );
}
