import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import { getSetting } from "@/lib/settings";
import { PropertyDate } from "@/app/components/format";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// PPRA compliance watchlist for directors — surfaces agents whose
// Fidelity Fund Certificate has expired or will expire soon. Property
// practitioners cannot legally earn commission without a valid FFC, so
// a lapsed certificate silently invalidates every deal that agent signs.
// This page is the "chase renewal now" screen.
//
// Same three-bucket pattern as /mandates:
//   - Expired (unresolved) — needs immediate action
//   - One bucket per configured threshold (default 30 / 60 / 90 days)
//   - Unknown expiry — data-hygiene bucket (FFC number recorded but no
//     expiry, or nothing recorded at all)
//
// Admin-only. Agents don't need to see other agents' compliance state.

type AgentRow = {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  active: boolean;
  ppra_ffc: string | null;
  ffc_expiry_date: string | null;
};

// UTC-midnight day arithmetic — timezone-safe (agents in JHB or CT get
// the same result regardless of the browser's timezone).
function daysUntil(iso: string): number {
  const now = new Date();
  const t0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const then = new Date(iso + "T00:00:00Z");
  return Math.round((then.getTime() - t0) / 86_400_000);
}

export default async function CompliancePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") redirect("/dashboard");

  const thresholds = await getSetting("ffc.expiry_window_days");
  const sortedThresholds = Array.from(
    new Set(thresholds.filter((n) => Number.isFinite(n) && n > 0)),
  ).sort((a, b) => a - b);

  // Only agent/admin roles hold FFCs — conveyancer / client users don't
  // (they're external roles reserved for future scoped rooms per 0001_init).
  const { data: agents } = await supabase
    .from("app_user")
    .select("id, full_name, email, role, active, ppra_ffc, ffc_expiry_date")
    .in("role", ["agent", "admin"])
    .eq("active", true)
    .order("full_name", { ascending: true });

  const rows = (agents ?? []) as AgentRow[];

  // Bucket. Priority chain matches mandate watchlist:
  //   Expired first (most urgent), then thresholds ascending, then Unknown.
  const expired: { row: AgentRow; days: number }[] = [];
  const buckets: { label: string; note: string; rows: { row: AgentRow; days: number }[] }[] = [];
  const unknown: AgentRow[] = [];

  let prev = 0;
  for (const t of sortedThresholds) {
    buckets.push({
      label: prev === 0 ? `Expiring in ${t} days` : `Expiring in ${prev + 1}–${t} days`,
      note:
        prev === 0
          ? `FFCs lapsing today through ${t} days out — chase renewal now.`
          : `FFCs ${prev + 1}–${t} days out — start the renewal process.`,
      rows: [],
    });
    prev = t;
  }

  for (const r of rows) {
    if (!r.ffc_expiry_date) {
      unknown.push(r);
      continue;
    }
    const d = daysUntil(r.ffc_expiry_date);
    if (d < 0) {
      expired.push({ row: r, days: d });
    } else {
      let placed = false;
      let p = 0;
      for (let i = 0; i < sortedThresholds.length; i++) {
        const t = sortedThresholds[i];
        if (d >= p && d <= t) {
          buckets[i].rows.push({ row: r, days: d });
          placed = true;
          break;
        }
        p = t;
      }
      // Silently drop rows further out than the largest threshold — they're
      // healthy and don't need to be on the watchlist. Directors don't want
      // a screen full of Valid entries.
      void placed;
    }
  }

  expired.sort((a, b) => a.days - b.days);
  for (const b of buckets) b.rows.sort((a, b) => a.days - b.days);
  unknown.sort((a, b) => (a.ppra_ffc ? 1 : 0) - (b.ppra_ffc ? 1 : 0)); // no-number first

  const total =
    expired.length + buckets.reduce((s, b) => s + b.rows.length, 0) + unknown.length;

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Compliance · PPRA</p>
          <h1>
            {total === 0
              ? "All FFCs current"
              : `${total} FFC${total === 1 ? "" : "s"} needs attention`}
          </h1>
          <p className="app-sub">
            Windows configured at{" "}
            <Link href="/settings" style={{ color: "var(--navy)", fontWeight: 600 }}>
              Settings
            </Link>
            : {sortedThresholds.join(" / ")} days. Edit an agent&apos;s FFC on{" "}
            <Link href="/team" style={{ color: "var(--navy)", fontWeight: 600 }}>
              Team
            </Link>
            .
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          {total === 0 ? (
            <p style={{ color: "var(--paper-mute, #6a7692)", fontStyle: "italic", padding: "24px 0" }}>
              Every active agent has a valid FFC recorded with runway greater
              than {sortedThresholds[sortedThresholds.length - 1] ?? 60} days.
              Nothing to chase.
            </p>
          ) : (
            <>
              <Section
                title={`Expired · ${expired.length}`}
                note="These agents cannot legally earn commission. Fix immediately — every deal they sign in this state is exposed to PPRA action."
                tone="alert"
                rows={expired}
              />
              {buckets.map((b) => (
                <Section
                  key={b.label}
                  title={`${b.label} · ${b.rows.length}`}
                  note={b.note}
                  tone="warn"
                  rows={b.rows}
                />
              ))}
              <UnknownSection rows={unknown} />
            </>
          )}
        </section>
      </main>
    </>
  );
}

