"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeBatches } from "./actions";

// Duplicate-batch detector + merge UI. Sits above the triage table
// when we see multiple batches whose normalized label is identical
// (or near-identical). Shows one cluster per group, with a "Merge"
// button that combines all batches in the cluster into the first one
// (the earliest — or user-picked target).
//
// Rule for what counts as a duplicate: normalized label match. Not
// semantic — "St James Hotel Knysna" and "Information on The St James
// Hotel of Knysna" won't cluster because their prose is different.
// Simon can eyeball those and use the picker to hand-merge.

export type BatchLite = {
  id: string;
  label: string;
  status: string;
  file_count: number;
  proposed_count: number;
  confirmed_count: number;
  created_at: string;
  property_id: string | null;
};

type Cluster = {
  key: string;
  label: string;
  batches: BatchLite[];
};

export default function DuplicateBanner({ batches }: { batches: BatchLite[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const clusters = detectClusters(batches);
  if (clusters.length === 0) return null;

  function mergeCluster(cluster: Cluster) {
    // Pick the target: prefer a batch that's already linked to a property
    // (survives the merge without a re-decide), else the earliest one.
    const target =
      cluster.batches.find((b) => b.property_id) ??
      cluster.batches.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    const sources = cluster.batches.filter((b) => b.id !== target.id).map((b) => b.id);
    if (!confirm(`Merge ${sources.length + 1} batches labelled "${cluster.label}" into one? Sources will disappear; their files + extractions move to the target.`)) return;
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      const res = await mergeBatches(target.id, sources);
      if (!res.ok) {
        setErr(res.error ?? "merge failed");
        return;
      }
      setMsg(`Merged ${res.moved?.files ?? 0} files, ${res.moved?.extractions ?? 0} extractions into ${target.label}`);
      router.refresh();
    });
  }

  return (
    <section
      style={{
        marginTop: 16,
        padding: "12px 16px",
        background: "#F7EFD9",
        border: "1px solid #E4D3A0",
        borderRadius: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p
            style={{
              margin: 0,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#7A5814",
              fontWeight: 600,
            }}
          >
            Duplicate batches · {clusters.length} cluster{clusters.length === 1 ? "" : "s"}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#5b4a20" }}>
            Same folder ingested more than once. Merging combines files, extractions and match candidates into one batch.
          </p>
        </div>
      </div>

      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {clusters.map((c) => (
          <li
            key={c.key}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 10,
              alignItems: "center",
              padding: "8px 10px",
              background: "rgba(255,255,255,0.55)",
              border: "1px solid #E4D3A0",
              borderRadius: 4,
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: 13, color: "#3a2f10", fontWeight: 500 }}>
                {c.label}
                <span style={{ marginLeft: 8, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "#7a6234" }}>
                  ×{c.batches.length}
                </span>
              </p>
              <p style={{ margin: "2px 0 0", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "#7a6234", letterSpacing: "0.02em" }}>
                {c.batches.map((b) => `${b.file_count}f/${b.confirmed_count}c${b.property_id ? "✓" : ""}`).join(" · ")}
              </p>
            </div>
            <button type="button" onClick={() => mergeCluster(c)} disabled={pending} style={btn}>
              {pending ? "Merging…" : `Merge ${c.batches.length}`}
            </button>
          </li>
        ))}
      </ul>
      {err && <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--critical, #9A3B34)" }}>{err}</p>}
      {msg && <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--positive, #4B6B4A)" }}>{msg}</p>}
    </section>
  );
}

function detectClusters(batches: BatchLite[]): Cluster[] {
  const byKey = new Map<string, BatchLite[]>();
  for (const b of batches) {
    const key = normalizeLabel(b.label);
    if (!key) continue;
    const arr = byKey.get(key) ?? [];
    arr.push(b);
    byKey.set(key, arr);
  }
  const clusters: Cluster[] = [];
  for (const [key, arr] of byKey.entries()) {
    if (arr.length < 2) continue;
    // Refuse to cluster if any two members have conflicting property_id —
    // they're not duplicates, they're distinct deals that share a label.
    const distinctProps = new Set(arr.map((b) => b.property_id).filter(Boolean));
    if (distinctProps.size > 1) continue;
    clusters.push({
      key,
      label: arr[0].label,
      batches: arr,
    });
  }
  // Biggest cluster first.
  clusters.sort((a, b) => b.batches.length - a.batches.length);
  return clusters;
}

// Normalisation: lowercase, drop punctuation, collapse whitespace, drop
// trailing city / marketing words that don't distinguish folders.
function normalizeLabel(label: string): string {
  if (!label) return "";
  let s = label.toLowerCase();
  if (/^dropped files/.test(s)) return ""; // never cluster generic drops
  s = s.replace(/[^a-z0-9\s]/g, " ")
       .replace(/\s+/g, " ")
       .trim();
  // Strip trailing "knysna" / "via email" / "the heads" markers so
  // "6 Bowden" == "6 Bowden Knysna".
  s = s.replace(/\s(knysna|via email)$/i, "").trim();
  return s;
}

const btn: React.CSSProperties = {
  padding: "6px 14px",
  background: "#7A5814",
  color: "#F7EFD9",
  border: "none",
  borderRadius: 3,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  cursor: "pointer",
};
