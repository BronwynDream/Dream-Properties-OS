"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkTransfer } from "../actions";
import type { LinkedTransfer } from "./page";

function humanStatus(raw: string | null): string {
  if (!raw) return "—";
  if (raw === "in_conveyancing") return "In conveyancing";
  if (raw === "registered") return "Registered";
  if (raw === "preparing") return "Preparing";
  return raw.replace(/_/g, " ");
}

// Renders inside the Matches panel after the property target is linked. Lists
// existing transfers on the linked property so the reviewer can attach the
// batch to one — parties, agreements, documents accrete onto it instead of
// spawning a fresh transfer row per commit.
export default function TransferPicker({
  batchId,
  transfers,
  selectedTransferId,
  propertyLabel,
}: {
  batchId: string;
  transfers: LinkedTransfer[];
  selectedTransferId: string | null;
  propertyLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pick(transferId: string | null, label: string | null) {
    startTransition(async () => {
      await linkTransfer(batchId, transferId, label);
      router.refresh();
    });
  }

  if (transfers.length === 0) return null;

  const usingNew = !selectedTransferId;

  return (
    <div className="match-target" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <strong>Transfer</strong>
        <span style={{ color: "#5b6885", fontSize: 13 }}>
          {propertyLabel} already has {transfers.length}{" "}
          {transfers.length === 1 ? "transfer" : "transfers"} — attach this batch
          to one of them, or create a new one.
        </span>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {/* Explicit "create new" option so the reviewer's choice is visible */}
        <button
          type="button"
          onClick={() => pick(null, null)}
          disabled={pending}
          className="match-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 12px",
            border: "1px solid",
            borderColor: usingNew ? "#1C5B3A" : "#e2e5ee",
            background: usingNew ? "rgba(28,91,58,0.05)" : "#fff",
            borderRadius: 6,
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "inherit",
          }}
        >
          <span style={{ flex: 1, fontWeight: 600 }}>
            Create a new transfer
          </span>
          <span style={{ color: "#5b6885", fontSize: 12 }}>
            (default — commits create a fresh transfer on this property)
          </span>
          {usingNew && <span className="tier tier-green">using</span>}
        </button>

        {transfers.map((t) => {
          const isPicked = selectedTransferId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t.id, t.name)}
              disabled={pending}
              className="match-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                border: "1px solid",
                borderColor: isPicked ? "#1C5B3A" : "#e2e5ee",
                background: isPicked ? "rgba(28,91,58,0.05)" : "#fff",
                borderRadius: 6,
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <span style={{ flex: 1, fontWeight: 600 }}>{t.name}</span>
              <span
                className="pill"
                style={{ background: "#EDF0F8", color: "#15203A" }}
              >
                {humanStatus(t.status)}
              </span>
              {t.transferDate && (
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    color: "#6b78a0",
                  }}
                >
                  {t.transferDate}
                </span>
              )}
              {isPicked && <span className="tier tier-green">attaching</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
