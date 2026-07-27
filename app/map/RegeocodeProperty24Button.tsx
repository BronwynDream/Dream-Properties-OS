"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Manual admin trigger to re-geocode every Property24 row via Mapbox.
// Fixes rows whose coords were hallucinated by Firecrawl's LLM extract
// (Simola listings landing near Wilderness, etc.). Idempotent — safe to
// re-run any time. Uses Mapbox forward-geocoding + Knysna centroid
// fallback; wall-time-capped at 240s → ~200 rows per invocation.
// Admin session cookie is the auth; cron uses CRON_SECRET bearer.

type RegeocodeResponse = {
  ok?: boolean;
  scanned?: number;
  totalRows?: number;
  updated?: number;
  centroidFallback?: number;
  noResolution?: number;
  durationMs?: number;
  error?: string;
};

export default function RegeocodeProperty24Button() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/sources/property24/regeocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const json = (await res.json()) as RegeocodeResponse;
        if (!res.ok || json.error) {
          setErr(json.error ?? `HTTP ${res.status}`);
          return;
        }
        const sec = json.durationMs != null ? Math.round(json.durationMs / 1000) : "?";
        const scannedPart =
          json.scanned != null && json.totalRows != null
            ? `${json.scanned} / ${json.totalRows}`
            : `${json.scanned ?? "?"}`;
        const centroidPart =
          json.centroidFallback && json.centroidFallback > 0
            ? ` (${json.centroidFallback} via centroid fallback)`
            : "";
        const noResPart =
          json.noResolution && json.noResolution > 0
            ? ` · ${json.noResolution} unresolved`
            : "";
        setMsg(
          `Re-geocoded ${json.updated ?? 0} of ${scannedPart} in ${sec}s${centroidPart}${noResPart}`,
        );
        router.refresh();
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="ghost-dark"
        onClick={run}
        disabled={pending}
        style={{
          width: "100%",
          padding: "8px 12px",
          fontSize: 12,
          justifyContent: "center",
        }}
        title="Re-geocodes every Property24 row via Mapbox using its address_raw. Fixes rows whose coords were hallucinated by Firecrawl's LLM extract. Idempotent; nulls prcl_key so the auto-snap trigger re-binds each row to its true cadastre polygon."
      >
        {pending ? "Re-geocoding Property24 rows (may take a few minutes)…" : "Re-geocode Property24"}
      </button>

      {msg && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: "var(--estuary)",
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            letterSpacing: "0.02em",
          }}
        >
          {msg}
        </p>
      )}
      {err && (
        <p className="error" style={{ margin: "8px 0 0", fontSize: 12 }}>
          {err}
        </p>
      )}
    </div>
  );
}
