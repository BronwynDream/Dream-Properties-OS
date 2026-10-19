import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AgentRoster, { type RosterRow } from "./AgentRoster";
import { createServiceClient } from "@/lib/supabase/service";
import TopBar from "@/app/components/TopBar";
import InviteUser from "./InviteUser";
import TeamRow, { type TeamMember } from "./TeamRow";
import {
  ROLE_ACCESS,
  ROLE_LABEL,
  ROLE_ORDER,
  ROLE_PILL,
  isAppRole,
  type AppRole,
} from "./roles";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function TeamPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("app_user")
    .select("role, active, full_name")
    .eq("id", user.id)
    .single();

  // Non-admin friendly panel — the tab is hidden for them anyway (adminOnly),
  // but a direct URL hit shouldn't 500. RLS also blocks the writes, so this
  // is just a UX guard.
  if (!me || me.role !== "admin" || me.active === false) {
    return (
      <>
        <TopBar />
        <main>
          <header className="app-head">
            <div>
              <p className="eyebrow">Dream Knysna · Team &amp; access</p>
              <h1>Directors only</h1>
            </div>
          </header>
          <hr className="tideline" />
          <section className="app-body" style={{ maxWidth: 720 }}>
            <p style={{ color: "#5b6885", marginTop: 24 }}>
              This screen manages who has access to Dream OS and what they can
              see. Ask a Director (Bronwyn or Camilla) if you need someone
              added or an access role adjusted.
            </p>
          </section>
        </main>
      </>
    );
  }

  // The list showed "No team members yet" on 2026-10-19 although Bronwyn and
  // Simon are directors: the select failed (a profile column missing on the
  // live database) and the error was swallowed. Fall back to the core
  // columns so the team always shows.
  const FULL = "id, full_name, email, role, job_title, phone, active, ppra_ffc, ffc_expiry_date";
  const CORE = "id, full_name, email, role, active";
  const [fullRes, { data: transfersData }] = await Promise.all([
    supabase.from("app_user").select(FULL).order("active", { ascending: false }).order("full_name"),
    supabase.from("transfer").select("lead_agent_user_id"),
  ]);
  let usersData: any[] | null = fullRes.data as any[] | null;
  if (fullRes.error) {
    console.warn(`[team] full select failed, using core columns: ${fullRes.error.message}`);
    const core = await supabase.from("app_user").select(CORE).order("active", { ascending: false }).order("full_name");
    usersData = core.data as any[] | null;
  }

  const transfersLed = new Map<string, number>();
  for (const t of (transfersData ?? []) as any[]) {
    const id = t.lead_agent_user_id as string | null;
    if (!id) continue;
    transfersLed.set(id, (transfersLed.get(id) ?? 0) + 1);
  }

  // The agent roster (0085) with each agent's login state. Sign-in and
  // invitation dates live in Supabase Auth, so read them with the service
  // client (this page is director-only).
  const roster: RosterRow[] = await (async () => {
    const [{ data: agents }, { data: la }] = await Promise.all([
      supabase.from("agent").select("id, full_name, email, phone, app_user_id").order("full_name"),
      supabase.from("listing_agent").select("agent_id, listing:listing_id(status)"),
    ]);
    const live = new Map<string, number>();
    for (const r of (la ?? []) as any[]) {
      const st = (Array.isArray(r.listing) ? r.listing[0] : r.listing)?.status;
      if (["draft", "live", "under_offer"].includes(st)) live.set(r.agent_id, (live.get(r.agent_id) ?? 0) + 1);
    }
    const users = (usersData ?? []) as any[];
    const auth = new Map<string, { invited_at: string | null; last_sign_in_at: string | null }>();
    try {
      const svc = createServiceClient();
      for (let page = 1; page <= 5; page++) {
        const { data } = await svc.auth.admin.listUsers({ page, perPage: 200 });
        for (const u of data?.users ?? []) {
          auth.set((u.email ?? "").toLowerCase(), { invited_at: (u as any).invited_at ?? u.created_at ?? null, last_sign_in_at: u.last_sign_in_at ?? null });
        }
        if (!data || data.users.length < 200) break;
      }
    } catch {
      /* no service key: dates just don't show */
    }
    return ((agents ?? []) as any[]).map((a) => {
      const email = String(a.email ?? "").toLowerCase();
      const u = users.find((x) => x.id === a.app_user_id) ?? users.find((x) => String(x.email ?? "").toLowerCase() === email);
      const au = auth.get(email) ?? null;
      const state: RosterRow["state"] = !u
        ? "none"
        : u.role === "admin"
          ? "director"
          : u.active === false
            ? "off"
            : au?.last_sign_in_at
              ? "active"
              : "invited";
      return {
        agentId: a.id,
        name: a.full_name,
        email,
        phone: a.phone ?? null,
        listings: live.get(a.id) ?? 0,
        state,
        invitedAt: au?.invited_at ?? null,
        lastSignIn: au?.last_sign_in_at ?? null,
      };
    });
  })();

  const members: TeamMember[] = ((usersData ?? []) as any[])
    .map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email ?? null,
      role: isAppRole(u.role) ? (u.role as AppRole) : ("agent" as AppRole),
      job_title: u.job_title ?? null,
      phone: u.phone ?? null,
      active: u.active !== false,
      ppra_ffc: u.ppra_ffc ?? null,
      ffc_expiry_date: u.ffc_expiry_date ?? null,
      transfers_led: transfersLed.get(u.id) ?? 0,
    }));

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <div>
            <p className="eyebrow">Dream Knysna · Team &amp; access</p>
            <h1>Who&apos;s in the room, and what they can see</h1>
          </div>
        </header>
        <hr className="tideline" />

        <section className="app-body" style={{ maxWidth: 1100 }}>
          {roster.length > 0 && <AgentRoster rows={roster} />}

          <h2 className="roster-sub">Logins &amp; roles</h2>
          <p className="roster-subnote">
            Everyone with a Dream OS login. Make someone a director here, or invite someone who isn&apos;t on the
            agent list (e.g. Camilla).
          </p>
          <div style={{ marginBottom: 20 }}>
            <InviteUser />
          </div>

          {members.length === 0 ? (
            <p style={{ color: "#5b6885" }}>No team members yet.</p>
          ) : (
            <table className="queue">
              <thead>
                <tr>
                  <th>Name / email</th>
                  <th>Title &amp; phone</th>
                  <th>Access role</th>
                  <th>FFC</th>
                  <th style={{ textAlign: "right" }}>Transfers led</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <TeamRow key={m.id} member={m} isSelf={m.id === user.id} />
                ))}
              </tbody>
            </table>
          )}

          <AccessMap />
        </section>
      </main>
    </>
  );
}

function AccessMap() {
  return (
    <section
      style={{
        marginTop: 40,
        background: "var(--white)",
        border: "1px solid #d7deef",
        borderRadius: 12,
        padding: 24,
        boxShadow: "0 4px 20px rgba(15,42,99,0.05)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--gold)",
          margin: 0,
        }}
      >
        Access map
      </p>
      <h2
        style={{
          fontFamily: "Inter, -apple-system, sans-serif",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: "var(--estuary)",
          margin: "4px 0 20px",
        }}
      >
        What each role can see
      </h2>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {ROLE_ORDER.map((r) => {
          const pill = ROLE_PILL[r];
          return (
            <li
              key={r}
              style={{
                display: "grid",
                gridTemplateColumns: "160px 1fr",
                gap: 20,
                alignItems: "baseline",
                paddingBottom: 14,
                borderBottom: "1px solid var(--mist)",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  background: pill.bg,
                  border: `1px solid ${pill.border}`,
                  color: pill.fg,
                  justifySelf: "start",
                }}
              >
                {ROLE_LABEL[r]}
              </span>
              <span style={{ fontSize: 14, color: "var(--estuary)" }}>
                {ROLE_ACCESS[r]}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
