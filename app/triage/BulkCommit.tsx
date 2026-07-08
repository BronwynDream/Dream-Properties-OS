"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { commitBatchById } from "./actions";

type Progress = { done: number; total: number; ok: number; failed: number };

export type BulkCommitCandidate = {
  id: string;
  label: string;
};

// One-click commit across every batch that's already "one-click safe":
//   * tier=green (the system's own confidence signal)
//   * no undecided match candidates (every target auto-decided to link or create)
//   * has extraction rows
//   * not already committed
//
// Sequential (NOT parallel): two commits touching the same property would race
// on the on-commit document dedup pre-fetch, potentially creating dupes we
// just shipped code to prevent. One at a time is slower but correct.
export default function BulkCommit({
  candidates,
}: {
  candidates: BulkCommitCandidate[];
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress>({
    done: 0,
    total: 0,
    ok: 0,
    failed: 0,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<
    { label: string; error: string }[]
  >([]);

  if (candidates.length === 0) return null;

  async function run() {
    const count = candidates.length;
    if (
      !confirm(
        `Commit ${count} one-click-safe batch${count === 1 ? "" : "es"} to live records? This can't be undone. Anything that isn't one-click-safe stays in the queue for manual review.`,
      )
    ) {
      return;
    }

    setRunning(true);
    setMsg(null);
    setErrors([]);
    const state = { done: 0, ok: 0, failed: 0 };
    setProgress({ done: 0, total: count, ok: 0, failed: 0 });
    const failures: { label: string; error: string }[] = [];

    for (const b of candidates) {
      try {
        const res = await commitBatchById(b.id);
        if (res.ok) {
          state.ok++;
        } else {
          state.failed++;
          failures.push({ label: b.label, error: res.error ?? "unknown" });
        }
      } catch (e) {
        state.failed++;
        failures.push({ label: b.label, error: (e as Error).message });
      }
      state.done++;
      setProgress({ total: count, ...state });
    }

    setRunning(false);
    setErrors(failures);
    setMsg(
      `Done. ${state.ok} committed · ${state.failed} failed. ${state.failed === 0 ? "" : "See failures below."}`,
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
          ? `Committing ${progress.done} of ${progress.total}…`
          : `Commit ${candidates.length} one-click-safe batch${candidates.length === 1 ? "" : "es"}`}
      </button>
      {running && (
        <div
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 11,
            color: "#6b78a0",
          }}
        >
          {progress.ok} committed · {progress.failed} failed
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
        </div>
      )}
      {errors.length > 0 && (
        <ul
          style={{
            margin: "6px 0 0",
            padding: "8px 12px",
            background: "#fdecec",
            border: "1px solid #f3c2c2",
            borderRadius: 8,
            maxWidth: 480,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {errors.map((e, i) => (
            <li key={i} style={{ fontSize: 11.5, color: "#a12020" }}>
              <span style={{ fontWeight: 600 }}>{e.label}</span>{" "}
              <span
                style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
              >
                {e.error}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
