"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Client-side controls on the detail page.
//   - "Parse" (uploaded → parsed): reads the PDF from Storage, extracts
//     rows via the appropriate adapter, populates preview_json.
//   - "Apply" (parsed → applied): re-parses + upserts into muni_property
//     and muni_valuation. Idempotent per lib/valuation-rolls/apply.ts.
//
// Both endpoints can take up to 300s on a Full GV (~7s parse × 2 + 22k
// row upserts × batch overhead). Client-side we show a spinner + a note.
// Hobby-plan users would time out — flagged in the UI.

export default function RollActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function call(endpoint: "parse" | "apply") {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/valuation-rolls/${id}/${endpoint}`, { method: "POST" });
        const json = await res.json();
        if (!res.ok || json.error) {
          setErr(json.error ?? `HTTP ${res.status}`);
          return;
        }
        setMsg(summarise(endpoint, json));
        router.refresh();
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }

  const canParse = ["uploaded", "parsed", "failed"].includes(status);
  const canApply = status === "parsed";

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => call("parse")}
        disabled={pending || !canParse}
        style={btnStyle(canParse && !pending, "outline")}
        title="Extract rows from the PDF and populate preview_json"
      >
        {pending ? "Working…" : status === "parsed" ? "Re-parse" : "Parse"}
      </button>
      <button
        type="button"
        onClick={() => call("apply")}
        disabled={pending || !canApply}
        style={btnStyle(canApply && !pending, "solid")}
        title="Upsert rows into muni_property + muni_valuation"
      >
        {pending ? "Applying…" : "Apply to database"}
      </button>
      {pending && (
        <span
          style={{
            fontSize: 11,
            color: "var(--paper-mute, #6a7692)",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            letterSpacing: "0.04em",
          }}
        >
          Full GV can take 60-120s. Vercel Hobby caps at 60s — if it times out, apply from a Vercel Pro deploy or run the script locally.
        </span>
      )}
      {msg && (
        <span
          style={{
            fontSize: 12,
            color: "var(--green, #1F7A4D)",
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          }}
        >
          {msg}
        </span>
      )}
      {err && (
        <span
          style={{
            fontSize: 12,
            color: "var(--amber, #D17E22)",
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          }}
        >
          {err}
        </span>
      )}
    </div>
  );
}

function btnStyle(active: boolean, variant: "solid" | "outline"): React.CSSProperties {
  const solidActive = variant === "solid" && active;
  return {
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    padding: "8px 16px",
    borderRadius: 3,
    border: "1px solid var(--estuary, #132B84)",
    background: solidActive ? "var(--estuary, #132B84)" : "transparent",
    color: solidActive ? "#fff" : active ? "var(--estuary, #132B84)" : "var(--paper-mute, #6a7692)",
    cursor: active ? "pointer" : "not-allowed",
    opacity: active ? 1 : 0.6,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function summarise(endpoint: "parse" | "apply", j: any): string {
  if (endpoint === "parse") {
    return `Parsed ${j.rows?.toLocaleString() ?? "?"} rows across ${j.pages ?? "?"} pages · ${j.warnings ?? 0} warnings.`;
  }
  return `Applied. Properties upserted: ${j.properties_upserted ?? 0} · valuations inserted: ${j.valuations_inserted ?? 0} · ArcGIS purged: ${j.arcgis_valuations_purged ?? 0} · markers: ${j.markers_stored ?? 0}${j.errors?.length ? ` · errors: ${j.errors.length}` : ""}.`;
}