function Section({
  title,
  note,
  tone,
  rows,
}: {
  title: string;
  note: string;
  tone: "alert" | "warn" | "info";
  rows: { row: AgentRow; days: number }[];
}) {
  if (rows.length === 0) return null;
  const stripe =
    tone === "alert"
      ? "var(--critical, #9A3B34)"
      : tone === "warn"
        ? "var(--caution, #A9772F)"
        : "var(--ink-400, #8C8172)";
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ borderLeft: `3px solid ${stripe}`, paddingLeft: 12, marginBottom: 12 }}>
        <h2
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--estuary, #132B84)",
            margin: 0,
          }}
        >
          {title}
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--paper-mute, #6a7692)" }}>
          {note}
        </p>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map(({ row, days }) => (
          <AgentEntry key={row.id} row={row} days={days} />
        ))}
      </ul>
    </div>
  );
}

function UnknownSection({ rows }: { rows: AgentRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ borderLeft: "3px solid var(--ink-400, #8C8172)", paddingLeft: 12, marginBottom: 12 }}>
        <h2
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--estuary, #132B84)",
            margin: 0,
          }}
        >
          Unknown expiry · {rows.length}
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--paper-mute, #6a7692)" }}>
          Active agents whose FFC expiry we don&apos;t have on file. Ask the
          agent for their certificate and enter it on Team.
        </p>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((row) => (
          <li
            key={row.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              padding: "12px 0",
              borderBottom: "1px solid var(--hairline, #e2e8f5)",
            }}
          >
            <div>
              <p
                style={{
                  margin: 0,
                  fontFamily: "'Fraunces', 'Cormorant Garamond', serif",
                  fontSize: 16,
                  color: "var(--estuary, #132B84)",
                  fontWeight: 500,
                }}
              >
                {row.full_name}
              </p>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 11,
                  color: "var(--paper-mute, #6a7692)",
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                }}
              >
                {row.role === "admin" ? "Director" : "Agent"}
                {row.ppra_ffc ? ` · FFC ${row.ppra_ffc}` : " · No FFC on file"}
              </p>
            </div>
            <Link
              href="/team"
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
                alignSelf: "center",
              }}
            >
              Add on Team →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentEntry({ row, days }: { row: AgentRow; days: number }) {
  const overdue = days < 0;
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        padding: "12px 0",
        borderBottom: "1px solid var(--hairline, #e2e8f5)",
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            fontFamily: "'Fraunces', 'Cormorant Garamond', serif",
            fontSize: 16,
            color: "var(--estuary, #132B84)",
            fontWeight: 500,
          }}
        >
          {row.full_name}
        </p>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginTop: 6,
            flexWrap: "wrap",
            fontSize: 11,
            color: "var(--paper-mute, #6a7692)",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            letterSpacing: "0.02em",
          }}
        >
          <span>{row.role === "admin" ? "Director" : "Agent"}</span>
          {row.ppra_ffc && <span>FFC {row.ppra_ffc}</span>}
          {row.email && <span>{row.email}</span>}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 160 }}>
        <p
          style={{
            margin: 0,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 13,
            color: overdue ? "var(--critical, #9A3B34)" : "var(--caution, #A9772F)",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          {overdue
            ? `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`
            : days === 0
              ? "Expires today"
              : `Expires in ${days} day${days === 1 ? "" : "s"}`}
        </p>
        <p
          style={{
            margin: "2px 0 0",
            fontSize: 11,
            color: "var(--paper-mute, #6a7692)",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          }}
        >
          <PropertyDate value={row.ffc_expiry_date} />
        </p>
      </div>
    </li>
  );
}
