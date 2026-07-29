"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { routeBatchToEstate } from "../actions";

// Bailout path for triage batches that carry estate-level artefacts
// (architectural design manual, HOA rules, plant list, disturbance-
// area plans per plot) rather than property-scoped documents. Filing
// them to an estate skips the extraction + property/transfer commit
// path and drops the files straight into the estate vault at
// /estates/[id].

export type EstateOption = { id: string; name: string };

type Props = {
  batchId: string;
  batchLabel: string;
  currentEstate: { id: string; name: string } | null;
  estates: EstateOption[];
};

export default function RouteToEstate({ batchId, batchLabel, currentEstate, estates }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // If the batch is already filed to an estate, show a static status
  // pill instead of the routing UI — the file operation is one-shot.
  if (currentEstate) {
    return (
      <div
        style={{
          padding: "10px 14px",
          background: "var(--status-active-bg)",
          border: "1px solid var(--status-active-fg)",
          borderRadius: 6,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--status-active-fg)" }}>
          Filed to{" "}
          <Link
            href={`/estates/${currentEstate.id}`}
            style={{ color: "var(--status-active-fg)", fontWeight: 600 }}
          >
            {currentEstate.name}
          </Link>
        </span>
        <Link
          href={`/estates/${currentEstate.id}`}
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--status-active-fg)",
            textDecoration: "underline",
          }}
        >
          Open vault →
        </Link>
      </div>
    );
  }

  function submit() {
    if (!selected) return;
    const est = estates.find((e) => e.id === selected);
    if (!est) return;
    if (!confirm(`File "${batchLabel}" into ${est.name}? Documents will move to the estate vault and this batch will be marked committed.`)) return;
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      const res = await routeBatchToEstate(batchId, selected);
      if (!res.ok) {
        setErr(res.error ?? "route failed");
        return;
      }
      setMsg(`Filed ${res.filed ?? 0} docs${res.deduped ? ` (${res.deduped} duplicates skipped)` : ""} to ${est.name}.`);
      router.refresh();
    });
  }

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--paper-1, #F5F1E8)",
        border: "1px solid var(--line-soft, #E7E0D2)",
        borderRadius: 6,
        marginBottom: 16,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-500, #6B6153)",
        }}
      >
        Route to estate vault
      </p>
      <p style={{ margin: "4px 0 8px", fontSize: 12, color: "var(--ink-700, #423B31)" }}>
        Use this when the batch is estate-level (architectural manual, HOA rules, plant list, disturbance area) rather than about a specific property. Files land in the vault at <code>/estates/[id]</code> and this batch is marked committed.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={pending || estates.length === 0}
          style={{
            padding: "6px 10px",
            border: "1px solid var(--line-strong, #D8CFBE)",
            borderRadius: 3,
            fontFamily: "inherit",
            fontSize: 13,
            background: "var(--paper-0, #FBF9F4)",
            minWidth: 260,
          }}
        >
          <option value="">— choose an estate —</option>
          {estates.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !selected}
          style={{
            padding: "6px 14px",
            background: selected ? "var(--estuary, #132B84)" : "var(--paper-2, #ECE6D8)",
            color: selected ? "var(--paper-0, #FBF9F4)" : "var(--paper-mute, #6a7692)",
            border: "none",
            borderRadius: 3,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 600,
            cursor: selected ? "pointer" : "not-allowed",
          }}
        >
          {pending ? "Filing…" : "Route to estate"}
        </button>
      </div>
      {err && <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--critical, #9A3B34)" }}>{err}</p>}
      {msg && <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--positive, #4B6B4A)" }}>{msg}</p>}
    </div>
  );
}
