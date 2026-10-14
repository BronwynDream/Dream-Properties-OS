import { redirect } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import TopBar from "@/app/components/TopBar";
import { FEEDS, feedLight, type FeedDef, type FeedKey, type FeedLatest, type Light } from "@/lib/feeds/registry";
import RefreshDreamButton from "./RefreshDreamButton";
import RefreshProperty24Button from "./RefreshProperty24Button";
import DrainQueueButton from "./DrainQueueButton";
import RegeocodeProperty24Button from "./RegeocodeProperty24Button";
import RefreshMuniButton from "./RefreshMuniButton";
import GeocodeButton from "./GeocodeButton";

// Data Health — one row per feed, one light per row.
//
// Simon, 2026-10-14: "not sure all these left-hand buttons will go down well
// with the agents ... we need a dashboard that has green lights for each
// section to make sure it's up to date with the web hooks and the
// properties from the various websites are being rendered properly."
//
// Every admin trigger that used to sit on the map rail lives here now. The
// lights come from feed_run (migration 0070) via lib/feeds/registry.ts, so
// the map's source chips and this page can never disagree.

export const dynamic = "force-dynamic";

type Stat = { label: string; value: string | number; tone?: "mute" | "warn" | "bad" };

const LIGHT_STYLE: Record<Light, { bg: string; label: string }> = {
  green: { bg: "var(--positive, #4B6B4A)", label: "Healthy" },
  amber: { bg: "var(--caution, #A9772F)", label: "Attention" },
  red: { bg: "var(--critical, #9A3B34)", label: "Problem" },
  grey: { bg: "var(--ink-400, #8C8172)", label: "Never run" },
};

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Server renders in UTC on Vercel; Dream's day is SAST.
  return new Date(iso).toLocaleString("en-ZA", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg",
  });
}

export default async function DataHealthPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("app_user").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/dashboard");

  // Service role for the counts: these tables are a mix of admin-readable
  // and service-only, and the page is already admin-gated above.
  const svc = createServiceClient();

  const [
    latestRes,
    dwRes, p24Res, ppRes,
    dwMissing, p24Missing,
    qPending, qTotal,
    muniRes, rollRes,
    propTotal, propMissing,
    emailBatches,
  ] = await Promise.all([
    svc.from("v_feed_latest").select("feed, status, trigger, started_at, finished_at, items, error"),
    svc.from("external_listing").select("last_seen", { count: "exact" }).eq("source", "dream_website").eq("active", true).order("last_seen", { ascending: false }).limit(1),
    svc.from("external_listing").select("last_seen", { count: "exact" }).eq("source", "property24").eq("active", true).order("last_seen", { ascending: false }).limit(1),
    svc.from("external_listing").select("last_seen", { count: "exact" }).eq("source", "private_property").eq("active", true).order("last_seen", { ascending: false }).limit(1),
    svc.from("external_listing").select("id", { count: "exact", head: true }).eq("source", "dream_website").eq("active", true).is("lat", null),
    svc.from("external_listing").select("id", { count: "exact", head: true }).eq("source", "property24").eq("active", true).is("lat", null),
    svc.from("property24_url_queue").select("url", { count: "exact", head: true }).is("processed_at", null),
    svc.from("property24_url_queue").select("url", { count: "exact", head: true }),
    svc.from("muni_property").select("sg_number", { count: "exact", head: true }),
    svc.from("valuation_roll_upload").select("kind, status, uploaded_at, applied_row_count").eq("status", "applied").order("uploaded_at", { ascending: false }).limit(1),
    svc.from("property").select("id", { count: "exact", head: true }),
    svc.from("property").select("id", { count: "exact", head: true }).is("lat", null),
    svc.from("ingest_batch").select("created_at", { count: "exact" }).eq("source", "email").order("created_at", { ascending: false }).limit(1),
  ]);

  const latest = new Map<FeedKey, FeedLatest>();
  for (const r of (latestRes.data ?? []) as FeedLatest[]) latest.set(r.feed, r);

  const n = (r: { count: number | null }) => r.count ?? 0;
  const first = <T,>(r: { data: T[] | null }): T | undefined => r.data?.[0];

  const queuePending = n(qPending);
  const queueTotal = n(qTotal);
  const propMissingN = n(propMissing);
  const roll = first(rollRes) as { kind: string; uploaded_at: string; applied_row_count: number } | undefined;

  const stats: Record<FeedKey, Stat[]> = {
    dream_website: [
      { label: "Active listings", value: n(dwRes) },
      { label: "Last seen", value: fmtAgo((first(dwRes) as { last_seen: string } | undefined)?.last_seen) },
      { label: "Missing coords", value: n(dwMissing), tone: n(dwMissing) > 0 ? "warn" : "mute" },
    ],
    property24: [
      { label: "Active listings", value: n(p24Res) },
      { label: "Last seen", value: fmtAgo((first(p24Res) as { last_seen: string } | undefined)?.last_seen) },
      { label: "Queue", value: `${queuePending} pending / ${queueTotal}`, tone: queuePending > 0 ? "warn" : "mute" },
      { label: "Missing coords", value: n(p24Missing), tone: n(p24Missing) > 0 ? "warn" : "mute" },
    ],
    private_property: [{ label: "Active listings", value: n(ppRes), tone: "mute" }],
    muni_roll: [
      { label: "Erven on file", value: n(muniRes) },
      { label: "Last roll applied", value: roll ? `${roll.kind === "full_gv" ? "Full GV" : "Supplement"} · ${fmtDate(roll.uploaded_at)}` : "none", tone: roll ? undefined : "bad" },
    ],
    geocode: [
      { label: "Properties pinned", value: `${n(propTotal) - propMissingN} / ${n(propTotal)}` },
      { label: "Missing coords", value: propMissingN, tone: propMissingN > 0 ? "warn" : "mute" },
    ],
    intake_email: [
      { label: "Email batches", value: n(emailBatches) },
      { label: "Last received", value: fmtAgo((first(emailBatches) as { created_at: string } | undefined)?.created_at) },
    ],
  };

  const actions: Partial<Record<FeedKey, ReactNode>> = {
    dream_website: <RefreshDreamButton />,
    property24: (
      <>
        <RefreshProperty24Button />
        <DrainQueueButton />
        <RegeocodeProperty24Button />
      </>
    ),
    muni_roll: <RefreshMuniButton />,
    geocode: <GeocodeButton missing={propMissingN} />,
  };

  const lights = FEEDS.map((f) => feedLight(f, latest.get(f.key)));
  const worst: Light = lights.includes("red") ? "red" : lights.includes("amber") ? "amber" : lights.includes("grey") ? "grey" : "green";

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Admin · Data Health</p>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Dot light={worst} size={14} />
            Data health
          </h1>
          <p className="app-sub">
            Every feed the OS depends on, with its last run and a light. Green means it ran on
            schedule without errors; amber means it is late or finished with warnings; red means
            it failed, never finished, or is not built yet. Agents never see this page — the map
            only shows them a dot per source.
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
            {FEEDS.map((f, i) => (
              <FeedRow
                key={f.key}
                def={f}
                light={lights[i]}
                latest={latest.get(f.key)}
                stats={stats[f.key]}
                action={actions[f.key]}
              />
            ))}
          </ul>
          <p style={{ marginTop: 28, fontSize: 12, color: "var(--paper-mute)", fontFamily: "var(--font-mono)" }}>
            Schedules (Vercel Cron, UTC): Dream website daily 03:00 · Property24 Mondays 05:00 ·
            Municipal roll Mondays 04:00. Manual runs here use the same routes.
          </p>
        </section>
      </main>
    </>
  );
}

