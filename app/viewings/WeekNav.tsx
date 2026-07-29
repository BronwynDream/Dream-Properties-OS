"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

// Week navigation for the /viewings calendar. Stores the current week
// as an ISO Monday date in searchParams (?week=YYYY-MM-DD) so pages
// are linkable/shareable and back/forward moves feel like navigation
// rather than local state.

export default function WeekNav({
  mondayIso,
  label,
}: {
  mondayIso: string;
  label: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function jump(deltaDays: number) {
    const d = new Date(mondayIso + "T00:00:00");
    d.setDate(d.getDate() + deltaDays);
    const iso = d.toISOString().slice(0, 10);
    const next = new URLSearchParams(params?.toString() ?? "");
    next.set("week", iso);
    router.push(`/viewings?${next.toString()}`);
  }

  function today() {
    router.push("/viewings");
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" onClick={() => jump(-7)} style={btn}>
        ← Week
      </button>
      <button type="button" onClick={today} style={btnPrimary}>
        This week
      </button>
      <button type="button" onClick={() => jump(7)} style={btn}>
        Week →
      </button>
      <span
        style={{
          marginLeft: 8,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 12,
          color: "var(--paper-mute, #6a7692)",
        }}
      >
        w/o {label}
      </span>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "5px 12px",
  border: "1px solid var(--line-strong, #D8CFBE)",
  background: "var(--paper-0, #FBF9F4)",
  color: "var(--estuary, #132B84)",
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  borderRadius: 3,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "var(--estuary, #132B84)",
  color: "var(--paper-0, #FBF9F4)",
  border: "1px solid var(--estuary, #132B84)",
};
