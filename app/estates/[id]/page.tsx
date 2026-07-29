import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// One estate's document vault. Documents live here two ways:
//   1. Direct estate binding — document.estate_id = this estate.
//   2. Property binding — document_link.entity_type='property' where
//      the property belongs to this estate. Not shown here for now;
//      those docs belong on the individual property records. This
//      vault surfaces estate-level artefacts only.
//
// Docs grouped by doc_type so an agent scanning for "the design
// manual" or "the plant list" finds them without scrolling a flat
// list. Storage URLs signed on the server so no public exposure.

const GROUP_ORDER = [
  "estate_design_manual",
  "estate_rules",
  "estate_general_info",
  "estate_plant_list",
  "disturbance_area",
  "architectural_plan",
  "concept_plan",
  "boundary_relaxation",
  "email_thread",
];

const GROUP_LABEL: Record<string, string> = {
  estate_design_manual:  "Architectural Design Manuals",
  estate_rules:          "Rules & Regulations",
  estate_general_info:   "General Information",
  estate_plant_list:     "Plant Lists",
  disturbance_area:      "Disturbance Area Plans",
  architectural_plan:    "Architectural Plans",
  concept_plan:          "Concept Plans",
  boundary_relaxation:   "Boundary Relaxations",
  email_thread:          "Email Correspondence",
  other:                 "Other",
};

export default async function EstateVaultPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: estate } = await supabase
    .from("estate")
    .select("id, name, kind, hoa_name, hoa_contact, levy_notes, notes, suburb:suburb_id(name)")
    .eq("id", params.id)
    .single();
  if (!estate) notFound();

  const { data: docs } = await supabase
    .from("document")
    .select("id, title, doc_type_id, storage_bucket, storage_path, mime_type, byte_size, is_pii, created_at, doc_type:doc_type_id(code, label, category)")
    .eq("estate_id", params.id)
    .order("created_at", { ascending: false });

  const rows = (docs ?? []) as any[];

  // Sign URLs in parallel for all docs. 5-minute expiry — matches the
  // triage doc-chip pattern.
  const signed = await Promise.all(
    rows.map(async (d) => {
      const bucket = d.storage_bucket ?? "documents";
      const path = d.storage_path;
      if (!path) return { ...d, url: null };
      const { data: urlData } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
      return { ...d, url: urlData?.signedUrl ?? null };
    }),
  );

  // Group by doc_type.code. Unknown / null types land in "other".
  const groups = new Map<string, any[]>();
  for (const d of signed) {
    const code = d.doc_type?.code ?? "other";
    const arr = groups.get(code) ?? [];
    arr.push(d);
    groups.set(code, arr);
  }
  const orderedCodes = [
    ...GROUP_ORDER.filter((c) => groups.has(c)),
    ...Array.from(groups.keys()).filter((c) => !GROUP_ORDER.includes(c)),
  ];

  const propertyCountResult = await supabase
    .from("property")
    .select("id", { count: "exact", head: true })
    .eq("estate_id", params.id);
  const propertyCount = propertyCountResult.count ?? 0;

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">
            Dream Knysna · Estate vault ·{" "}
            <Link href="/estates" style={{ color: "var(--gold)", fontWeight: 600 }}>All estates</Link>
          </p>
          <h1>{estate.name}</h1>
          <p className="app-sub" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12 }}>
            {estate.kind.replace(/_/g, " ")}
            {(() => {
              const s = Array.isArray(estate.suburb) ? estate.suburb[0] : estate.suburb;
              return s?.name ? ` · ${s.name}` : "";
            })()}
            {estate.hoa_name && ` · HOA: ${estate.hoa_name}`}
            {` · ${rows.length} doc${rows.length === 1 ? "" : "s"}`}
            {` · ${propertyCount} propert${propertyCount === 1 ? "y" : "ies"}`}
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          {(estate.hoa_contact || estate.levy_notes || estate.notes) && (
            <div
              style={{
                padding: "12px 16px",
                background: "var(--paper-1, #F5F1E8)",
                border: "1px solid var(--line-soft, #E7E0D2)",
                borderRadius: 6,
                marginBottom: 20,
              }}
            >
              <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0, fontSize: 12 }}>
                {estate.hoa_contact && (
                  <>
                    <dt style={dtStyle}>HOA contact</dt>
                    <dd style={{ margin: 0 }}>{estate.hoa_contact}</dd>
                  </>
                )}
                {estate.levy_notes && (
                  <>
                    <dt style={dtStyle}>Levies</dt>
                    <dd style={{ margin: 0 }}>{estate.levy_notes}</dd>
                  </>
                )}
                {estate.notes && (
                  <>
                    <dt style={dtStyle}>Notes</dt>
                    <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{estate.notes}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {rows.length === 0 ? (
            <p style={{ color: "var(--paper-mute, #6a7692)", fontStyle: "italic", padding: "24px 0" }}>
              No documents filed on this estate yet. Route batches here from /triage (coming soon) or attach docs manually with <code>document.estate_id</code>.
            </p>
          ) : (
            orderedCodes.map((code) => {
              const docs = groups.get(code) ?? [];
              if (docs.length === 0) return null;
              return (
                <div key={code} style={{ marginTop: 24 }}>
                  <div style={{ borderLeft: "3px solid var(--gold, #C8A032)", paddingLeft: 12, marginBottom: 8 }}>
                    <h2
                      style={{
                        margin: 0,
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        fontSize: 11,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: "var(--estuary, #132B84)",
                      }}
                    >
                      {GROUP_LABEL[code] ?? code} · {docs.length}
                    </h2>
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    {docs.map((d) => (
                      <li
                        key={d.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto auto",
                          gap: 12,
                          alignItems: "center",
                          padding: "8px 0",
                          borderBottom: "1px solid var(--line-soft, #E7E0D2)",
                        }}
                      >
                        <div>
                          {d.url ? (
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: 13, color: "var(--estuary, #132B84)", fontWeight: 500 }}
                            >
                              {d.title}
                            </a>
                          ) : (
                            <span style={{ fontSize: 13, color: "var(--paper-mute, #6a7692)", fontStyle: "italic" }}>
                              {d.title} (no file)
                            </span>
                          )}
                          {d.is_pii && (
                            <span
                              style={{
                                marginLeft: 8,
                                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                                fontSize: 9,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                padding: "1px 6px",
                                background: "var(--status-withdrawn-bg)",
                                color: "var(--status-withdrawn-fg)",
                                borderRadius: 2,
                                fontWeight: 600,
                              }}
                            >
                              PII
                            </span>
                          )}
                        </div>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            fontSize: 10,
                            color: "var(--paper-mute, #6a7692)",
                          }}
                        >
                          {d.byte_size ? `${(d.byte_size / 1024).toFixed(0)} KB` : ""}
                        </span>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            fontSize: 10,
                            color: "var(--paper-mute, #6a7692)",
                          }}
                        >
                          {d.created_at?.slice(0, 10)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>
      </main>
    </>
  );
}

const dtStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--paper-mute, #6a7692)",
  whiteSpace: "nowrap",
};
