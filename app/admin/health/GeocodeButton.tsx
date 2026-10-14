"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { geocodeMissingProperties } from "@/app/map/actions";

// Was the "Geocode + snap" bar on the map canvas. Same server action; it
// now lives on the Data Health page with the other admin triggers.

export default function GeocodeButton({ missing }: { missing: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await geocodeMissingProperties();
        if (!res.ok) setMsg(res.error ?? "geocode failed");
        else {
          const snapTotal =
            (res.erfSnapped ?? 0) + (res.propertiesSnapped ?? 0) + (res.listingsSnapped ?? 0);
          const snapPart =
            snapTotal > 0
              ? ` · snapped ${res.erfSnapped ?? 0} by erf + ${res.propertiesSnapped ?? 0} properties + ${res.listingsSnapped ?? 0} externals`
              : "";
          setMsg(`Geocoded ${res.geocoded ?? 0} · ${res.failed ?? 0} failed${snapPart}.`);
        }
        router.refresh();
      } catch (e) {
        setMsg(`Geocode threw: ${(e as Error).message}`);
      }
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="btn-secondary"
        onClick={run}
        disabled={pending}
        style={{ width: "100%", padding: "8px 12px", fontSize: 12, justifyContent: "center" }}
      >
        {pending ? "Working…" : missing > 0 ? "Geocode + snap" : "Snap to cadastre"}
      </button>
      {msg && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: "var(--estuary)",
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.02em",
          }}
        >
          {msg}
        </p>
      )}
    </div>
  );
}
