"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const TYPES = ["exclusive", "sole", "joint", "open"] as const;
type MandateType = (typeof TYPES)[number];

export default function TypeFilterChips({
  enabled,
}: {
  enabled: Set<MandateType>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function toggle(t: MandateType) {
    const next = new Set(enabled);
    if (next.has(t)) next.delete(t);
    else next.add(t);

    const q = new URLSearchParams(params?.toString() ?? "");
    // Encode as "types=exclusive,sole". Empty set collapses to all-on (the
    // page's parseTypes treats missing == everything), so we drop the param
    // in that case to keep URLs clean.
    if (next.size === 0 || next.size === TYPES.length) {
      q.delete("types");
    } else {
      q.set("types", TYPES.filter((x) => next.has(x)).join(","));
    }
    const qs = q.toString();
    startTransition(() => {
      router.replace(qs ? `/mandates?${qs}` : "/mandates");
    });
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        padding: "8px 0",
        opacity: pending ? 0.6 : 1,
      }}
    >
      <span
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--paper-mute, #6a7692)",
          marginRight: 4,
        }}
      >
        Type
      </span>
      {TYPES.map((t) => {
        const on = enabled.has(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              padding: "4px 10px",
              borderRadius: 3,
              border: `1px solid ${on ? "var(--estuary, #132B84)" : "var(--hairline, #e2e8f5)"}`,
              background: on ? "var(--estuary, #132B84)" : "transparent",
              color: on ? "#fff" : "var(--paper-mute, #6a7692)",
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
