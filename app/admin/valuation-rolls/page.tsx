import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Upload = {
  id: string;
  kind: string;
  supplement_number: number | null;
  effective_period_start: string | null;
  effective_period_end: string | null;
  file_name: string;
  file_size_bytes: number | null;
  page_count: number | null;
  parsed_row_count: number | null;
  applied_row_count: number | null;
  status: string;
  parse_error: string | null;
  uploaded_at: string;
  applied_at: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  uploaded: "var(--paper-mute, #6a7692)",
  parsing:  "var(--gold, #C8A032)",
  parsed:   "var(--gold, #C8A032)",
  applying: "var(--gold, #C8A032)",
  applied:  "var(--green, #1F7A4D)",
  failed:   "var(--amber, #D17E22)",
};

function fmtBytes(n: number | null): string {
  if (!n) return "—";
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export default async function ValuationRollsIndex() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("app_user").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/dashboard");

  const { data: uploadsData } = await supabase
    .from("valuation_roll_upload")
    .select("*")
    .order("uploaded_at", { ascending: false });
  const uploads = (uploadsData ?? []) as Upload[];

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Admin · Valuation Rolls</p>
          <h1>Municipal valuation roll uploads</h1>
          <p className="app-sub">
            Upload Knysna Municipality PDFs — Full General Valuation Roll (5-yearly baseline)
            and Supplementary Rolls (deltas between GVs). Data flows into{" "}
            <code style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>muni_property</code>{" "}
            +{" "}
            <code style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>muni_valuation</code>,
            visible on the map, in Erf Lookup, and on Property Records.
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <div style={{ marginBottom: 32 }}>
            <h2
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--estuary, #132B84)",
                margin: "24px 0 12px",
              }}
            >
              New upload
            </h2>
            <UploadForm />
          </div>

          <div>
            <h2
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--estuary, #132B84)",
                margin: "24px 0 12px",
              }}
            >
              History
            </h2>
            {uploads.length === 0 ? (
              <p style={{ color: "var(--paper-mute, #6a7692)", fontStyle: "italic", padding: "24px 0" }}>
                No uploads yet. Upload the Full GV first as the baseline, then add supplements as they're issued.
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {uploads.map((u) => (
                  <li
                    key={u.id}
                    style={{
                      border: "1px solid var(--hairline, #e2e8f5)",
                      borderRadius: 3,
                      padding: 12,
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto auto",
                      gap: 16,
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        width: 90,
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        fontSize: 10,
                        letterSpacing: "0.10em",
                        textTransform: "uppercase",
                        color: STATUS_COLORS[u.status] ?? "var(--paper-mute)",
                        fontWeight: 600,
                      }}
                    >
                      {u.status}
                    </div>
                    <div>
                      <Link
                        href={`/admin/valuation-rolls/${u.id}`}
                        style={{
                          fontFamily: "'Fraunces', 'Cormorant Garamond', serif",
                          fontSize: 16,
                          color: "var(--estuary, #132B84)",
                          textDecoration: "none",
                          fontWeight: 500,
                        }}
                      >
                        {u.kind === "full_gv"
                          ? "Full General Valuation Roll"
                          : `Supplementary Roll ${u.supplement_number ?? "?"}`}
                      </Link>
                      <p
                        style={{
                          margin: "2px 0 0",
                          fontSize: 11,
                          color: "var(--paper-mute, #6a7692)",
                          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        }}
                      >
                        {u.file_name} · {fmtBytes(u.file_size_bytes)}
                        {u.page_count ? ` · ${u.page_count} pages` : ""}
                        {u.parsed_row_count ? ` · ${u.parsed_row_count.toLocaleString()} rows parsed` : ""}
                        {u.applied_row_count ? ` · ${u.applied_row_count.toLocaleString()} applied` : ""}
                      </p>
                    </div>
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        fontSize: 11,
                        color: "var(--paper-mute, #6a7692)",
                        textAlign: "right",
                      }}
                    >
                      {u.uploaded_at.slice(0, 10)}
                    </div>
                    <Link
                      href={`/admin/valuation-rolls/${u.id}`}
                      style={{
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        fontSize: 11,
                        letterSpacing: "0.10em",
                        textTransform: "uppercase",
                        color: "var(--estuary, #132B84)",
                        textDecoration: "none",
                        padding: "4px 10px",
                        border: "1px solid var(--estuary, #132B84)",
                        borderRadius: 3,
                      }}
                    >
                      Open →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
