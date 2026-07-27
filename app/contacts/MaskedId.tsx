"use client";

import { useState } from "react";

// SA ID = 13 digits. Passport = variable. Mask keeps first 6 chars
// (YYMMDD birth prefix on SA IDs is useful context) + hides the rest.
export default function MaskedId({ value }: { value: string | null | undefined }) {
  const [revealed, setRevealed] = useState(false);
  if (!value) return <span style={{ color: "var(--paper-mute)" }}>—</span>;
  const shown = revealed ? value : `${value.slice(0, 6)}${"•".repeat(Math.max(0, value.length - 6))}`;
  return (
    <button
      type="button"
      onClick={() => setRevealed((v) => !v)}
      title={revealed ? "Hide ID" : "Click to reveal ID"}
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 12.5,
        letterSpacing: "0.02em",
        background: "transparent",
        border: 0,
        padding: 0,
        color: "var(--estuary)",
        cursor: "pointer",
      }}
    >
      {shown}
    </button>
  );
}
