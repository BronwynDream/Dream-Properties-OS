"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markTransferSold, type SoldBy } from "../actions";

// "Mark as sold" action on each transfer card in the Ownership Timeline.
// Opens an inline picker (same idiom as MergeTransfer): four radios for
// who closed the deal, a free-text note (partner agency name or context),
// and Save / Cancel.
//
// - Dream sold it → records intent only. Status advances naturally when
//   the title deed lands (migration 0018). This preserves the strict-
//   legal meaning of 'registered'.
// - Joint partner / Another agency / Pre-mandate → status flips to
//   'sold_external'. No Deeds Office paperwork will come to Dream for
//   these; the transfer should no longer read as "in conveyancing".

export default function MarkSoldButton({
  transferId,
  transferName,
  propertyId,
  currentSoldBy,
}: {
  transferId: string;
  transferName: string;
  propertyId: string;
  currentSoldBy: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [soldBy, setSoldBy] = useState<SoldBy>("dream");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    startTransition(async () => {
      const res = await markTransferSold(
        transferId,
        propertyId,
        soldBy,
        note.trim() || null,
      );
      if (!res.ok) {
        setErr(res.error ?? "Could not mark sold.");
        return;
      }
      setOpen(false);
      setNote("");
      router.refresh();
    });
  }

  const buttonLabel = currentSoldBy ? "Update sold status" : "Mark as sold";
  const notePlaceholder =
    soldBy === "partner"
      ? "Partner agency name (e.g. Pam Golding Knysna Plett)"
      : soldBy === "other"
        ? "Which agency? (if known)"
        : soldBy === "pre_mandate"
          ? "How you found out (optional)"
          : "Optional note";

  return (
    <div style={{ marginTop: 12 }}>
      {!open ? (
        <button
          type="button"
          className="ghost-dark"
          style={{ padding: "5px 11px", fontSize: 12 }}
          onClick={() => setOpen(true)}
        >
          {buttonLabel}
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
              marginBottom: 10,
            }}
          >
            Who sold {transferName}?
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(
              [
                { v: "dream", label: "Dream Knysna sold it" },
                { v: "partner", label: "Joint-mandate partner sold it" },
                { v: "other", label: "Another agency sold it" },
                { v: "pre_mandate", label: "Sold before Dream took the mandate" },
              ] as { v: SoldBy; label: string }[]
            ).map((opt) => (
              <label
                key={opt.v}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--estuary)",
                  cursor: "pointer",
                  margin: 0,
                  padding: "4px 0",
                }}
              >
                <input
                  type="radio"
                  name={`sold-by-${transferId}`}
                  value={opt.v}
                  checked={soldBy === opt.v}
                  onChange={() => setSoldBy(opt.v)}
                />
                {opt.label}
              </label>
            ))}
          </div>

          <div style={{ marginTop: 10 }}>
            <input
              type="text"
              placeholder={notePlaceholder}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid #d7deef",
                borderRadius: 8,
                fontSize: 12.5,
                fontFamily: "inherit",
              }}
            />
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                background: "var(--navy)",
                color: "var(--white)",
                border: 0,
                borderRadius: 8,
                cursor: pending ? "wait" : "pointer",
                fontWeight: 600,
              }}
            >
              {pending ? "Saving…" : "Mark as sold"}
            </button>
            <button
              type="button"
              className="ghost-dark"
              style={{ padding: "5px 11px", fontSize: 12 }}
              onClick={() => {
                setOpen(false);
                setErr(null);
                setNote("");
              }}
              disabled={pending}
            >
              Cancel
            </button>
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
