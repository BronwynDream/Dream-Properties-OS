import type { SupabaseClient } from "@supabase/supabase-js";
import { FEEDS, feedLight, type FeedKey, type FeedLatest, type Light } from "@/lib/feeds/registry";

// The morning health email (2026-10-20). Simon: "how do we set up a dream OS
// daily health check?" — collect() reads the same sources as Admin → Data
// Health; render() turns them into one short email with a verdict line on top.

export type ListingMove = { address: string; suburb: string | null; price: number | null };
export type FeedLine = { key: FeedKey; label: string; light: Light; lastRun: string | null; status: string | null; error: string | null };
export type DailyData = {
  generatedAt: string;
  feeds: FeedLine[];
  dream: { active: number; added: ListingMove[]; withdrawn: ListingMove[] };
  p24: { active: number; added: number; withdrawn: number; queuePending: number; queueTotal: number; missingCoords: number };
  reports: { who: string; message: string; path: string | null }[];
  errors: { message: string; path: string | null; count: number }[];
  feedbackTableMissing?: boolean;
};

const DAY = 24 * 60 * 60 * 1000;

export async function collect(svc: SupabaseClient, now = new Date()): Promise<DailyData> {
  const since = new Date(now.getTime() - DAY).toISOString();
  const pick = "address_raw, suburb, price";
  const [latestRes, dwActive, dwAdded, dwGone, p24Active, p24Added, p24Gone, qPending, qTotal, p24Missing, fb] = await Promise.all([
    svc.from("v_feed_latest").select("feed, status, trigger, started_at, finished_at, items, error"),
    svc.from("external_listing").select("id", { count: "exact", head: true }).eq("source", "dream_website").eq("active", true),
    svc.from("external_listing").select(pick).eq("source", "dream_website").gte("first_seen", since).limit(20),
    svc.from("external_listing").select(pick).eq("source", "dream_website").eq("active", false).gte("updated_at", since).limit(20),
    svc.from("external_listing").select("id", { count: "exact", head: true }).eq("source", "property24").eq("active", true),
    svc.from("external_listing").select("id", { count: "exact", head: true }).eq("source", "property24").gte("first_seen", since),
    svc.from("external_listing").select("id", { count: "exact", head: true }).eq("source", "property24").eq("active", false).gte("updated_at", since),
    svc.from("property24_url_queue").select("url", { count: "exact", head: true }).is("processed_at", null),
    svc.from("property24_url_queue").select("url", { count: "exact", head: true }),
    svc.from("external_listing").select("id", { count: "exact", head: true }).eq("source", "property24").eq("active", true).is("lat", null),
    svc.from("app_feedback").select("kind, message, path, details, who:user_id(full_name, email)").gte("created_at", since).is("resolved_at", null).order("created_at", { ascending: false }).limit(50),
  ]);

  const latest = new Map<string, FeedLatest>();
  for (const r of (latestRes.data ?? []) as FeedLatest[]) latest.set(r.feed, r);
  const feeds: FeedLine[] = FEEDS.filter((f) => !f.planned).map((f) => {
    const l = latest.get(f.key);
    return { key: f.key, label: f.label, light: feedLight(f, l, now.getTime()), lastRun: l?.finished_at ?? l?.started_at ?? null, status: l?.status ?? null, error: l?.error ?? null };
  });

  const moves = (r: { data: unknown }) =>
    ((r.data ?? []) as { address_raw: string | null; suburb: string | null; price: number | null }[]).map((x) => ({
      address: x.address_raw ?? "Address not given",
      suburb: x.suburb,
      price: x.price,
    }));
  const n = (r: { count: number | null }) => r.count ?? 0;

  type Fb = { kind: string; message: string; path: string | null; details: { count?: number } | null; who: { full_name: string | null; email: string | null } | null };
  const fbRows = (fb.data ?? []) as unknown as Fb[];

  return {
    generatedAt: now.toISOString(),
    feeds,
    dream: { active: n(dwActive), added: moves(dwAdded), withdrawn: moves(dwGone) },
    p24: { active: n(p24Active), added: n(p24Added), withdrawn: n(p24Gone), queuePending: n(qPending), queueTotal: n(qTotal), missingCoords: n(p24Missing) },
    reports: fbRows.filter((r) => r.kind === "report").map((r) => ({ who: r.who?.full_name ?? r.who?.email ?? "Someone", message: r.message, path: r.path })),
    errors: fbRows.filter((r) => r.kind === "error").map((r) => ({ message: r.message, path: r.path, count: Number(r.details?.count ?? 1) })),
    feedbackTableMissing: !!fb.error,
  };
}

// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rand = (p: number | null) => (p == null ? "" : "R " + Math.round(p).toLocaleString("en-ZA").replace(/,/g, " ").replace(/ /g, " "));
const ago = (iso: string | null, now: number) => {
  if (!iso) return "never run";
  const h = (now - Date.parse(iso)) / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
};
const DOT: Record<Light, string> = { green: "#3D7A4E", amber: "#9A6A1A", red: "#B9431F", grey: "#6B7490" };
const WORD: Record<Light, string> = { green: "OK", amber: "Late", red: "Problem", grey: "Never run" };

export function attention(d: DailyData): string[] {
  const out: string[] = [];
  for (const f of d.feeds) {
    if (f.light === "red") out.push(`${f.label}: ${f.status === "error" ? `last run failed${f.error ? ` (${f.error.slice(0, 120)})` : ""}` : `hasn't run since ${ago(f.lastRun, Date.parse(d.generatedAt))}`}`);
    else if (f.light === "amber") out.push(`${f.label}: ${f.status === "partial" ? "last run only partly finished" : `last ran ${ago(f.lastRun, Date.parse(d.generatedAt))}`}`);
    else if (f.light === "grey") out.push(`${f.label}: has never run`);
  }
  if (d.reports.length) out.push(`${d.reports.length} problem${d.reports.length === 1 ? "" : "s"} reported by the team`);
  const errN = d.errors.reduce((a, e) => a + e.count, 0);
  if (errN) out.push(`${errN} error${errN === 1 ? "" : "s"} caught on ${d.errors.length} page${d.errors.length === 1 ? "" : "s"}`);
  return out;
}

export function render(d: DailyData, siteUrl: string) {
  const now = Date.parse(d.generatedAt);
  const issues = attention(d);
  const verdict = issues.length === 0 ? "All good" : `${issues.length} thing${issues.length === 1 ? "" : "s"} need${issues.length === 1 ? "s" : ""} attention`;
  const dateStr = new Date(now).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Johannesburg" });
  const subject = `Dream OS · ${verdict} · ${new Date(now).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" })}`;

  const h2 = (t: string) => `<h2 style="margin:28px 0 10px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#122E87">${t}</h2>`;
  const p = (t: string, extra = "") => `<p style="margin:0 0 8px;font-size:15px;line-height:1.55;${extra}">${t}</p>`;
  const mono = "font-family:SFMono-Regular,Menlo,Consolas,monospace";
  const list = (rows: ListingMove[]) =>
    rows.length
      ? `<ul style="margin:0 0 8px;padding-left:18px;font-size:14px;line-height:1.6">${rows
          .map((r) => `<li>${esc(r.address)}${r.suburb ? `, ${esc(r.suburb)}` : ""}${r.price ? ` — <span style="${mono}">${rand(r.price)}</span>` : ""}</li>`)
          .join("")}</ul>`
      : "";

  const feedRows = d.feeds
    .map(
      (f) => `<tr>
  <td style="padding:8px 0;border-top:1px solid #DEE3EF;width:18px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${DOT[f.light]}"></span></td>
  <td style="padding:8px 8px 8px 0;border-top:1px solid #DEE3EF;font-size:14px">${esc(f.label)}</td>
  <td style="padding:8px 8px 8px 0;border-top:1px solid #DEE3EF;font-size:13px;color:${DOT[f.light]};font-weight:600">${WORD[f.light]}</td>
  <td style="padding:8px 0;border-top:1px solid #DEE3EF;font-size:13px;color:#6B7490;text-align:right">${ago(f.lastRun, now)}</td>
</tr>`,
    )
    .join("");

  const p24 = d.p24;
  const p24Line =
    p24.queuePending > 0
      ? `${p24.queuePending} of ${p24.queueTotal} Property24 listings still waiting to be read. They're worked through each day.`
      : `Property24 is up to date — every listing found has been read.`;

  const html = `<div style="background:#F4F6FB;padding:28px 14px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1B2236">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #DEE3EF;border-radius:10px;padding:28px">
<p style="margin:0 0 4px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#122E87">Dream OS · morning check</p>
<p style="margin:0 0 14px;font-size:13px;color:#6B7490">${esc(dateStr)}</p>
<h1 style="margin:0 0 10px;font-size:24px;color:${issues.length ? "#B9431F" : "#3D7A4E"}">${verdict}</h1>
${issues.length ? `<ul style="margin:0 0 4px;padding-left:18px;font-size:15px;line-height:1.6">${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : p("Every feed ran on time and nothing was reported overnight.", "color:#343C52")}

${h2("Feeds")}
<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">${feedRows}</table>

${h2("Listings in the last 24 hours")}
${p(`<strong>Dream website</strong> — <span style="${mono}">${d.dream.active}</span> active · <span style="${mono}">${d.dream.added.length}</span> new · <span style="${mono}">${d.dream.withdrawn.length}</span> taken down`)}
${d.dream.added.length ? p("New:", "font-size:13px;color:#6B7490;margin:6px 0 2px") + list(d.dream.added) : ""}
${d.dream.withdrawn.length ? p("Taken down:", "font-size:13px;color:#6B7490;margin:6px 0 2px") + list(d.dream.withdrawn) : ""}
${p(`<strong>Property24 (Knysna)</strong> — <span style="${mono}">${p24.active}</span> active · <span style="${mono}">${p24.added}</span> new · <span style="${mono}">${p24.withdrawn}</span> gone`, "margin-top:12px")}
${p(p24Line, "font-size:14px;color:#343C52")}
${p24.missingCoords ? p(`${p24.missingCoords} Property24 listings have no map position yet.`, "font-size:14px;color:#343C52") : ""}

${h2("From the team")}
${
  d.feedbackTableMissing
    ? p("Reports aren't switched on yet (database change 0089 not applied).", "font-size:14px;color:#6B7490")
    : d.reports.length
      ? `<ul style="margin:0 0 8px;padding-left:18px;font-size:14px;line-height:1.6">${d.reports.map((r) => `<li><strong>${esc(r.who)}</strong>: “${esc(r.message.slice(0, 240))}”${r.path ? ` <span style="color:#6B7490">on ${esc(r.path)}</span>` : ""}</li>`).join("")}</ul>`
      : p("Nothing reported.", "font-size:14px;color:#6B7490")
}
${
  d.errors.length
    ? p(`Errors caught: ${d.errors
        .slice(0, 5)
        .map((e) => `${esc(e.message.slice(0, 90))}${e.path ? ` (${esc(e.path)})` : ""}${e.count > 1 ? ` ×${e.count}` : ""}`)
        .join("; ")}${d.errors.length > 5 ? ` and ${d.errors.length - 5} more` : ""}.`, "font-size:13px;color:#343C52")
    : ""
}

<p style="margin:28px 0 0">
<a href="${esc(siteUrl)}/admin/health" style="display:inline-block;background:#122E87;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:6px;margin:0 8px 8px 0">Data Health</a>
<a href="${esc(siteUrl)}/admin/reports" style="display:inline-block;background:#ffffff;color:#122E87;text-decoration:none;font-weight:600;font-size:14px;padding:9px 15px;border-radius:6px;border:1px solid #C5CDE3;margin:0 8px 8px 0">Reports</a>
</p>
<p style="margin:16px 0 0;font-size:12px;color:#6B7490">Sent every morning to Dream's directors.</p>
</div></div>`;

  const text = [
    `Dream OS morning check — ${dateStr}`,
    verdict,
    ...issues.map((i) => `- ${i}`),
    "",
    "Feeds:",
    ...d.feeds.map((f) => `- ${f.label}: ${WORD[f.light]} (${ago(f.lastRun, now)})`),
    "",
    `Dream website: ${d.dream.active} active, ${d.dream.added.length} new, ${d.dream.withdrawn.length} taken down`,
    `Property24: ${p24.active} active, ${p24.added} new, ${p24.withdrawn} gone. ${p24Line}`,
    "",
    d.reports.length ? `Reported by the team:\n${d.reports.map((r) => `- ${r.who}: ${r.message}`).join("\n")}` : "Nothing reported by the team.",
    "",
    `${siteUrl}/admin/health`,
  ].join("\n");

  return { subject, html, text, verdict, issues };
}
