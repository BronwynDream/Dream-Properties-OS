"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Manual admin trigger for the same weekly cron that mirrors Knysna Muni's
// public rateable-property database into muni_property (~21k rows).
// Admin session cookie is the auth; cron uses CRON_SECRET bearer.

type RefreshResponse = {
  ok?: boolean;
  elapsedSec?: number;
  counts?: { finance: number; valroll: number; deeds: number };
  total?: number;
  error?: string;
};

export default function RefreshMuniButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/muni/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const json = (await res.json()) as RefreshResponse;
        if (!res.ok || json.error) {
          setErr(json.error ?? `HTTP ${res.status}`);
          return;
        }
        const c = json.counts ?? { finance: 0, valroll: 0, deeds: 0 };
        setMsg(
          `Muni mirror refreshed in ${json.elapsedSec ?? "?"}s · ${c.finance} finance · ${c.valroll} valuation · ${c.deeds} deeds`,
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
        title="Re-imports every rateable property in Knysna from the muni's public cadastre. Runs automatically weekly; this button forces a run now."
      >
        {pending ? "Refreshing muni (may take ~2 min)…" : "Refresh Muni data"}
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
