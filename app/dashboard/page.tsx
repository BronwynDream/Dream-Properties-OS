import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";

export const dynamic = "force-dynamic";

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.floor((now - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d ago`;
  const mo = Math.floor(d / 30);
  return `${mo} mo ago`;
}

export default async function Dashboard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("app_user")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  const name = profile?.full_name?.split(" ")[0] ?? user.email;

  // KPI counts (parallel).
  const [propCount, transferCount, inConveyancing, liveListings, recentBatches] =
    await Promise.all([
      supabase.from("property").select("id", { head: true, count: "exact" }),
      supabase.from("transfer").select("id", { head: true, count: "exact" }),
      supabase
        .from("transfer")
        .select("id", { head: true, count: "exact" })
        .eq("status", "in_conveyancing"),
      supabase
        .from("listing")
        .select("id", { head: true, count: "exact" })
        .eq("status", "live"),
      supabase
        .from("ingest_batch")
        .select("id, label, status, tier, property_id, created_at")
        .eq("status", "committed")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

  const kpis = [
    {
      label: "Properties",
      value: propCount.count ?? 0,
      link: "/properties",
      linkLabel: "Property database →",
    },
    {
      label: "Transfers",
      value: transferCount.count ?? 0,
      link: "/properties",
      linkLabel: "Browse →",
    },
    {
      label: "In conveyancing",
      value: inConveyancing.count ?? 0,
      link: "/properties",
      linkLabel: "Open deals →",
    },
    {
      label: "Live listings",
      value: liveListings.count ?? 0,
      link: "/map",
      linkLabel: "See on map →",
    },
  ];

  const batches = recentBatches.data ?? [];

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="page-head">
          <div>
            <p className="eyebrow">Overview · Dream Knysna</p>
            <h1>Good to see you, {name}.</h1>
            <p className="sub">
              Live database, live map, live pipeline. Everything from here flows into the
              same record.
            </p>
          </div>
          <Link href="/triage" className="cta">
            Open triage →
          </Link>
        </div>

        <div className="kpi-grid">
          {kpis.map((k) => (
            <div key={k.label} className="kpi-tile">
              <p className="label">{k.label}</p>
              <p className="value">{k.value}</p>
              <p className="foot">
                <Link href={k.link}>{k.linkLabel}</Link>
              </p>
            </div>
          ))}
        </div>

        <div className="section-head">
          <h2>Recent activity</h2>
          <Link href="/triage" className="link">
            All batches →
          </Link>
        </div>

        {batches.length === 0 ? (
          <p style={{ color: "#5b6885", fontSize: 14 }}>
            No committed batches yet. Drop a folder in Triage and it will land here once
            you commit.
          </p>
        ) : (
          <div className="activity-list">
            {batches.map((b) => (
              <div className="activity-row" key={b.id}>
                <div className="when">{timeAgo(b.created_at)}</div>
                <div className="what">
                  <b>{b.label}</b> committed
                  {b.tier && (
                    <>
                      {" "}
                      <span className={`tier tier-${b.tier}`}>{b.tier}</span>
                    </>
                  )}
                </div>
                <div className="who">
                  {b.property_id ? (
                    <Link
                      href={`/properties/${b.property_id}`}
                      className="row-link"
                      style={{ fontWeight: 600 }}
                    >
                      Open record →
                    </Link>
                  ) : (
                    <span style={{ color: "#9aa6c4" }}>—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!profile && (
          <p className="error" style={{ marginTop: 24 }}>
            No <code>app_user</code> row found for this account. Seed one so your role
            resolves.
          </p>
        )}
      </main>
    </>
  );
}
