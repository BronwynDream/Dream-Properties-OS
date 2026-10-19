import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import ResolveButton from "./ResolveButton";

// Admin → Reports (2026-10-19, migration 0089). What agents flagged with
// "Report a problem", and errors captured automatically. Directors only.

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  created_at: string;
  kind: "report" | "error";
  message: string;
  path: string | null;
  details: Record<string, unknown> | null;
  resolved_at: string | null;
  who: { full_name: string | null; email: string | null } | null;
};

const when = (s: string) =>
  new Date(s).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function device(d: Record<string, unknown> | null) {
  const ua = String(d?.userAgent ?? "");
  const kind = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "";
  return [kind, d?.standalone ? "home-screen app" : null, d?.viewport].filter(Boolean).join(" · ");
}

export default async function ReportsPage({ searchParams }: { searchParams: { show?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("app_user").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") redirect("/dashboard");

  const show = searchParams.show === "errors" ? "errors" : searchParams.show === "done" ? "done" : "open";
  let q = supabase
    .from("app_feedback")
    .select("id, created_at, kind, message, path, details, resolved_at, who:user_id(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (show === "done") q = q.not("resolved_at", "is", null);
  else q = q.is("resolved_at", null);
  if (show === "errors") q = q.eq("kind", "error");
  if (show === "open") q = q.eq("kind", "report");
  const { data, error } = await q;
  const rows = (data ?? []) as unknown as Row[];

  const { count: openReports } = await supabase.from("app_feedback").select("id", { count: "exact", head: true }).is("resolved_at", null).eq("kind", "report");
  const { count: openErrors } = await supabase.from("app_feedback").select("id", { count: "exact", head: true }).is("resolved_at", null).eq("kind", "error");

  return (
    <>
      <TopBar />
      <main className="reports-wrap">
        <header className="page-head">
          <p className="eyebrow">Admin</p>
          <h1>Reports</h1>
          <p className="report-sub">What the team flagged with “Report a problem”, and errors the system caught on its own.</p>
        </header>
        <nav className="reports-tabs" aria-label="Show">
          <Link href="/admin/reports" className={show === "open" ? "on" : ""}>Reported ({openReports ?? 0})</Link>
          <Link href="/admin/reports?show=errors" className={show === "errors" ? "on" : ""}>Errors ({openErrors ?? 0})</Link>
          <Link href="/admin/reports?show=done" className={show === "done" ? "on" : ""}>Done</Link>
        </nav>
        {error ? (
          <p className="adddocs-err">Couldn&apos;t load reports: {error.message}. Has migration 0089 been applied?</p>
        ) : rows.length === 0 ? (
          <p className="reports-empty">{show === "done" ? "Nothing marked done yet." : show === "errors" ? "No errors caught. Good." : "Nothing reported yet."}</p>
        ) : (
          <ul className="reports-list" role="list">
            {rows.map((r) => {
              const d = r.details ?? {};
              const count = Number(d.count ?? 1);
              const recent = Array.isArray(d.recentErrors) ? (d.recentErrors as string[]) : [];
              return (
                <li key={r.id} className={`reports-item${r.resolved_at ? " done" : ""}`}>
                  <div className="reports-row">
                    <div className="reports-meta">
                      <span className={`reports-kind ${r.kind}`}>{r.kind === "error" ? "Error" : "Reported"}</span>
                      <span>{when(r.created_at)}</span>
                      <span>{r.who?.full_name ?? r.who?.email ?? "Someone"}</span>
                      {count > 1 && <span>×{count}</span>}
                    </div>
                    <ResolveButton id={r.id} done={!!r.resolved_at} />
                  </div>
                  <p className="reports-msg">{r.message}</p>
                  <div className="reports-meta">
                    {r.path && r.path.startsWith("/") && !r.path.startsWith("//") && (
                      <Link href={r.path} style={{ color: "var(--navy)" }}>
                        {r.path}
                      </Link>
                    )}
                    {device(d) && <span>{device(d)}</span>}
                    {d.deploy ? <span>build {String(d.deploy)}</span> : null}
                  </div>
                  {(d.stack || recent.length > 0) && (
                    <details>
                      <summary>Technical detail</summary>
                      {recent.length > 0 && <pre>{"Recent errors on that page:\n" + recent.join("\n")}</pre>}
                      {d.stack ? <pre>{String(d.stack)}</pre> : null}
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
