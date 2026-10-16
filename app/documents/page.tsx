import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";

// Documents hub (plan 019 Arc A3). Two things an agent asks:
//   "what have we generated?"  → every document_draft they can see, newest
//                                first, with the property it belongs to
//   "what can I prepare?"      → the active templates in the clause library
//
// RLS on document_draft already scopes agents to their own drafts and the
// transfers they lead; admins see everything. Templates are staff-readable.
//
// Drafts open back into their editor in A4; until then a row links to the
// property record, where the mandate it produced is visible.

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

type TemplateRow = { code: string; label: string; description: string | null; requires_purchaser: boolean };

const PREPARE_HREF: Record<string, (propertyId: string) => string> = {
  mandate_exclusive: (id) => `/properties/${id}/documents/mandate/new?type=exclusive`,
  mandate_joint: (id) => `/properties/${id}/documents/mandate/new?type=joint`,
  mandate_open: (id) => `/properties/${id}/documents/mandate/new?type=open`,
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
}

export default async function DocumentsHub() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: draftsData }, { data: templatesData }] = await Promise.all([
    supabase
      .from("document_draft")
      .select("id, title, status, created_at, finalised_at, signed_document_id, property_id, template:template_id(code, label), property:property_id(primary_address), author:created_by(full_name)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("doc_template")
      .select("code, label, description, requires_purchaser")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
  ]);
  const drafts = (draftsData ?? []) as unknown as DraftRow[];
  const templates = (templatesData ?? []) as TemplateRow[];

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 12 };

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Deals · Documents</p>
          <h1>Documents</h1>
          <p className="app-sub">
            Everything generated from Bronwyn&apos;s templates, and the templates themselves. A
            document is prepared from the property it belongs to, so the record fills what it can
            before you are asked for the rest.
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <h2 style={sectionHead}>Generated</h2>
          {drafts.length === 0 ? (
            <p style={{ color: "var(--paper-mute)", fontStyle: "italic", padding: "12px 0 24px" }}>
              Nothing generated yet. Open a property and choose <b>Prepare mandate…</b>.
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

          <h2 style={sectionHead}>Templates</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {templates.map((t) => (
              <li
                key={t.code}
                style={{
                  border: "1px solid var(--hairline, #e2e8f5)",
                  borderRadius: 3,
                  padding: "10px 14px",
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: 16,
                  alignItems: "center",
                  background: "var(--white)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{t.label}</div>
                  {t.description && (
                    <div style={{ fontSize: 13, color: "var(--ink-700)", marginTop: 2 }}>{t.description}</div>
                  )}
                </div>
                <span style={{ ...mono, color: "var(--paper-mute)", whiteSpace: "nowrap" }}>
                  {PREPARE_HREF[t.code]
                    ? "Prepare from a property record"
                    : t.requires_purchaser
                    ? "Prepare from a property record with a deal"
                    : "Prepare from a property record"}
                </span>
              </li>
            ))}
          </ul>
          <p style={{ ...mono, color: "var(--paper-mute)", marginTop: 20 }}>
            Templates are Bronwyn&apos;s 2026 masters, clause by clause. Wording changes are made in
            the clause library by an admin, never on a single document.
          </p>
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

const sectionHead: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--estuary, #132B84)",
  margin: "24px 0 12px",
};
