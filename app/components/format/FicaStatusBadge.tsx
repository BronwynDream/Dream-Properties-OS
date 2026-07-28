import type { DerivedFica, FicaState } from "@/lib/fica";
import { ficaLabel } from "@/lib/fica";

// FICA badge — reads a DerivedFica (see lib/fica.ts) and renders a pill
// using the same token system as ListingStatusPill. Uniform shape so a
// row that shows both listing status + FICA state reads as one grammar.
//
// State → colour map:
//   verified → active tokens (green tint) — the only "good" state
//   stale    → under-offer tokens (amber) — caution, needs action but
//              not urgent
//   pending  → under-offer tokens (amber) — same visual weight
//   expired  → withdrawn tokens (red) — critical
//   none     → draft tokens (grey) — data-hygiene signal, not urgent
//
// Deliberately re-uses the listing status tokens rather than inventing new
// ones — keeps the page consistent. Under-offer amber for "pending/stale"
// keeps the "amber = attention needed but not blocked" meaning intact.

const STATE_TOKEN: Record<FicaState, "active" | "under-offer" | "withdrawn" | "draft"> = {
  verified: "active",
  stale: "under-offer",
  pending: "under-offer",
  expired: "withdrawn",
  none: "draft",
};

type Props = {
  derived: DerivedFica;
  size?: "sm" | "md";
  className?: string;
  style?: React.CSSProperties;
  showLabel?: boolean; // false → dot only, useful in dense tables
};

export default function FicaStatusBadge({ derived, size = "sm", className, style, showLabel = true }: Props) {
  const token = STATE_TOKEN[derived.state];
  const bg = `var(--status-${token}-bg)`;
  const fg = `var(--status-${token}-fg)`;
  const label = ficaLabel(derived);

  const padY = size === "sm" ? "2px" : "3px";
  const padX = size === "sm" ? "8px" : "10px";
  const fontSize = size === "sm" ? 10 : 11;

  return (
    <span
      className={`fica-badge fica-badge-${derived.state} ${className ?? ""}`.trim()}
      title={`FICA · ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: `${padY} ${padX}`,
        background: bg,
        color: fg,
        borderRadius: "var(--radius-sm, 4px)",
        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
        fontSize,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 600,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: fg,
          opacity: 0.75,
        }}
      />
      {showLabel && <>FICA · {label}</>}
    </span>
  );
}
