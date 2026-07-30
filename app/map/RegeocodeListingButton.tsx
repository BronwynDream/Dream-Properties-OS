"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regeocodeExternalListing, setExternalListingCoords } from "./actions";

// Admin action: re-run the Mapbox geocode on a single external listing
// when its pin is visibly in the wrong place. Same rules the batched
// regeocode endpoint uses — bias to Knysna, verify result is in the
// Garden Route bbox, fall back to suburb centroid.
//
// Fires against the FIRST external in the pin's group. Dedup groups
// share a physical address so re-geocoding one is enough; the pin's
// display coord comes from the primary external.

export default function RegeocodeListingButton({ externalId }: { externalId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [coordInput, setCoordInput] = useState("");

  function run() {
    setMsg(null);
    startTransition(async () => {
      const res = await regeocodeExternalListing(externalId);
      if (!res.ok) {
        setMsg(`Failed: ${res.error}`);
        return;
      }
      if (res.source === "unchanged") {
        setMsg("No change — Mapbox returned the same coord. Enter correct coords manually below.");
        setManualOpen(true);
        return;
      }
      setMsg(`Re-geocoded (${res.source}) → ${res.lat?.toFixed(4)}, ${res.lng?.toFixed(4)}. Refreshing…`);
      router.refresh();
    });
  }

  function saveManual() {
    setMsg(null);
    // Accept "lat, lng" (Google Maps right-click format) or "lng, lat".
    // Google copies lat first — assume that. Detect by sign: SA lat is
    // negative, lng is positive, so the negative one is lat.
    const parts = coordInput.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).map(Number);
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
      setMsg("Enter as \"lat, lng\" — e.g. -34.0363, 23.0479");
      return;
    }
    const [a, b] = parts;
    const lat = a < 0 ? a : b;
    const lng = a < 0 ? b : a;
    startTransition(async () => {
      const res = await setExternalListingCoords(externalId, lng, lat);
      if (!res.ok) {
        setMsg(`Failed: ${res.error}`);
        return;
      }
      setMsg(`Pin moved to ${lat.toFixed(4)}, ${lng.toFixed(4)}. Refreshing…`);
      setManualOpen(false);
      setCoordInput("");
      router.refresh();
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="ghost-dark"
        style={{ width: "100%", padding: "8px 12px", fontSize: 12 }}
        title="Re-run Mapbox geocode on this listing's address (biased to Knysna)"
      >
        {pending ? "Re-geocoding…" : "Re-geocode this pin"}
      </button>

      {manualOpen ? (
        <div style={{ marginTop: 8, padding: 8, background: "#F5F1E8", border: "1px solid #E7E0D2", borderRadius: 4 }}>
          <p style={{ margin: 0, fontSize: 11, color: "#6B6153" }}>
            Right-click on Google Maps at the correct spot → copy the coords → paste here.
          </p>
          <input
            type="text"
            value={coordInput}
            onChange={(e) => setCoordInput(e.target.value)}
            placeholder="-34.0363, 23.0479"
            style={{
              width: "100%",
              marginTop: 6,
              padding: "6px 8px",
              fontSize: 12,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              border: "1px solid #D8CFBE",
              borderRadius: 3,
            }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button type="button" onClick={saveManual} disabled={pending || !coordInput.trim()} className="cta" style={{ padding: "6px 10px", fontSize: 11 }}>
              {pending ? "Saving…" : "Move pin"}
            </button>
            <button type="button" onClick={() => { setManualOpen(false); setMsg(null); }} className="ghost-dark" style={{ padding: "6px 10px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="ghost-dark"
          style={{ width: "100%", padding: "6px 12px", fontSize: 11, marginTop: 6 }}
          title="Paste correct coords from Google Maps"
        >
          Or enter coords manually…
        </button>
      )}

      {msg && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: msg.startsWith("Failed") ? "var(--critical, #9A3B34)" : "var(--paper-mute, #6a7692)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
