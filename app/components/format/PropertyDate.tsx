// SA-formatted date. "14 Aug 2026" for prose contexts, or "2026-08-14"
// in tables (compact + sortable). Label prop names which date (Registration,
// Occupation, Mandate expiry) — matters because a property record carries
// three or four different dates that shouldn't be confused.

type Props = {
  value: string | Date | null | undefined;   // ISO string or Date
  /** "prose" (14 Aug 2026) or "iso" (2026-08-14). Default prose. */
  format?: "prose" | "iso";
  /** Small caps label prepended (e.g. "Registered"). */
  label?: string;
  fallback?: string;
  className?: string;
  style?: React.CSSProperties;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PropertyDate({
  value,
  format = "prose",
  label,
  fallback = "—",
  className,
  style,
}: Props) {
  const d = parse(value);
  if (!d) {
    return (
      <span className={`fmt-date fmt-date-null ${className ?? ""}`.trim()} style={style}>
        {label && <LabelSpan text={label} />}
        {fallback}
      </span>
    );
  }
  const text =
    format === "iso"
      ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
      : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return (
    <span
      className={`fmt-date ${className ?? ""}`.trim()}
      style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {label && <LabelSpan text={label} />}
      {text}
    </span>
  );
}

function LabelSpan({ text }: { text: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
        fontSize: "0.75em",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--ink-400, #8C8172)",
        marginRight: "0.5em",
      }}
    >
      {text}
    </span>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parse(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v.length === 10 ? v + "T00:00:00Z" : v);
  return Number.isFinite(d.getTime()) ? d : null;
}
