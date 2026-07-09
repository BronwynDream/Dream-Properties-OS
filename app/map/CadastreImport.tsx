"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Admin-only "Import cadastre" panel. Bronwyn clicks Start; we call
// /api/cadastre/import in a loop, each call doing ~40–50s of CSG paging
// within the Hobby cap and returning a progress snapshot. We keep
// firing the next call until `done: true`, then trigger a router.refresh()
// so the freshly-snapped pins re-render.
//
// The route itself is safe to call any number of times: it reads the
// singleton cursor, advances it, and reports where it stopped.

type ImportResponse = {
  ok?: boolean;
  done?: boolean;
  importedThisRun?: number;
  totalSoFar?: number;
  town?: string | null;
  offset?: number;
  cursor?: {
    town: string | null;
    townIndex: number;
    townTotal: number;
    offset: number;
  };
  discoveredLabels?: string[];
  snapped?: {
    propertiesSnapped: number;
    listingsSnapped: number;
  } | null;
  errors?: string[];
  error?: string;
};

export default function CadastreImport() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [batches, setBatches] = useState(0);
  const [progress, setProgress] = useState<ImportResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelRef.current = true;
    };
  }, []);

  async function runOne(reset: boolean): Promise<ImportResponse> {
    const url = reset ? "/api/cadastre/import?reset=1" : "/api/cadastre/import";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const json = (await res.json()) as ImportResponse;
    if (!res.ok || json.error) {
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
    return json;
  }

  async function start(freshRun: boolean) {
    setErr(null);
    if (freshRun) setProgress(null);
    setBatches(0);
    setRunning(true);
    cancelRef.current = false;

    try {
      for (let i = 0; i < 200; i++) {
        if (cancelRef.current) break;
        // Reset only on the very first call of a fresh run — Resume keeps
        // the existing cursor so mid-town progress isn't thrown away.
        const step = await runOne(freshRun && i === 0);
        setProgress(step);
        setBatches((n) => n + 1);
        if (step.done) {
          router.refresh();
          break;
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function stop() {
    cancelRef.current = true;
  }

  const done = progress?.done === true;
  const totalSoFar = progress?.totalSoFar ?? 0;
  const town = progress?.town ?? progress?.cursor?.town ?? null;
  const townIndex = progress?.cursor?.townIndex ?? 0;
  const townTotal = progress?.cursor?.townTotal ?? 0;
  const snapped = progress?.snapped;

  return (
    <div style={{ marginTop: 12 }}>
      {!running && !progress && (
        <button
          type="button"
          className="ghost-dark"
          onClick={() => start(true)}
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: 12,
            justifyContent: "center",
          }}
        >
          Import cadastre
        </button>
      )}

      {(running || progress) && (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${done ? "rgba(31,122,77,0.35)" : "#d7deef"}`,
            background: done ? "rgba(31,122,77,0.06)" : "#fbfcfe",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 8,
            }}
          >
            <p
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: done ? "#1F7A4D" : "var(--gold)",
                margin: 0,
              }}
            >
              {done ? "Done" : "Importing"}
            </p>
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                color: "#7a86a8",
              }}
            >
              batch {batches}
            </span>
          </div>

          <p
            style={{
              margin: "6px 0 0",
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 15,
              fontWeight: 700,
              color: "var(--estuary)",
              letterSpacing: "-0.01em",
            }}
          >
            {totalSoFar.toLocaleString("en-ZA")}{" "}
            <span style={{ fontSize: 11, color: "#8090b5", fontWeight: 400 }}>
              erven
            </span>
          </p>

          {!done && town && (
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#5b6885" }}>
              {town} ·{" "}
              <span
                className="mono"
                style={{ fontSize: 10, color: "#8090b5" }}
              >
                town {townIndex + 1}/{townTotal} @ offset {progress?.offset ?? 0}
              </span>
            </p>
          )}

          {done && snapped && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 11,
                color: "#1F7A4D",
                fontWeight: 500,
              }}
            >
              Snapped {snapped.propertiesSnapped} propert
              {snapped.propertiesSnapped === 1 ? "y" : "ies"} +{" "}
              {snapped.listingsSnapped} listing
              {snapped.listingsSnapped === 1 ? "" : "s"} to their erven.
            </p>
          )}

          {progress?.discoveredLabels && progress.discoveredLabels.length > 0 && (
            <details style={{ marginTop: 6, fontSize: 11, color: "#8090b5" }}>
              <summary style={{ cursor: "pointer" }}>
                {progress.discoveredLabels.length} town label
                {progress.discoveredLabels.length === 1 ? "" : "s"} discovered
              </summary>
              <ul
                style={{
                  margin: "6px 0 0 14px",
                  padding: 0,
                  lineHeight: 1.4,
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                }}
              >
                {progress.discoveredLabels.map((l, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    {JSON.stringify(l)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {progress?.errors && progress.errors.length > 0 && (
            <details style={{ marginTop: 6, fontSize: 11, color: "#8090b5" }}>
              <summary style={{ cursor: "pointer" }}>
                {progress.errors.length} warning
                {progress.errors.length === 1 ? "" : "s"}
              </summary>
              <ul style={{ margin: "6px 0 0 14px", padding: 0, lineHeight: 1.4 }}>
                {progress.errors.slice(0, 10).map((e, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>
                    {e}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {running && (
              <button
                type="button"
                className="ghost-dark"
                onClick={stop}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  fontSize: 12,
                  justifyContent: "center",
                }}
              >
                Stop
              </button>
            )}
            {!running && !done && (
              <button
                type="button"
                className="ghost-dark"
                onClick={() => start(false)}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  fontSize: 12,
                  justifyContent: "center",
                }}
              >
                Resume
              </button>
            )}
            {done && (
              <button
                type="button"
                className="ghost-dark"
                onClick={() => {
                  setProgress(null);
                  setBatches(0);
                }}
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  fontSize: 12,
                  justifyContent: "center",
                }}
              >
                Dismiss
              </button>
            )}
          </div>

          {err && (
            <p className="error" style={{ margin: "8px 0 0", fontSize: 12 }}>
              {err}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
