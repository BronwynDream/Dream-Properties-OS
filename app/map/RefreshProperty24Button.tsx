"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Manual admin trigger for the Property24 Knysna scraper (Firecrawl).
// Runs automatically every Monday at 07:00 SAST (05:00 UTC); this button
// forces a run now. Costs Firecrawl credits — use sparingly.
// Admin session cookie is the auth; cron uses CRON_SECRET bearer.

type RefreshResponse = {
  ok?: boolean;
  discoveredThisRun?: number;
  processedThisRun?: number;
  upserted?: number;
  failed?: number;
  remaining?: number;
  budgetExhausted?: boolean;
  durationMs?: number;
  note?: string;
  error?: string;
};

export default function RefreshProperty24Button() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/sources/property24/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const json = (await res.json()) as RefreshResponse;
        if (!res.ok || json.error) {
          setErr(json.error ?? `HTTP ${res.status}`);
          return;
        }
        const sec = json.durationMs != null ? Math.round(json.durationMs / 1000) : "?";
        const discoverPart =
          json.discoveredThisRun && json.discoveredThisRun > 0
            ? `Discovered ${json.discoveredThisRun} URLs · `
            : "";
        const remainingPart =
          json.remaining && json.remaining > 0
            ? ` · ${json.remaining} left — click again to continue`
            : "";
        setMsg(
          `${discoverPart}Refreshed in ${sec}s · ${json.upserted ?? 0} upserted · ${json.failed ?? 0} failed${remainingPart}`,
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
        title="Scrapes Property24's Knysna listings via Firecrawl and upserts them into external_listing. Runs automatically weekly; this button forces a run now. Uses Firecrawl credits."
      >
        {pending
          ? "Refreshing Property24 (may take several minutes)…"
          : "Refresh Property24 data"}
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
