import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import { getSetting } from "@/lib/settings";
import { PropertyDate, FicaStatusBadge } from "@/app/components/format";
import { deriveFicaState, ficaLabel, type DerivedFica, type RawFicaRecord } from "@/lib/fica";
import { questionsFor, summariseAnswers, type PpraFormType } from "@/lib/ppraDisclosure";

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

  const [thresholds, ficaValidityDays] = await Promise.all([
    getSetting("ffc.expiry_window_days"),
    getSetting("fica.verification_valid_days"),
  ]);
  const sortedThresholds = Array.from(
    new Set(thresholds.filter((n) => Number.isFinite(n) && n > 0)),
  ).sort((a, b) => a - b);

  // Live-deal FICA gaps. Statuses chosen deliberately:
  //   in_conveyancing → conveyancer will demand FICA to lodge; any gap
  //                     here blocks registration and is the highest-urgency
  //                     bucket.
  //   sale_agreed     → OTP accepted, running toward transfer — should
  //                     already have FICA started for the buyer.
  //   under_offer     → contract of sale being negotiated; FICA on the
  //                     buyer is normally kicked off when the offer is
  //                     signed. Anything missing here is an early smell.
  const LIVE_STATUSES = ["in_conveyancing", "sale_agreed", "under_offer"] as const;
  const STATUS_URGENCY: Record<string, number> = {
    in_conveyancing: 0,
    sale_agreed: 1,
    under_offer: 2,
  };
  const liveDealGaps = await loadLiveDealFicaGaps(supabase, LIVE_STATUSES, ficaValidityDays);
  liveDealGaps.sort((a, b) => {
    const ua = STATUS_URGENCY[a.status] ?? 99;
    const ub = STATUS_URGENCY[b.status] ?? 99;
    if (ua !== ub) return ua - ub;
    return (b.gapCount ?? 0) - (a.gapCount ?? 0);
  });

  // Deal-doc gaps: PPRA disclosure + certificates of compliance on the
  // same live-transfer set. Rendered as one strip below the FICA gaps
  // because they share the same "conveyancer will block lodgment" tone.
  const dealDocGaps = await loadDealDocGaps(supabase, LIVE_STATUSES);
  dealDocGaps.sort((a, b) => {
    const ua = STATUS_URGENCY[a.status] ?? 99;
    const ub = STATUS_URGENCY[b.status] ?? 99;
    if (ua !== ub) return ua - ub;
    return (b.gapCount ?? 0) - (a.gapCount ?? 0);
  });

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
  const dealsWithGaps = liveDealGaps.length;
  const totalGapCount = liveDealGaps.reduce((s, d) => s + d.gapCount, 0);
  const dealsWithDocGaps = dealDocGaps.length;

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Compliance</p>
          <h1>
            {total === 0 && dealsWithGaps === 0
              ? "All clear · FFC + FICA"
              : total > 0 && dealsWithGaps > 0
                ? `${total} FFC${total === 1 ? "" : "s"} + ${totalGapCount} FICA gap${totalGapCount === 1 ? "" : "s"}`
                : total > 0
                  ? `${total} FFC${total === 1 ? "" : "s"} needs attention`
                  : `${totalGapCount} FICA gap${totalGapCount === 1 ? "" : "s"} on live deals`}
          </h1>
          <p className="app-sub">
            FFC windows configured at{" "}
            <Link href="/settings" style={{ color: "var(--navy)", fontWeight: 600 }}>
              Settings
            </Link>
            : {sortedThresholds.join(" / ")} days · FICA validity {ficaValidityDays} days.
            Edit an agent&apos;s FFC on{" "}
            <Link href="/team" style={{ color: "var(--navy)", fontWeight: 600 }}>
              Team
            </Link>
            .
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <LiveDealFicaGaps rows={liveDealGaps} />

          <DealDocGaps rows={dealDocGaps} />

          <h2
            style={{
              marginTop: dealsWithGaps > 0 || dealsWithDocGaps > 0 ? 40 : 0,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--estuary, #132B84)",
            }}
          >
            PPRA · Agent FFCs
          </h2>

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

// ---------------------------------------------------------------------------
// Live-deal FICA: for every transfer currently in a live status, walk its
// transfer_party rows and derive a per-party FICA state SCOPED TO THIS
// TRANSFER. Anything not "verified" is a gap the director should chase.
//
// Scoped-to-transfer is deliberate: a party might be FICA-verified on their
// last transfer (2023) but need re-verification for this one. The FIC Act
// treats each business relationship as a fresh KYC obligation.
// ---------------------------------------------------------------------------

type PartyGap = {
  partyId: string;
  displayName: string;
  side: "seller" | "purchaser" | string;
  derived: DerivedFica;
};

