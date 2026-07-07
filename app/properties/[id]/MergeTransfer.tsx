"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeTransfers } from "../actions";

export type CandidateTransfer = {
  id: string;
  name: string;
  status: string | null;
  transferDate: string | null;
};

// Small "Merge into…" button on each transfer card. Expands into a list of
// the OTHER transfers on this property. Click one → confirm → fold this
// transfer (the loser) into the picked one (the keeper). Refresh.
export default function MergeTransfer({
  loserId,
  loserName,
  propertyId,
  candidates,
}: {
  loserId: string;
  loserName: string;
  propertyId: string;
  candidates: CandidateTransfer[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  function pick(winner: CandidateTransfer) {
    setErr(null);
    if (
      !confirm(
        `Merge "${loserName}" into "${winner.name}"?\n\nThis transfer's parties, agreement, documents and history will move to "${winner.name}". This transfer will then be deleted. This can't be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await mergeTransfers(winner.id, loserId, propertyId, null);
      if (!res.ok) {
        setErr(res.error ?? "merge failed");
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      {!open ? (
        <button
          type="button"
          className="ghost-dark"
          style={{ padding: "5px 11px", fontSize: 12 }}
          onClick={() => setOpen(true)}
        >
          Merge into another transfer…
        </button>
      ) : (
        <div
          style={{
            border: "1px solid #d7deef",
            borderRadius: 10,
            padding: 12,
            background: "#fbfcfe",
          }}
        >
          <div
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#6b78a0",
              marginBottom: 8,
            }}
          >
            Fold this transfer into
          </div>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  disabled={pending}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: "var(--white)",
                    border: "1px solid #d7deef",
                    borderRadius: 8,
                    padding: "8px 10px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--estuary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </span>
                  {c.transferDate && (
                    <span
                      style={{
                        fontFamily:
                          "'JetBrains Mono', ui-monospace, monospace",
                        fontSize: 10.5,
                        color: "#6b78a0",
                      }}
                    >
                      {c.transferDate}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              type="button"
              className="ghost-dark"
              style={{ padding: "5px 11px", fontSize: 12 }}
              onClick={() => {
                setOpen(false);
                setErr(null);
              }}
              disabled={pending}
            >
              Cancel
            </button>
            {pending && (
              <span style={{ fontSize: 12, color: "#6b78a0", alignSelf: "center" }}>
                Merging…
              </span>
            )}
          </div>
          {err && (
            <p
              className="error"
              style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}
            >
              {err}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
