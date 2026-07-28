// Listing status pill using the estate-agency-design skill's colour system.
// One component so every screen (Map pin, Property Record header, Dashboard
// list, Erf Lookup) shows status the same way — and so the meaning-through-
// colour promise holds ("under offer = caution, not success" is enforced
// centrally rather than each caller picking amber vs green).
//
// Status vocab is the SA listing lifecycle:
//   draft        → not yet on the market
//   active       → live / on the market
//   under-offer  → OTP accepted, suspensive conditions outstanding (CAUTION)
//   sold         → conditions met, registered (or sold externally)
//   withdrawn    → mandate ended without a sale
//
// Anything else we render as draft (safe default) with the raw value shown
// so bad data surfaces visibly rather than lying.

export type ListingStatus =
  | "draft"
  | "active"
  | "live"                // legacy alias — treat as active
  | "under_offer"         // legacy DB form
  | "under-offer"
  | "sold"
  | "sold_external"       // legacy — dream lost the deal but sold
  | "withdrawn"
  | "expired";            // treat as withdrawn

const NORMALISE: Record<string, ListingStatus> = {
  draft: "draft",
  active: "active",
  live: "active",
  under_offer: "under-offer",
  "under-offer": "under-offer",
  sold: "sold",
  sold_external: "sold",
  registered: "sold",
  withdrawn: "withdrawn",
  expired: "withdrawn",
  cancelled: "withdrawn",
  lapsed: "withdrawn",
};

const LABEL: Record<ListingStatus, string> = {
  draft: "Draft",
  active: "Active",
  live: "Active",
  under_offer: "Under offer",
  "under-offer": "Under offer",
  sold: "Sold",
  sold_external: "Sold elsewhere",
  withdrawn: "Withdrawn",
  expired: "Withdrawn",
};

type Props = {
  status: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
  style?: React.CSSProperties;
};

export default function ListingStatusPill({ status, size = "md", className, style }: Props) {
  if (!status) return null;
  const key = status.toLowerCase();
  const normalised = NORMALISE[key] ?? "draft";
  const isExternal = key === "sold_external";
  const label = isExternal ? "Sold elsewhere" : LABEL[normalised];

  // Look up token names — the CSS custom properties handle actual colours.
  const tokenKey = normalised === "under-offer" ? "under-offer" : normalised;
  const bg = `var(--status-${tokenKey}-bg)`;
  const fg = `var(--status-${tokenKey}-fg)`;

  const padY = size === "sm" ? "2px" : "3px";
  const padX = size === "sm" ? "8px" : "10px";
  const fontSize = size === "sm" ? 10 : 11;

  return (
    <span
      className={`listing-status listing-status-${tokenKey} ${className ?? ""}`.trim()}
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
      {label}
    </span>
  );
}
