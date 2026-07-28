// SA-formatted area. "682 m²" up to 9,999 m²; "1.2 ha" past that when the
// caller opts in (default false — freehold erf sizes are almost always
// still in m² in Knysna's title deeds, even for larger stands). Land /
// farm listings pass `preferHectares` so the caller controls the unit.

type Props = {
  value: number | null | undefined;   // m²
  /** Prefer hectares for land / farm listings when value > 10_000 m². */
  preferHectares?: boolean;
  /** Fallback for null (default em-dash). */
  fallback?: string;
  className?: string;
  style?: React.CSSProperties;
};

export default function Area({
  value,
  preferHectares = false,
  fallback = "—",
  className,
  style,
}: Props) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <span className={`fmt-area fmt-area-null ${className ?? ""}`.trim()} style={style}>
        {fallback}
      </span>
    );
  }
  const useHa = preferHectares && value >= 10_000;
  const display = useHa
    ? `${(value / 10_000).toFixed(2)} ha`
    : `${Math.round(value).toLocaleString("en-ZA").replace(/,/g, " ")} m²`;
  return (
    <span
      className={`fmt-area ${className ?? ""}`.trim()}
      style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "0.01em",
        ...style,
      }}
    >
      {display}
    </span>
  );
}