function Dot({ light, size = 10 }: { light: Light; size?: number }) {
  return (
    <span
      aria-label={LIGHT_STYLE[light].label}
      title={LIGHT_STYLE[light].label}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: LIGHT_STYLE[light].bg,
        boxShadow: light === "green" ? "0 0 0 3px rgba(75,107,74,0.18)" : light === "red" ? "0 0 0 3px rgba(154,59,52,0.18)" : "none",
        flex: "0 0 auto",
      }}
    />
  );
}

function FeedRow({
  def, light, latest, stats, action,
}: {
  def: FeedDef; light: Light; latest: FeedLatest | undefined; stats: Stat[]; action: ReactNode;
}) {
  const toneColor: Record<NonNullable<Stat["tone"]>, string> = {
    mute: "var(--paper-mute)", warn: "var(--caution)", bad: "var(--critical)",
  };
  const cell: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 12 };
  return (
    <li
      style={{
        border: "1px solid var(--hairline, #e2e8f5)",
        borderLeft: `4px solid ${LIGHT_STYLE[light].bg}`,
        borderRadius: 3,
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(220px, 0.8fr)",
        gap: 20,
        alignItems: "start",
        background: "var(--white)",
      }}
      className="health-row"
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Dot light={light} />
          <strong style={{ fontSize: 15 }}>{def.label}</strong>
          <span style={{ ...cell, color: LIGHT_STYLE[light].bg, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>
            {LIGHT_STYLE[light].label}
          </span>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-700)", lineHeight: 1.5 }}>{def.what}</p>
        {def.planned ? (
          <p style={{ ...cell, margin: "8px 0 0", color: "var(--critical)" }}>Not built yet — on the roadmap (plan 019).</p>
        ) : (
          <dl style={{ ...cell, margin: "10px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 3 }}>
            <dt style={{ color: "var(--paper-mute)" }}>Last run</dt>
            <dd style={{ margin: 0 }}>
              {latest ? (
                <>
                  {fmtDate(latest.started_at)} · {latest.trigger} · {latest.status}
                  {latest.items != null ? ` · ${latest.items} items` : ""}
                </>
              ) : (
                "never"
              )}
            </dd>
            {latest?.error && (
              <>
                <dt style={{ color: "var(--critical)" }}>Error</dt>
                <dd style={{ margin: 0, color: "var(--critical)", wordBreak: "break-word" }}>{latest.error}</dd>
              </>
            )}
          </dl>
        )}
      </div>

      <dl style={{ ...cell, margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 12, rowGap: 4, alignSelf: "start" }}>
        {stats.map((s) => (
          <div key={s.label} style={{ display: "contents" }}>
            <dt style={{ color: "var(--paper-mute)" }}>{s.label}</dt>
            <dd style={{ margin: 0, color: s.tone ? toneColor[s.tone] : "var(--ink)", fontWeight: s.tone === "warn" || s.tone === "bad" ? 600 : 400 }}>{s.value}</dd>
          </div>
        ))}
      </dl>

      <div style={{ marginTop: -12 }}>{action ?? <p style={{ ...cell, margin: "12px 0 0", color: "var(--paper-mute)" }}>{def.planned ? "" : "Runs on its own."}</p>}</div>
    </li>
  );
}
