// SA-formatted rand amount. One source of truth for prices/valuations
// so every screen prints them the same way. Per estate-agency-design skill:
//   - Prices: "R 2 450 000" — R prefix, space thousands, no decimals
//   - Cents (levies/rent): "R 3 250,00" — comma decimal
//   - Null: "POA" (Price on application) OR the caller's chosen fallback
//   - Range: en dash between two values
//
// Renders in JetBrains Mono with tabular-nums so columns of prices line up
// cleanly. Compose in table cells with `text-align: right` for ledger feel.

type Props = {
  value: number | null | undefined;
  /** Show cents with comma decimal (default false — prices don't need cents) */
  cents?: boolean;
  /** Range end — if set, renders "R X – R Y" */
  to?: number | null;
  /** What to show when value is null. Default "POA". */
  fallback?: string;
  /** Compact form for tight spaces: "R 2.5m", "R 450k". Default false. */
  compact?: boolean;
  /** Muted R prefix so the number dominates. Default true. */
  mutedPrefix?: boolean;
  /** Extra className appended to the root span. */
  className?: string;
  /** Inline style overrides (rare — token-driven CSS preferred). */
  style?: React.CSSProperties;
  /** aria-label override for screen readers ("nine million rand" etc.) */
  ariaLabel?: string;
};

export default function Rand({
  value,
  cents = false,
  to,
  fallback = "POA",
  compact = false,
  mutedPrefix = true,
  className,
  style,
  ariaLabel,
}: Props) {
  if (value == null && to == null) {
    return (
      <span
        className={`fmt-rand fmt-rand-null ${className ?? ""}`.trim()}
        style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)", ...style }}
      >
        {fallback}
      </span>
    );
  }

  const primary = value != null ? formatOne(value, cents, compact) : null;
  const range = to != null ? formatOne(to, cents, compact) : null;

  return (
    <span
      className={`fmt-rand ${className ?? ""}`.trim()}
      style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: '"tnum"',
        letterSpacing: "0.01em",
        ...style,
      }}
      aria-label={ariaLabel}
    >
      {primary && (
        <>
          <span
            className="fmt-rand-prefix"
            aria-hidden
            style={mutedPrefix ? { color: "var(--ink-400, #8C8172)", marginRight: "0.25em" } : { marginRight: "0.25em" }}
          >
            R
          </span>
          <span className="fmt-rand-value">{primary}</span>
        </>
      )}
      {range && (
        <>
          <span className="fmt-rand-sep" style={{ margin: "0 0.5em", color: "var(--ink-400, #8C8172)" }}>
            {"–"}
          </span>
          <span className="fmt-rand-prefix" aria-hidden style={mutedPrefix ? { color: "var(--ink-400, #8C8172)", marginRight: "0.25em" } : { marginRight: "0.25em" }}>
            R
          </span>
          <span className="fmt-rand-value">{range}</span>
        </>
      )}
    </span>
  );
}

function formatOne(n: number, cents: boolean, compact: boolean): string {
  if (!Number.isFinite(n)) return "—";
  if (compact) {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}m`;
    if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k`;
    return `${n}`;
  }
  if (cents) {
    // "R 3 250,00" — space thousands, comma decimal (SA convention)
    const [whole, frac = "00"] = n.toFixed(2).split(".");
    return `${spaceThousands(whole)},${frac}`;
  }
  // "R 2 450 000" — no decimals, space thousands (matches muni PDFs)
  return spaceThousands(Math.round(n).toString());
}

function spaceThousands(digits: string): string {
  const negative = digits.startsWith("-");
  const abs = negative ? digits.slice(1) : digits;
  const spaced = abs.replace(/\B(?=(\d{3})+(?!\d))/g, " "); // NBSP so it never line-breaks
  return negative ? `-${spaced}` : spaced;
}