type LiveDealGap = {
  transferId: string;
  transferName: string | null;
  status: string;
  propertyId: string | null;
  propertyAddress: string | null;
  gaps: PartyGap[];
  gapCount: number;
};

async function loadLiveDealFicaGaps(
  supabase: ReturnType<typeof createClient>,
  liveStatuses: readonly string[],
  validityDays: number,
): Promise<LiveDealGap[]> {
  const { data: transfers } = await supabase
    .from("transfer")
    .select("id, name, status, property:property_id(id, primary_address)")
    .in("status", liveStatuses as unknown as string[]);

  const transferRows = (transfers ?? []) as any[];
  if (transferRows.length === 0) return [];
  const transferIds = transferRows.map((t) => t.id);

  const [{ data: tps }, { data: fs }] = await Promise.all([
    supabase
      .from("transfer_party")
      .select("transfer_id, side, party:party_id(id, display_name)")
      .in("transfer_id", transferIds),
    supabase
      .from("fica")
      .select("transfer_id, party_id, role, status, verified_at, updated_at")
      .in("transfer_id", transferIds),
  ]);

  // fica records indexed by (transfer_id, party_id) → derive per (transfer, party)
  const ficaKey = (tid: string, pid: string) => `${tid}::${pid}`;
  const ficaByKey = new Map<string, RawFicaRecord[]>();
  for (const f of (fs ?? []) as any[]) {
    const k = ficaKey(f.transfer_id, f.party_id);
    const arr = ficaByKey.get(k) ?? [];
    arr.push({
      status: f.status,
      verified_at: f.verified_at,
      updated_at: f.updated_at,
      transfer_id: f.transfer_id,
      role: f.role,
    });
    ficaByKey.set(k, arr);
  }

  const partiesByTransfer = new Map<string, { partyId: string; displayName: string; side: string }[]>();
  for (const tp of (tps ?? []) as any[]) {
    const arr = partiesByTransfer.get(tp.transfer_id) ?? [];
    if (tp.party?.id) {
      arr.push({
        partyId: tp.party.id,
        displayName: tp.party.display_name ?? "—",
        side: tp.side,
      });
    }
    partiesByTransfer.set(tp.transfer_id, arr);
  }

  const out: LiveDealGap[] = [];
  for (const t of transferRows) {
    const parties = partiesByTransfer.get(t.id) ?? [];
    const gaps: PartyGap[] = [];
    for (const p of parties) {
      const records = ficaByKey.get(ficaKey(t.id, p.partyId)) ?? [];
      const derived = deriveFicaState(records, validityDays);
      if (derived.state !== "verified") {
        gaps.push({ partyId: p.partyId, displayName: p.displayName, side: p.side, derived });
      }
    }
    if (gaps.length > 0) {
      out.push({
        transferId: t.id,
        transferName: t.name ?? null,
        status: t.status,
        propertyId: t.property?.id ?? null,
        propertyAddress: t.property?.primary_address ?? null,
        gaps,
        gapCount: gaps.length,
      });
    }
  }
  return out;
}

