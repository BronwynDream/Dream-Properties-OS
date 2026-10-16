import Link from "next/link";

// Generated documents on a property record (plan 019 Arc A3): every
// document_draft produced from the clause library for this property. Opens
// back into the editor in A4; for now it is the register's first page —
// "what did we prepare for this seller, and when".

type Row = {
  id: string;
  title: string | null;
  status: "draft" | "final" | "superseded";
  created_at: string;
  mandate_id: string | null;
  signed_document_id: string | null;
  rendered_document_id: string | null;
  template: { label: string } | { label: string }[] | null;
  author: { full_name: string | null } | { full_name: string | null }[] | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default function GeneratedDocuments({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>Generated documents</h2>
        <Link href="/documents" style={{ fontSize: 12, color: "var(--navy)" }}>All documents →</Link>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 6 }}>
        {rows.map((r) => {
          const tpl = one(r.template);
          const author = one(r.author);
          return (
            <li
              key={r.id}
              style={{
                border: "1px solid var(--hairline, #e2e8f5)",
                borderRadius: 3,
                padding: "10px 14px",
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto auto",
                gap: 14,
                alignItems: "center",
                background: "var(--white)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <Link href={`/documents/${r.id}`} style={{ fontWeight: 600, color: "var(--ink)", textDecoration: "none" }}>
                  {tpl?.label ?? r.title ?? "Document"}
                </Link>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--paper-mute)" }}>
                  {author?.full_name ?? "—"} ·{" "}
                  {new Date(r.created_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" })}
                </div>
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: r.status === "final" ? "var(--positive)" : r.status === "draft" ? "var(--caution)" : "var(--ink-400)",
                  border: "1px solid currentColor",
                  borderRadius: 999,
                  padding: "2px 8px",
                }}
              >
                {r.signed_document_id ? "signed" : r.status}
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                {r.rendered_document_id && (
                  <a href={`/documents/${r.id}/file${r.signed_document_id ? "?which=signed" : ""}`} target="_blank" rel="noopener" className="btn-secondary" style={{ padding: "6px 10px", fontSize: 12, textDecoration: "none" }}>
                    PDF
                  </a>
                )}
                <Link href={`/documents/${r.id}`} className="btn-secondary" style={{ padding: "6px 10px", fontSize: 12 }}>
                  Open
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
