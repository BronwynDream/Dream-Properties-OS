"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Manual admin trigger for the same nightly scraper the Vercel Cron hits.
// No body needed — the route accepts an admin session as auth, so the browser
// cookie proves it's Bronwyn / Camilla clicking. Response summary comes back
// as { ok, upserted, delisted, geocoded, matched, groups, errors }.

type RefreshResponse = {
  ok?: boolean;
  upserted?: number;
  delisted?: number;
  geocoded?: number;
  parked?: number;
  deferredGeocode?: number;
  matched?: number;
  groups?: number;
  errors?: string[];
  error?: string;
};

export default function RefreshDreamButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errList, setErrList] = useState<string[] | null>(null);

  function run() {
    setMsg(null);
    setErr(null);
    setErrList(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/sources/dream/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const json = (await res.json()) as RefreshResponse;
        if (!res.ok || json.error) {
          setErr(json.error ?? `HTTP ${res.status}`);
          return;
        }
        const parts = [
          `${json.upserted ?? 0} listing${(json.upserted ?? 0) === 1 ? "" : "s"}`,
          `${json.geocoded ?? 0} geocoded`,
        ];
        if ((json.parked ?? 0) > 0) parts.push(`${json.parked} parked out-of-area`);
        if ((json.deferredGeocode ?? 0) > 0) parts.push(`${json.deferredGeocode} deferred`);
        if ((json.delisted ?? 0) > 0) parts.push(`${json.delisted} delisted`);
        if ((json.matched ?? 0) > 0) parts.push(`${json.matched} matched`);
        setMsg(`Dream: ${parts.join(" · ")}`);
        if (json.errors && json.errors.length > 0) {
          setErrList(json.errors.slice(0, 5));
        }
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
      >
        {pending ? "Refreshing Dream…" : "Refresh Dream listings"}
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
      {errList && errList.length > 0 && (
        <details
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "#8090b5",
          }}
        >
          <summary style={{ cursor: "pointer" }}>
            {errList.length} scraper warning{errList.length === 1 ? "" : "s"}
          </summary>
          <ul style={{ margin: "6px 0 0 14px", padding: 0, lineHeight: 1.4 }}>
            {errList.map((e, i) => (
              <li key={i} style={{ marginBottom: 3 }}>
                {e}
              </li>
            ))}
          </ul>
        </details>
      )}
      {err && (
        <p
          className="error"
          style={{ margin: "8px 0 0", fontSize: 12 }}
        >
          {err}
        </p>
      )}
    </div>
  );
}
