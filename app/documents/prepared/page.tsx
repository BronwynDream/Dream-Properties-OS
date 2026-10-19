import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";

// Prepared documents (2026-10-19). This list used to be the Documents
// landing page; Simon: coming in from the menu you should be asked what to
// make, not shown what's been made. The start page is /documents; this is
// the history, one link away.
//
// RLS on document_draft already scopes agents to their own drafts and the
// transfers they lead; admins see everything.

export const dynamic = "force-dynamic";

type DraftRow = {
  id: string;
  title: string | null;
  status: "draft" | "final" | "superseded";
  created_at: string;
  finalised_at: string | null;
  signed_document_id: string | null;
  property_id: string | null;
  template: { code: string; label: string } | { code: string; label: string }[] | null;
  property: { primary_address: string | null } | { primary_address: string | null }[] | null;
  author: { full_name: string | null } | { full_name: string | null }[] | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
}

export default async function PreparedDocuments() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: draftsData } = await supabase
    .from("document_draft")
    .select("id, title, status, created_at, finalised_at, signed_document_id, property_id, template:template_id(code, label), property:property_id(primary_address), author:created_by(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  const drafts = (draftsData ?? []) as unknown as DraftRow[];

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 12 };

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">
            <Link href="/documents" style={{ color: "inherit" }}>Documents</Link> · Prepared
          </p>
          <h1>Prepared documents</h1>
          <p className="app-sub">
            Every document prepared from Bronwyn&apos;s templates, newest first. To make a new one,
            go back to <Link href="/documents">Documents</Link>.
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          {drafts.length === 0 ? (
            <p style={{ color: "var(--paper-mute)", fontStyle: "italic", padding: "12px 0 24px" }}>
              Nothing prepared yet. <Link href="/documents">Prepare a document</Link>.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 32px", display: "grid", gap: 6 }}>
              {drafts.map((d) => {
                const tpl = one(d.template);
                const prop = one(d.property);
                const author = one(d.author);
                return (
                  <li
                    key={d.id}
                    className="doc-row"
                    style={{
                      border: "1px solid var(--hairline, #e2e8f5)",
                      borderRadius: 3,
                      padding: "10px 14px",
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) auto auto",
                      gap: 16,
                      alignItems: "center",
                      background: "var(--white)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tpl?.label ?? "Document"}
                      </div>
                      {d.property_id ? (
                        <Link href={`/properties/${d.property_id}`} style={{ ...mono, color: "var(--navy)" }}>
                          {prop?.primary_address ?? "Property"}
                        </Link>
                      ) : (
                        <span style={{ ...mono, color: "var(--paper-mute)" }}>No property</span>
                      )}
                    </div>
                    <div style={{ ...mono, color: "var(--paper-mute)" }}>
                      {author?.full_name ?? "—"} · {fmtDate(d.created_at)}
                    </div>
                    <StatusPill status={d.signed_document_id ? "signed" : d.status} />
                    <Link href={`/documents/${d.id}`} className="btn-secondary" style={{ padding: "6px 10px", fontSize: 12 }}>
                      Open
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

        </section>
      </main>
    </>
  );
}

function StatusPill({ status }: { status: DraftRow["status"] | "signed" }) {
  const map = {
    signed: { label: "Signed", color: "var(--positive)" },
    draft: { label: "Draft", color: "var(--caution)" },
    final: { label: "Final", color: "var(--positive)" },
    superseded: { label: "Superseded", color: "var(--ink-400)" },
  }[status];
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: map.color,
        border: `1px solid ${map.color}`,
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {map.label}
    </span>
  );
}
