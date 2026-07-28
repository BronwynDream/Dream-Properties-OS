// Reference strings — erf number, SG21, title deed, listing ref, scheme
// unit. Per skill: rendered verbatim, in mono, never truncated or
// reformatted. `label` prepends a small caps tag (e.g. "ERF", "DEED"),
// visually associating the reference to its kind.

type Props = {
  value: string | number | null | undefined;
  /** Small caps tag prepended (e.g. "ERF"). */
  label?: string;
  fallback?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Bigger emphasis for hero-level references. Default false. */
  emphasize?: boolean;
};

export default function Ref({
  value,
  label,
  fallback = "—",
  className,
  style,
  emphasize = false,
}: Props) {
  const has = value != null && String(value).trim() !== "";
  return (
    <span
      className={`fmt-ref ${className ?? ""}`.trim()}
      style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: emphasize ? "0.02em" : "0.01em",
        fontWeight: emphasize ? 600 : 500,
        ...style,
      }}
    >
      {label && (
        <span
          aria-hidden
          style={{
            fontSize: "0.75em",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--ink-400, #8C8172)",
            marginRight: "0.5em",
            fontWeight: 400,
          }}
        >
          {label}
        </span>
      )}
      {has ? String(value) : fallback}
    </span>
  );
}