function LiveDealFicaGaps({ rows }: { rows: LiveDealGap[] }) {
  return (
    <div>
      <div style={{ borderLeft: "3px solid var(--critical, #9A3B34)", paddingLeft: 12, marginBottom: 12 }}>
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
          FIC Act · Gaps on live deals · {rows.length} {rows.length === 1 ? "deal" : "deals"}
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--paper-mute, #6a7692)" }}>
          Transfers in flight where a party&apos;s FICA is missing, pending, stale, or expired.
          Conveyancers block lodgment until this is closed — sort your day starting here.
        </p>
      </div>
      {rows.length === 0 ? (
        <p style={{ color: "var(--paper-mute, #6a7692)", fontStyle: "italic", padding: "12px 0 24px" }}>
          Every party on every live deal is FICA-verified within the validity window. Nothing to chase.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li
              key={r.transferId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                padding: "14px 0",
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
                  {r.propertyId ? (
                    <Link href={`/properties/${r.propertyId}`} style={{ color: "inherit" }}>
                      {r.propertyAddress ?? r.transferName ?? r.transferId.slice(0, 8)}
                    </Link>
                  ) : (
                    r.transferName ?? r.transferId.slice(0, 8)
                  )}
                </p>
                <p
                  style={{
                    margin: "2px 0 8px",
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 10,
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    color: dealStatusColor(r.status),
                  }}
                >
                  {r.status.replace(/_/g, " ")}
                </p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {r.gaps.map((g) => (
                    <li key={g.partyId} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Link
                        href={`/contacts/${g.partyId}`}
                        style={{ fontSize: 13, color: "var(--estuary, #132B84)", fontWeight: 500 }}
                      >
                        {g.displayName}
                      </Link>
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                          fontSize: 10,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "var(--paper-mute, #6a7692)",
                        }}
                      >
                        {g.side === "purchaser" ? "Buyer" : g.side === "seller" ? "Seller" : g.side}
                      </span>
                      <FicaStatusBadge derived={g.derived} size="sm" />
                      <span style={{ fontSize: 11, color: "var(--paper-mute, #6a7692)" }}>
                        {ficaLabel(g.derived)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div style={{ textAlign: "right", minWidth: 100 }}>
                <p
                  style={{
                    margin: 0,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 13,
                    color: "var(--critical, #9A3B34)",
                    fontWeight: 600,
                  }}
                >
                  {r.gapCount} gap{r.gapCount === 1 ? "" : "s"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function dealStatusColor(status: string): string {
  if (status === "in_conveyancing") return "var(--critical, #9A3B34)";
  if (status === "sale_agreed") return "var(--caution, #A9772F)";
  return "var(--ink-500, #6B6153)"; // under_offer
}

// ---------------------------------------------------------------------------
// Deal-doc gaps: PPRA Section 67 disclosure + Certificates of Compliance
// (electrical / entomologist / gas / electric_fence) missing or incomplete
// on any live transfer. Same live-transfer set as the FICA scan.
// ---------------------------------------------------------------------------

type DocGap = {
  kind: "ppra_missing" | "ppra_unanswered" | "ppra_unsigned" | "ppra_concerning_no_explanation" | "cert_missing" | "cert_expired";
  label: string;
  detail?: string;
};

type DealDocGapsRow = {
  transferId: string;
  transferName: string | null;
  status: string;
  propertyId: string | null;
  propertyAddress: string | null;
  gaps: DocGap[];
  gapCount: number;
};

const CERT_LABELS: Record<string, string> = {
  electrical: "Electrical CoC",
  entomologist: "Beetle CoC",
  gas: "Gas CoC",
  electric_fence: "Electric fence CoC",
};

async function loadDealDocGaps(
  supabase: ReturnType<typeof createClient>,
  liveStatuses: readonly string[],
): Promise<DealDocGapsRow[]> {
  const { data: transfers } = await supabase
    .from("transfer")
    .select("id, name, status, property:property_id(id, primary_address, property_type:property_type_id(label))")
    .in("status", liveStatuses as unknown as string[]);
  const transferRows = (transfers ?? []) as any[];
  if (transferRows.length === 0) return [];
  const transferIds = transferRows.map((t) => t.id);
  const propertyIds = Array.from(new Set(transferRows.map((t) => t.property?.id).filter(Boolean))) as string[];

  const [{ data: discHeaders }, { data: discRows }, { data: complianceTypes }, { data: certs }] = await Promise.all([
    supabase
      .from("ppra_disclosure")
      .select("id, transfer_id, form_type, signed_at")
      .in("transfer_id", transferIds),
    supabase
      .from("ppra_disclosure_answer_row")
      .select("disclosure_id, question_key, answer, explanation"),
    supabase
      .from("compliance_type")
      .select("id, code, label")
      .in("code", ["electrical", "entomologist", "gas", "electric_fence"]),
    supabase
      .from("compliance_cert")
      .select("id, property_id, transfer_id, compliance_type_id, expiry_date")
      .in("property_id", propertyIds),
  ]);

  const typeById = new Map<string, string>();
  const typeIdByCode = new Map<string, string>();
  for (const ct of (complianceTypes ?? []) as any[]) {
    typeById.set(ct.id, ct.code);
    typeIdByCode.set(ct.code, ct.id);
  }

  // index disclosure headers by transfer, rows by disclosure
  const headerByTransfer = new Map<string, any>();
  for (const h of (discHeaders ?? []) as any[]) headerByTransfer.set(h.transfer_id, h);
  const rowsByDisclosure = new Map<string, any[]>();
  for (const r of (discRows ?? []) as any[]) {
    const arr = rowsByDisclosure.get(r.disclosure_id) ?? [];
    arr.push(r);
    rowsByDisclosure.set(r.disclosure_id, arr);
  }

  // certs by (property, type) — prefer transfer-scoped when present
  const certByKey = new Map<string, { expiry: string | null }>();
  for (const c of (certs ?? []) as any[]) {
    const key = c.transfer_id ? `${c.property_id}::${c.transfer_id}::${c.compliance_type_id}` : `${c.property_id}::*::${c.compliance_type_id}`;
    certByKey.set(key, { expiry: c.expiry_date ?? null });
  }

  const today = new Date().toISOString().slice(0, 10);
  const out: DealDocGapsRow[] = [];

  for (const t of transferRows) {
    const propId = t.property?.id as string | undefined;
    if (!propId) continue;
    const propTypeLabel = (t.property?.property_type?.label ?? "").toString().toLowerCase();
    const formType: PpraFormType = /vacant|plot|land|erf$/.test(propTypeLabel) ? "plot" : "house";
    const canonical = questionsFor(formType);
    const gaps: DocGap[] = [];

    // PPRA disclosure
    const header = headerByTransfer.get(t.id);
    if (!header) {
      gaps.push({ kind: "ppra_missing", label: `PPRA ${formType} disclosure — not started` });
    } else {
      const rows = rowsByDisclosure.get(header.id) ?? [];
      const summary = summariseAnswers(rows.map((r) => ({ question_key: r.question_key, answer: r.answer, explanation: r.explanation })), formType);
      if (summary.unanswered > 0) {
        gaps.push({ kind: "ppra_unanswered", label: `PPRA disclosure — ${summary.unanswered}/${canonical.length} unanswered` });
      }
      if (summary.concerningMissingExplanation > 0) {
        gaps.push({ kind: "ppra_concerning_no_explanation", label: `PPRA disclosure — ${summary.concerningMissingExplanation} concerning answer${summary.concerningMissingExplanation === 1 ? "" : "s"} missing explanation` });
      }
      if (!header.signed_at) {
        gaps.push({ kind: "ppra_unsigned", label: "PPRA disclosure — awaiting seller signature" });
      }
    }

    // Certs
    for (const code of ["electrical", "entomologist", "gas", "electric_fence"] as const) {
      const typeId = typeIdByCode.get(code);
      if (!typeId) continue;
      const scoped = certByKey.get(`${propId}::${t.id}::${typeId}`);
      const propLevel = certByKey.get(`${propId}::*::${typeId}`);
      const cert = scoped ?? propLevel;
      if (!cert) {
        gaps.push({ kind: "cert_missing", label: `${CERT_LABELS[code]} — outstanding` });
      } else if (cert.expiry && cert.expiry < today) {
        gaps.push({ kind: "cert_expired", label: `${CERT_LABELS[code]} — expired`, detail: cert.expiry });
      }
    }

    if (gaps.length > 0) {
      out.push({
        transferId: t.id,
        transferName: t.name ?? null,
        status: t.status,
        propertyId: propId,
        propertyAddress: t.property?.primary_address ?? null,
        gaps,
        gapCount: gaps.length,
      });
    }
  }
  return out;
}

function DealDocGaps({ rows }: { rows: DealDocGapsRow[] }) {
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ borderLeft: "3px solid var(--caution, #A9772F)", paddingLeft: 12, marginBottom: 12 }}>
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
          PPRA disclosure &amp; certificates · Gaps on live deals · {rows.length} {rows.length === 1 ? "deal" : "deals"}
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--paper-mute, #6a7692)" }}>
          Transfers in flight where the Section 67 disclosure is incomplete/unsigned or a Certificate of Compliance
          (electrical / beetle / gas / electric fence) is missing or expired.
        </p>
      </div>
      {rows.length === 0 ? (
        <p style={{ color: "var(--paper-mute, #6a7692)", fontStyle: "italic", padding: "12px 0 12px" }}>
          Every live deal has a complete PPRA disclosure and every required certificate on file. Nothing to chase.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li
              key={r.transferId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                padding: "14px 0",
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
                  {r.propertyId ? (
                    <Link href={`/properties/${r.propertyId}`} style={{ color: "inherit" }}>
                      {r.propertyAddress ?? r.transferName ?? r.transferId.slice(0, 8)}
                    </Link>
                  ) : (
                    r.transferName ?? r.transferId.slice(0, 8)
                  )}
                </p>
                <p
                  style={{
                    margin: "2px 0 8px",
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 10,
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    color: dealStatusColor(r.status),
                  }}
                >
                  {r.status.replace(/_/g, " ")}
                </p>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  {r.gaps.map((g, i) => (
                    <li key={i} style={{ fontSize: 12, color: "var(--ink-700, #423B31)", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: gapDotColor(g.kind) }} />
                      {g.label}
                      {g.detail && <span style={{ color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10 }}>{g.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div style={{ textAlign: "right", minWidth: 100 }}>
                <p
                  style={{
                    margin: 0,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 13,
                    color: "var(--caution, #A9772F)",
                    fontWeight: 600,
                  }}
                >
                  {r.gapCount} gap{r.gapCount === 1 ? "" : "s"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function gapDotColor(kind: DocGap["kind"]): string {
  if (kind === "cert_expired" || kind === "ppra_concerning_no_explanation") return "var(--critical, #9A3B34)";
  return "var(--caution, #A9772F)";
}
