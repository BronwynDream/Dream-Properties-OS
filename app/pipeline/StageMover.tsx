"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTransferStage } from "./actions";
import { STAGE_LABEL, nextStage, prevStage, type AnyStage } from "@/lib/pipeline";

// Inline stage-mover attached to each pipeline card. Two arrows for
// linear ← / → moves; a small select for a direct jump (e.g. "cancel"
// or "jump straight to conveyancing when a cash deal skips under-offer
// entirely"). Terminal moves prompt a confirm before firing.

export default function StageMover({
  transferId,
  currentStage,
}: {
  transferId: string;
  currentStage: AnyStage;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const forward = nextStage(currentStage);
  const backward = prevStage(currentStage);

  function move(to: AnyStage) {
    setErr(null);
    const terminal = to === "registered" || to === "cancelled" || to === "lapsed";
    if (terminal) {
      const label = STAGE_LABEL[to];
      const ok = confirm(`Move this deal to "${label}"? This is a terminal state.`);
      if (!ok) return;
    }
    startTransition(async () => {
      const res = await setTransferStage({ transferId, toStage: to, confirmTerminal: terminal });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 8 }}>
      <button
        type="button"
        onClick={() => backward && move(backward)}
        disabled={pending || !backward}
        title={backward ? `Back to ${STAGE_LABEL[backward]}` : "Nothing before this"}
        style={arrowBtn}
      >
        ←
      </button>
      <button
        type="button"
        onClick={() => forward && move(forward)}
        disabled={pending || !forward}
        title={forward ? `Advance to ${STAGE_LABEL[forward]}` : "Nothing after this"}
        style={{ ...arrowBtn, flex: 1 }}
      >
        {forward ? `→ ${STAGE_LABEL[forward]}` : "—"}
      </button>
      <select
        value=""
        onChange={(e) => {
          const to = e.target.value as AnyStage;
          if (to) move(to);
          e.target.value = "";
        }}
        disabled={pending}
        title="Jump to any stage"
        style={jumpSelect}
      >
        <option value="">⋯</option>
        <option value="cancelled">Cancel deal</option>
        <option value="lapsed">Mark lapsed</option>
      </select>
      {err && (
        <span style={{ marginLeft: 6, fontSize: 10, color: "var(--critical, #9A3B34)" }}>{err}</span>
      )}
    </div>
  );
}

const arrowBtn: React.CSSProperties = {
  padding: "4px 8px",
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontWeight: 600,
  border: "1px solid var(--line-strong, #D8CFBE)",
  background: "var(--paper-0, #FBF9F4)",
  color: "var(--estuary, #132B84)",
  borderRadius: 3,
  cursor: "pointer",
};

const jumpSelect: React.CSSProperties = {
  padding: "3px 6px",
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  border: "1px solid var(--line-strong, #D8CFBE)",
  background: "var(--paper-0, #FBF9F4)",
  color: "var(--ink-700, #423B31)",
  borderRadius: 3,
  cursor: "pointer",
};
