import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import RollActions from "./RollActions";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_COLORS: Record<string, string> = {
  uploaded: "var(--paper-mute, #6a7692)",
  parsing:  "var(--gold, #C8A032)",
  parsed:   "var(--gold, #C8A032)",
  applying: "var(--gold, #C8A032)",
  applied:  "var(--green, #1F7A4D)",
  failed:   "var(--amber, #D17E22)",
};

export default async function ValuationRollDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("app_user").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/dashboard");

  const { data: upload } = await supabase
    .from("valuation_roll_upload")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!upload) notFound();
  const u = upload as any;

  const sample = (u.preview_json?.sample ?? []) as any[];
  const byTown = (u.preview_json?.by_town ?? {}) as Record<string, number>;
  const bySec78 = (u.preview_json?.by_sec_78 ?? {}) as Record<string, number>;
  const markers = u.preview_json?.markers ?? 0;

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">
            <Link href="/admin/valuation-rolls" style={{ color: "inherit" }}>
              Valuation rolls
            </Link>{" "}
            · Detail
          </p>
          <h1>
            {u.kind === "full_gv" ? "Full General Valuation Roll" : `Supplementary Roll ${u.supplement_number ?? "?"}`}
          </h1>
          <p className="app-sub">
            <span
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: STATUS_COLORS[u.status] ?? "var(--paper-mute)",
                fontWeight: 600,
                marginRight: 12,
              }}
            >
              {u.status}
            </span>
            <span style={{ color: "var(--paper-mute, #6a7692)" }}>
              {u.file_name} · uploaded {u.uploaded_at.slice(0, 10)}
              {u.page_count ? ` · ${u.page_count} pages` : ""}
              {u.parsed_row_count ? ` · ${u.parsed_row_count.toLocaleString()} rows parsed` : ""}
              {u.applied_row_count ? ` · ${u.applied_row_count.toLocaleString()} applied` : ""}
            </span>
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <RollActions id={u.id} status={u.status} />

          {u.parse_error && (
            <div
              style={{
                marginTop: 24,
                padding: 12,
                borderRadius: 3,
                border: "1px solid var(--amber, #D17E22)",
                background: "#fef5ec",
                fontSize: 13,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                color: "var(--amber, #D17E22)",
                whiteSpace: "pre-wrap",
              }}
            >
              <strong>Error:</strong> {u.parse_error}
            </div>
          )}

          {u.preview_json && (
            <>
              <div style={{ marginTop: 32 }}>
                <h2
                  style={{
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 11,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--estuary, #132B84)",
                    margin: "0 0 12px",
                  }}
                >
                  Parse preview
                </h2>
                <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginBottom: 20 }}>
                  <Stat label="Rows parsed" value={u.parsed_row_count?.toLocaleString() ?? "—"} />
                  <Stat label="Pages" value={u.page_count?.toLocaleString() ?? "—"} />
                  <Stat label="Marker rows" value={markers.toLocaleString()} />
                </div>

                {Object.keys(byTown).length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <MiniHeading>By town</MiniHeading>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {Object.entries(byTown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([town, count]) => (
                          <span key={town} style={pillStyle}>
                            {town} · {count.toLocaleString()}
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                {Object.keys(bySec78).length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <MiniHeading>By Sec 78</MiniHeading>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {Object.entries(bySec78)
                        .sort((a, b) => b[1] - a[1])
                        .map(([sec, count]) => (
                          <span key={sec} style={pillStyle}>
                            {sec} · {count}
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                <MiniHeading>Sample rows (first {sample.length})</MiniHeading>
                <div style={{ overflowX: "auto", border: "1px solid var(--hairline, #e2e8f5)", borderRadius: 3 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                    <thead>
                      <tr style={{ background: "var(--paper-bg, #f5f1e8)", textAlign: "left" }}>
                        {u.kind === "full_gv" ? (
                          <>
                            <Th>Erf</Th><Th>Town</Th><Th>Category</Th><Th>Address</Th><Th>Owner</Th><Th>m²</Th><Th style={{ textAlign: "right" }}>Value</Th><Th>Comment</Th>
                          </>
                        ) : (
                          <>
                            <Th>SG</Th><Th>Erf</Th><Th>Town</Th><Th>Sec 78</Th><Th>Eff date</Th><Th>Address</Th><Th style={{ textAlign: "right" }}>Value</Th><Th>Note</Th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {sample.map((r: any, i: number) => (
                        <tr key={i} style={{ borderTop: "1px solid var(--hairline, #e2e8f5)" }}>
                          {u.kind === "full_gv" ? (
                            <>
                              <Td>{r.erf_number}</Td>
                              <Td>{r.town}</Td>
                              <Td>{r.category}</Td>
                              <Td>{[r.street_no, r.street].filter(Boolean).join(" ")}</Td>
                              <Td>{r.owner ?? "—"}</Td>
                              <Td>{r.land_sqm ?? "—"}</Td>
                              <Td style={{ textAlign: "right", fontWeight: 600 }}>{r.valuation != null ? `R ${r.valuation.toLocaleString("en-ZA")}` : (r.is_marker ? "marker" : "—")}</Td>
                              <Td>{r.comment ?? "—"}</Td>
                            </>
                          ) : (
                            <>
                              <Td style={{ fontSize: 10 }}>{(r.sg_number ?? "").slice(0, 20)}…</Td>
                              <Td>{r.erf_number}</Td>
                              <Td>{r.town}</Td>
                              <Td>{r.sec_78 ?? "—"}</Td>
                              <Td>{r.effective_date ?? "—"}</Td>
                              <Td>{r.street ?? "—"}</Td>
                              <Td style={{ textAlign: "right", fontWeight: 600 }}>{r.valuation != null ? `R ${r.valuation.toLocaleString("en-ZA")}` : (r.is_marker ? "marker" : "—")}</Td>
                              <Td>{r.note ?? r.comment ?? "—"}</Td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}

const pillStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 3,
  background: "var(--paper-bg, #f5f1e8)",
  border: "1px solid var(--hairline, #e2e8f5)",
  color: "var(--estuary, #132B84)",
};

function MiniHeading({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: "0 0 6px", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--gold, #C8A032)" }}>
      {children}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--paper-mute, #6a7692)" }}>{label}</p>
      <p style={{ margin: 0, fontSize: 20, fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: "var(--estuary, #132B84)" }}>{value}</p>
    </div>
  );
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <th style={{ padding: "6px 8px", fontWeight: 600, fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", ...style }}>{children}</th>;
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "6px 8px", verticalAlign: "top", ...style }}>{children}</td>;
}
