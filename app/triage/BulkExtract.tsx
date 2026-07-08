"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Progress = {
  done: number;
  total: number;
  ok: number;
  failed: number;
  skipped: number;
};

// One-click extract across every batch that's been classified but hasn't had
// its fields proposed yet. Fires /api/extract for each with a small concurrency
// cap so we don't hammer OpenRouter. Batches with no deal documents (no
// agreement / mandate / lightstone etc.) return the "no deal documents" note
// and are counted as skipped — cheap no-op, not an error.
export default function BulkExtract({
  candidateIds,
}: {
  candidateIds: string[];
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>({
    done: 0,
    total: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [firstError, setFirstError] = useState<string | null>(null);

  if (candidateIds.length === 0) return null;

  async function runOne(batchId: string): Promise<
    | { kind: "ok"; rows: number }
    | { kind: "skipped"; note: string }
    | { kind: "failed"; error: string }
  > {
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      const json = await res.json();
      if (json.ok) return { kind: "ok", rows: json.rowsInserted ?? 0 };
      if (json.note) return { kind: "skipped", note: json.note };
      return { kind: "failed", error: json.error ?? "unknown extract error" };
    } catch (e) {
      return { kind: "failed", error: (e as Error).message };
    }
  }

  async function run() {
    const count = candidateIds.length;
    const roughRands = (count * 0.5).toFixed(2);
    if (
      !confirm(
        `Extract fields on ${count} batch${count === 1 ? "" : "es"}? Rough LLM cost ≈ R${roughRands} (about R0.50 each on average). Batches without deal documents cost nothing.`,
      )
    ) {
      return;
    }

    setRunning(true);
    setMsg(null);
    setFirstError(null);

    const state = { done: 0, ok: 0, failed: 0, skipped: 0 };
    setProgress({ done: 0, total: count, ok: 0, failed: 0, skipped: 0 });

    const queue = [...candidateIds];
    const CONCURRENCY = 3;

    async function worker() {
      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) return;
        const res = await runOne(id);
        state.done++;
        if (res.kind === "ok") state.ok++;
        else if (res.kind === "skipped") state.skipped++;
        else {
          state.failed++;
          if (!firstError) setFirstError(res.error);
        }
        setProgress({ total: count, ...state });
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    setRunning(false);
    setMsg(
      `Done. ${state.ok} extracted · ${state.skipped} skipped (no deal docs) · ${state.failed} failed.`,
    );
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <button
        className="cta"
        onClick={run}
        disabled={running}
        style={{ padding: "9px 14px", fontSize: 13 }}
      >
        {running
          ? `Extracting ${progress.done} of ${progress.total}…`
          : `Extract fields on ${candidateIds.length} batch${candidateIds.length === 1 ? "" : "es"}`}
      </button>
      {running && (
        <div
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 11,
            color: "#6b78a0",
          }}
        >
          {progress.ok} ok · {progress.skipped} skipped · {progress.failed} failed
        </div>
      )}
      {msg && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--estuary)",
            maxWidth: 480,
            textAlign: "right",
          }}
        >
          {msg}
          {firstError && (
            <div
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 10.5,
                color: "#a12020",
                fontWeight: 400,
                marginTop: 4,
              }}
            >
              first error: {firstError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
