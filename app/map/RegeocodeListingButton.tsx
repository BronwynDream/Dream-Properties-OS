"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regeocodeExternalListing } from "./actions";

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

  function run() {
    setMsg(null);
    startTransition(async () => {
      const res = await regeocodeExternalListing(externalId);
      if (!res.ok) {
        setMsg(`Failed: ${res.error}`);
        return;
      }
      if (res.source === "unchanged") {
        setMsg("No change — Mapbox returned the same coord. Try editing the address on the source or drag on the map.");
        return;
      }
      setMsg(`Re-geocoded (${res.source}) → ${res.lat?.toFixed(4)}, ${res.lng?.toFixed(4)}. Refreshing…`);
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
      {msg && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: msg.startsWith("Failed") ? "var(--critical, #9A3B34)" : "var(--paper-mute, #6a7692)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
