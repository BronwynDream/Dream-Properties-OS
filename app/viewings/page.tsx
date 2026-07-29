import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import WeekNav from "./WeekNav";
import {
  VIEWING_KIND_LABEL,
  VIEWING_KIND_STRIPE,
  mondayOf,
  weekDaysFrom,
  formatWeekOf,
  type ViewingKind,
} from "@/lib/viewings";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Weekly show-house / viewings calendar. Mon → Sun grid so Sunday's
// show houses sit at the far right of the week (Bronwyn's mental
// model — weekend at the end of the working week). Each cell is a
// day; cards inside are individual viewings, sorted by time.
//
// Role scoping:
//   admin: sees every viewing
//   agent: sees only their own viewings + show houses that are
//          publicly advertised (walk-in leads belong to whoever's
//          hosting, so seeing the schedule matters)

type ViewingRow = {
  id: string;
  kind: ViewingKind;
  status: "scheduled" | "completed" | "cancelled";
  scheduledAt: string;
  durationMinutes: number;
  propertyId: string | null;
  propertyAddress: string | null;
  agentName: string | null;
  attendeeCount: number;
  interestedCount: number;
};

type Search = { week?: string };

export default async function ViewingsPage({ searchParams }: { searchParams: Search }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("app_user")
    .select("id, role, active, full_name")
    .eq("id", user.id)
    .single();
  if (!profile || profile.active === false) redirect("/dashboard");
  const isAdmin = profile.role === "admin";

  // Resolve the week anchor. Default = this week (Monday of today).
  const anchor = searchParams.week ? new Date(searchParams.week + "T00:00:00") : new Date();
  const monday = mondayOf(anchor);
  const sundayEnd = new Date(monday);
  sundayEnd.setDate(monday.getDate() + 7);

  // Load viewings in the window. RLS restricts agents to their own via
  // the app-layer filter below (write policy is admin-only; read is
  // staff-wide so this filter is app-enforced).
  const { data: rows } = await supabase
    .from("viewing")
    .select(
      "id, kind, status, scheduled_at, duration_minutes, agent_user_id, property:property_id(id, primary_address), agent:agent_user_id(id, full_name)",
    )
    .gte("scheduled_at", monday.toISOString())
    .lt("scheduled_at", sundayEnd.toISOString())
    .order("scheduled_at", { ascending: true });

  const raw = (rows ?? []) as any[];
  const viewingIds = raw.map((r) => r.id);

  // Attendee counts + interest counts — one round-trip.
  const { data: attRows } = viewingIds.length > 0
    ? await supabase
        .from("viewing_attendee")
        .select("viewing_id, is_interested")
        .in("viewing_id", viewingIds)
    : { data: [] as any[] };
  const attendeeCount = new Map<string, number>();
  const interestedCount = new Map<string, number>();
  for (const a of (attRows ?? []) as any[]) {
    attendeeCount.set(a.viewing_id, (attendeeCount.get(a.viewing_id) ?? 0) + 1);
    if (a.is_interested === true) interestedCount.set(a.viewing_id, (interestedCount.get(a.viewing_id) ?? 0) + 1);
  }

  const scoped = raw.filter((r) => {
    if (isAdmin) return true;
    // Agents: see their own + all show_house entries (walk-in coverage)
    if (r.agent_user_id === profile.id) return true;
    if (r.kind === "show_house") return true;
    return false;
  });

  const viewings: ViewingRow[] = scoped.map((r) => {
    const agentJoin = Array.isArray(r.agent) ? r.agent[0] : r.agent;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      scheduledAt: r.scheduled_at,
      durationMinutes: r.duration_minutes ?? 60,
      propertyId: r.property?.id ?? null,
      propertyAddress: r.property?.primary_address ?? null,
      agentName: agentJoin?.full_name ?? null,
      attendeeCount: attendeeCount.get(r.id) ?? 0,
      interestedCount: interestedCount.get(r.id) ?? 0,
    };
  });

  // Bucket into 7 day-columns
  const days = weekDaysFrom(monday);
  const byDay: ViewingRow[][] = days.map(() => []);
  for (const v of viewings) {
    const d = new Date(v.scheduledAt);
    d.setHours(0, 0, 0, 0);
    const idx = days.findIndex((day) => day.getTime() === d.getTime());
    if (idx >= 0) byDay[idx].push(v);
  }

  const totalViewings = viewings.length;
  const totalShowHouses = viewings.filter((v) => v.kind === "show_house").length;

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head" style={{ alignItems: "flex-end" }}>
          <div>
            <p className="eyebrow">Dream Knysna · Viewings · Week</p>
            <h1>
              {totalViewings} viewing{totalViewings === 1 ? "" : "s"} this week
              {totalShowHouses > 0 && (
                <span
                  style={{
                    marginLeft: 12,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 14,
                    color: "var(--paper-mute, #6a7692)",
                    fontWeight: 400,
                  }}
                >
                  · {totalShowHouses} show house{totalShowHouses === 1 ? "" : "s"}
                </span>
              )}
            </h1>
          </div>
          <WeekNav mondayIso={monday.toISOString().slice(0, 10)} label={formatWeekOf(monday)} />
        </header>
        <hr className="tideline" />

        <section className="app-body" style={{ overflowX: "auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(160px, 1fr))",
              gap: 10,
              paddingBottom: 24,
            }}
          >
            {days.map((d, i) => (
              <DayColumn key={i} day={d} viewings={byDay[i]} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function DayColumn({ day, viewings }: { day: Date; viewings: ViewingRow[] }) {
  const isSunday = day.getDay() === 0;
  const isToday = (() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t.getTime() === day.getTime();
  })();
  return (
    <div
      style={{
        background: isSunday ? "#F3EEDF" : "var(--paper-1, #F5F1E8)",
        border: isToday ? "2px solid var(--accent-600, #132B84)" : "1px solid var(--line-soft, #E7E0D2)",
        borderRadius: 6,
        padding: "8px 8px 10px",
        minHeight: 200,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: isSunday ? "var(--accent-700, #2C4653)" : "var(--ink-500, #6B6153)",
        }}
      >
        {day.toLocaleDateString("en-ZA", { weekday: "short" })}
      </p>
      <p style={{ margin: "2px 0 8px", fontFamily: "'Fraunces', serif", fontSize: 18, color: "var(--estuary, #132B84)", fontWeight: 500 }}>
        {day.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {viewings.length === 0 ? (
          <p style={{ margin: 0, fontSize: 10, color: "var(--paper-mute, #6a7692)", fontStyle: "italic" }}>
            —
          </p>
        ) : (
          viewings.map((v) => <ViewingCard key={v.id} v={v} />)
        )}
      </div>
    </div>
  );
}

function ViewingCard({ v }: { v: ViewingRow }) {
  const time = new Date(v.scheduledAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  const stripe = VIEWING_KIND_STRIPE[v.kind];
  const cancelled = v.status === "cancelled";
  return (
    <article
      style={{
        background: "var(--paper-0, #FBF9F4)",
        borderLeft: `3px solid ${stripe}`,
        borderRadius: "0 4px 4px 0",
        padding: "6px 8px",
        opacity: cancelled ? 0.5 : 1,
        textDecoration: cancelled ? "line-through" : "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "baseline" }}>
        <span
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 12,
            color: "var(--estuary, #132B84)",
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          {time}
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 9,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--paper-mute, #6a7692)",
          }}
        >
          {VIEWING_KIND_LABEL[v.kind]}
        </span>
      </div>
      {v.propertyId ? (
        <Link
          href={`/properties/${v.propertyId}`}
          prefetch={false}
          style={{
            display: "block",
            marginTop: 2,
            fontFamily: "'Fraunces', serif",
            fontSize: 12,
            color: "var(--estuary, #132B84)",
            fontWeight: 500,
            textDecoration: "none",
            lineHeight: 1.25,
          }}
        >
          {v.propertyAddress ?? v.propertyId.slice(0, 8)}
        </Link>
      ) : (
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-700, #423B31)" }}>—</p>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
        {v.agentName && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 9,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--paper-mute, #6a7692)",
            }}
          >
            {v.agentName}
          </span>
        )}
        {v.attendeeCount > 0 && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              padding: "1px 6px",
              background: "var(--paper-2, #ECE6D8)",
              borderRadius: 2,
              color: "var(--ink-700, #423B31)",
            }}
            title={`${v.attendeeCount} attendee${v.attendeeCount === 1 ? "" : "s"}${v.interestedCount > 0 ? ` · ${v.interestedCount} interested` : ""}`}
          >
            {v.attendeeCount}
            {v.interestedCount > 0 && ` · ${v.interestedCount}★`}
          </span>
        )}
      </div>
    </article>
  );
}
