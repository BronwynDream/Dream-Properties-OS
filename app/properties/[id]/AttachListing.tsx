"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchExternalListings, attachExternalListing, type ExternalListingHit } from "./actions";
import { randString } from "@/app/components/format";

// Small search-driven widget for attaching a P24 / Dream-website /
// Private-Property listing to this property record. The primary reason
// an operator uses it: a property has no photos because no external
// listing is matched to it, and they want to fix that.
//
// Search hits are limited to UNMATCHED external listings (rows with
// matched_property_id IS NULL) so an operator isn't picking listings
// already attached elsewhere.
//
// Pattern mirrors MarketListingAttach on /map — same debounced search,
// same result cards, same optimistic router.refresh() after link.

type Props = {
  propertyId: string;
  seedQuery?: string; // e.g. property.primary_address to prefill
};

export default function AttachListing({ propertyId, seedQuery }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ExternalListingHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, startLinking] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (seedQuery && !q) setQ(seedQuery);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, seedQuery, q]);

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
        const hits = await searchExternalListings(q);
        setResults(hits);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, open]);

  function pick(externalId: string, label: string) {
    setMsg(null);
    startLinking(async () => {
      const res = await attachExternalListing(externalId, propertyId);
      if (res.ok) {
        setMsg(`Linked: ${label}. Refreshing…`);
        setOpen(false);
        router.refresh();
      } else {
        setMsg(`Link failed: ${res.error}`);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={openBtn}
        title="Search P24 / Dream website listings and attach one to bring in photos"
      >
        Attach P24 listing
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 20, 40, 0.28)",
        zIndex: 40,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "10vh 16px",
      }}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 640,
          background: "var(--paper-0, #FBF9F4)",
          borderRadius: 8,
          boxShadow: "0 18px 42px rgba(15, 20, 40, 0.22)",
          padding: 18,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <p
            style={{
              margin: 0,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--ink-500, #6B6153)",
            }}
          >
            Attach external listing
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--paper-mute, #6a7692)", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by address, headline, or P24 listing ID"
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "1px solid var(--line-strong, #D8CFBE)",
            borderRadius: 4,
            fontFamily: "inherit",
            fontSize: 14,
            background: "var(--paper-0, #FBF9F4)",
          }}
        />
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
          Only shows listings not yet matched to any property. {searching && "Searching…"}
        </p>

        <div style={{ marginTop: 10, maxHeight: 380, overflowY: "auto" }}>
          {results.length === 0 && q.trim().length >= 2 && !searching && (
            <p style={{ margin: "18px 0", fontSize: 12, color: "var(--paper-mute, #6a7692)", fontStyle: "italic" }}>
              No unmatched listings for &quot;{q}&quot;. If P24 has one, it may already be attached to a different property record — check /map.
            </p>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => pick(r.id, r.headline ?? r.addressRaw ?? r.id.slice(0, 8))}
              disabled={linking}
              style={{
                display: "grid",
                gridTemplateColumns: r.imageUrl ? "60px 1fr auto" : "1fr auto",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                marginTop: 6,
                border: "1px solid var(--line-soft, #E7E0D2)",
                background: "var(--paper-1, #F5F1E8)",
                borderRadius: 4,
                cursor: "pointer",
                alignItems: "center",
              }}
            >
              {r.imageUrl && (
                <img
                  src={r.imageUrl}
                  alt=""
                  style={{ width: 60, height: 44, objectFit: "cover", borderRadius: 3 }}
                />
              )}
              <div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--estuary, #132B84)", fontWeight: 500 }}>
                  {r.headline ?? r.addressRaw ?? "(no headline)"}
                </p>
                <p style={{ margin: "2px 0 0", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "var(--paper-mute, #6a7692)", letterSpacing: "0.02em" }}>
                  {r.source.toUpperCase()}
                  {r.agencyName && ` · ${r.agencyName}`}
                  {r.addressRaw && r.headline && r.addressRaw !== r.headline && ` · ${r.addressRaw}`}
                </p>
              </div>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 12,
                  color: "var(--estuary, #132B84)",
                  fontWeight: 600,
                }}
              >
                {r.price != null ? `R ${randString(r.price)}` : ""}
              </span>
            </button>
          ))}
        </div>

        {msg && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: msg.startsWith("Link failed") ? "var(--critical, #9A3B34)" : "var(--positive, #4B6B4A)" }}>
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}

const openBtn: React.CSSProperties = {
  padding: "6px 12px",
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "var(--estuary, #132B84)",
  background: "var(--paper-0, #FBF9F4)",
  border: "1px solid var(--estuary, #132B84)",
  borderRadius: 3,
  cursor: "pointer",
};
