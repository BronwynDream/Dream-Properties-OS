"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mergeTransfers } from "@/app/properties/actions";
import { PIPELINE_STAGES, STAGE_LABEL, type AnyStage } from "@/lib/pipeline";

// Duplicate-transfer detector for /pipeline. Sits above the kanban when
// the same property_id shows up on more than one live transfer. Merges
// them pairwise using the existing mergeTransfers RPC (migration 0019),
// picking the most-advanced-stage transfer as the winner so the deal
// keeps its momentum after the merge.
//
// Root cause of these duplicates: several ingest_batches for the same
// property got committed individually before the triage-dedup shipped
// (PR #26). Each commit_batch spawned its own transfer. This screen
// cleans up the wreckage.

export type PipelineCardLite = {
  id: string;
  propertyId: string | null;
  propertyAddress: string | null;
  status: AnyStage;
  daysInStage: number;
};

type Cluster = {
  propertyId: string;
  address: string | null;
  transfers: PipelineCardLite[];
};

const STAGE_RANK: Record<string, number> = Object.fromEntries(
  PIPELINE_STAGES.map((s, i) => [s, i]),
);

export default function DuplicateTransfersBanner({ cards }: { cards: PipelineCardLite[] }) {
  const router = useRouter();
  // Per-cluster busy + err + msg so one merge in flight doesn't disable
  // or overwrite the state of the others.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errByKey, setErrByKey] = useState<Record<string, string>>({});
  const [msgByKey, setMsgByKey] = useState<Record<string, string>>({});

  const clusters = detectClusters(cards);
  if (clusters.length === 0) return null;

  async function mergeCluster(cluster: Cluster) {
    const sorted = [...cluster.transfers].sort((a, b) => {
      const ra = STAGE_RANK[a.status] ?? -1;
      const rb = STAGE_RANK[b.status] ?? -1;
      if (rb !== ra) return rb - ra;
      return b.daysInStage - a.daysInStage;
    });
    const winner = sorted[0];
    const losers = sorted.slice(1);
    if (!confirm(`Merge ${losers.length + 1} transfers on ${cluster.address ?? "this property"} into one? The most-advanced (${STAGE_LABEL[winner.status]}) survives; the others are collapsed into it.`)) return;
    setErrByKey((prev) => { const next = { ...prev }; delete next[cluster.propertyId]; return next; });
    setMsgByKey((prev) => { const next = { ...prev }; delete next[cluster.propertyId]; return next; });
    setBusyKey(cluster.propertyId);
    try {
      let ok = 0;
      let failed: string | null = null;
      for (const loser of losers) {
        const res = await mergeTransfers(winner.id, loser.id, cluster.propertyId, "pipeline dedup");
        if (!res.ok) {
          failed = res.error;
          break;
        }
        ok++;
      }
      if (failed) {
        setErrByKey((prev) => ({ ...prev, [cluster.propertyId]: `Merged ${ok}/${losers.length}, then failed: ${failed}` }));
      } else {
        setMsgByKey((prev) => ({ ...prev, [cluster.propertyId]: `Merged ${ok + 1} transfers into ${cluster.address ?? winner.id.slice(0, 8)}` }));
      }
      router.refresh();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section
      style={{
        marginBottom: 16,
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
            Duplicate transfers · {clusters.length} propert{clusters.length === 1 ? "y" : "ies"}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#5b4a20" }}>
            Same property carries more than one live transfer. Merging collapses parties, agreements, milestones, and documents onto the most-advanced one.
          </p>
        </div>
      </div>

      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {clusters.map((c) => {
          const busy = busyKey === c.propertyId;
          const anyBusy = busyKey !== null && busyKey !== c.propertyId;
          const clusterErr = errByKey[c.propertyId];
          const clusterMsg = msgByKey[c.propertyId];
          return (
            <li
              key={c.propertyId}
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
                  <Link href={`/properties/${c.propertyId}`} style={{ color: "inherit" }}>
                    {c.address ?? c.propertyId.slice(0, 8)}
                  </Link>
                  <span style={{ marginLeft: 8, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "#7a6234" }}>
                    ×{c.transfers.length}
                  </span>
                </p>
                <p style={{ margin: "2px 0 0", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, color: "#7a6234", letterSpacing: "0.02em" }}>
                  {c.transfers.map((t) => `${STAGE_LABEL[t.status]} (${t.daysInStage}d)`).join(" · ")}
                </p>
                {clusterErr && (
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--critical, #9A3B34)" }}>
                    {clusterErr}
                  </p>
                )}
                {clusterMsg && (
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--positive, #4B6B4A)" }}>
                    {clusterMsg}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => mergeCluster(c)} disabled={busy || anyBusy} style={btn}>
                {busy ? "Merging…" : `Merge ${c.transfers.length}`}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function detectClusters(cards: PipelineCardLite[]): Cluster[] {
  const byProp = new Map<string, PipelineCardLite[]>();
  for (const c of cards) {
    if (!c.propertyId) continue;
    const arr = byProp.get(c.propertyId) ?? [];
    arr.push(c);
    byProp.set(c.propertyId, arr);
  }
  const clusters: Cluster[] = [];
  for (const [propertyId, arr] of byProp.entries()) {
    if (arr.length < 2) continue;
    clusters.push({
      propertyId,
      address: arr[0].propertyAddress,
      transfers: arr,
    });
  }
  clusters.sort((a, b) => b.transfers.length - a.transfers.length);
  return clusters;
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
