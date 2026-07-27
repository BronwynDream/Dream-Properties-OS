import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import { getSetting } from "@/lib/settings";
import TypeFilterChips from "./TypeFilterChips";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

type MandateType = "exclusive" | "sole" | "joint" | "open";
const MANDATE_TYPES: MandateType[] = ["exclusive", "sole", "joint", "open"];

type MandateRow = {
  id: string;
  listing_id: string;
  type: MandateType;
  evidence: string;
  signed_date: string | null;
  expiry_date: string | null;
  counterparty_agency: { name: string | null } | null;
  listing: {
    id: string;
    status: string;
    property_id: string;
    property: { primary_address: string | null; suburb: { name: string | null } | null };
    agent: { name: string | null; email: string | null } | null;
  };
};

// Active-listing statuses. A mandate on a sold/withdrawn/expired listing is
// moot for a watchlist — the property is off market. Draft included because
// the mandate is often signed before the listing goes live.
const ACTIVE_STATUSES = ["draft", "live", "under_offer"] as const;

type Search = { types?: string };

function parseTypes(raw: string | undefined): Set<MandateType> {
  if (raw == null || raw === "") return new Set<MandateType>(MANDATE_TYPES);
  const wanted = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is MandateType =>
        (MANDATE_TYPES as string[]).includes(s),
      ),
  );
  return wanted.size > 0 ? wanted : new Set<MandateType>(MANDATE_TYPES);
}

// Days from today (00:00 SAST) to the given ISO date. Positive = future,
// negative = past, 0 = today. Uses UTC-midnight arithmetic so timezone
// offsets don't shift a mandate by a day on either side of midnight.
function daysFrom(dateStr: string): number {
  const today = new Date();
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const d = new Date(dateStr);
  const d0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((d0 - t0) / 86_400_000);
}

function formatExpiryLine(daysUntil: number): string {
  if (daysUntil < 0) {
    const n = Math.abs(daysUntil);
    return `Expired ${n} day${n === 1 ? "" : "s"} ago`;
  }
  if (daysUntil === 0) return "Expires today";
  return `Expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
}

export default async function MandatesPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledTypes = parseTypes(searchParams.types);
  const thresholds = await getSetting("mandate.expiry_window_days");
  // Ascending, deduped, positive-only. Guards a bad settings row.
  const sortedThresholds = Array.from(
    new Set(thresholds.filter((n) => Number.isFinite(n) && n > 0)),
  ).sort((a, b) => a - b);

  // Pull every mandate on active listings, along with property + agent so
  // the whole page renders from one round-trip. Dream's mandate volume is
  // small enough (~tens) that pagination isn't needed.
  const { data: mandatesData } = await supabase
    .from("mandate")
    .select(
      `
      id, listing_id, type, evidence, signed_date, expiry_date,
      counterparty_agency:counterparty_agency_id(name),
      listing:listing_id(
        id, status, property_id,
        property:property_id(primary_address, suburb:suburb_id(name)),
        agent:agent_user_id(name, email)
      )
    `,
    )
    .in("listing.status", ACTIVE_STATUSES as unknown as string[]);
  const raw = (mandatesData ?? []) as any[];

  // Supabase's implicit LEFT JOIN means listing-status filter above only
  // affects the join, not the outer row set — we still need to drop rows
  // whose listing didn't survive the filter (listing will be null).
  const mandates: MandateRow[] = raw
    .filter((m) => m.listing != null && ACTIVE_STATUSES.includes(m.listing.status))
    .map((m) => ({
      id: m.id,
      listing_id: m.listing_id,
      type: m.type,
      evidence: m.evidence,
      signed_date: m.signed_date,
      expiry_date: m.expiry_date,
      counterparty_agency: m.counterparty_agency ?? null,
      listing: m.listing,
    }));

  // For each listing, keep only the mandate with the most-forward expiry.
  // Null-expiry rows are their own bucket, so we treat NULL as "no known
  // expiry" and let them survive alongside the max-expiry pick — a
  // half-populated listing (one mandate with expiry, one without) then
  // shows both on the watchlist as separate rows, which is the correct
  // data-hygiene prompt.
  const byListing = new Map<string, MandateRow[]>();
  for (const m of mandates) {
    const arr = byListing.get(m.listing_id) ?? [];
    arr.push(m);
    byListing.set(m.listing_id, arr);
  }

  const nullExpiry: MandateRow[] = [];
  const withExpiry: { row: MandateRow; daysUntil: number }[] = [];

  for (const [, arr] of byListing) {
    const nulls = arr.filter((m) => m.expiry_date == null);
    const dated = arr.filter((m) => m.expiry_date != null);
    // Push every null-expiry as its own row — they need attention regardless
    // of whether another mandate on the listing has a date.
    for (const m of nulls) nullExpiry.push(m);
    if (dated.length > 0) {
      // Latest expiry wins; ties broken by signed_date desc.
      dated.sort((a, b) => {
        const de = (b.expiry_date ?? "").localeCompare(a.expiry_date ?? "");
        if (de !== 0) return de;
        return (b.signed_date ?? "").localeCompare(a.signed_date ?? "");
      });
      const winner = dated[0];
      withExpiry.push({ row: winner, daysUntil: daysFrom(winner.expiry_date!) });
    }
  }

  // Bucket the dated set. Expired (< 0) first, then one bucket per
  // threshold in ascending order. Rows further out than the largest
  // threshold are not on the watchlist — they aren't "expiring soon".
  const expiredRows = withExpiry
    .filter((x) => x.daysUntil < 0)
    .sort((a, b) => a.daysUntil - b.daysUntil); // most overdue first

  type Bucket = { label: string; note: string; rows: { row: MandateRow; daysUntil: number }[] };
  const thresholdBuckets: Bucket[] = [];
  let prev = 0;
  for (const t of sortedThresholds) {
    const inThis = withExpiry
      .filter((x) => x.daysUntil >= prev && x.daysUntil <= t)
      .sort((a, b) => a.daysUntil - b.daysUntil);
    const label =
      prev === 0
        ? `Expiring in ${t} days`
        : `Expiring in ${prev + 1}–${t} days`;
    const note =
      prev === 0
        ? `Mandates lapsing today through ${t} days out.`
        : `Mandates ${prev + 1}–${t} days out — plan the renewal conversation now.`;
    thresholdBuckets.push({ label, note, rows: inThis });
    prev = t;
  }

  // Apply the type filter as the last step so counts on each section header
  // reflect what the user has selected, not the underlying total.
  function filtered<T extends { row: MandateRow }>(rows: T[]): T[] {
    return rows.filter((x) => enabledTypes.has(x.row.type));
  }
  const expiredFiltered = filtered(expiredRows);
  const thresholdBucketsFiltered = thresholdBuckets.map((b) => ({
    ...b,
    rows: filtered(b.rows),
  }));
  const unknownFiltered = nullExpiry
    .filter((m) => enabledTypes.has(m.type))
    .sort((a, b) => (b.signed_date ?? "").localeCompare(a.signed_date ?? ""));

  const totalOnWatchlist =
    expiredFiltered.length +
    thresholdBucketsFiltered.reduce((s, b) => s + b.rows.length, 0) +
    unknownFiltered.length;

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Mandates</p>
          <h1>
            {totalOnWatchlist === 0
              ? "Nothing on the watchlist"
              : `${totalOnWatchlist} mandate${totalOnWatchlist === 1 ? "" : "s"} need attention`}
          </h1>
          <p className="app-sub">
            Windows configured at{" "}
            <Link href="/settings" style={{ color: "var(--navy)", fontWeight: 600 }}>
              Settings
            </Link>
            : {sortedThresholds.join(" / ")} days.
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <TypeFilterChips enabled={enabledTypes} />

          {totalOnWatchlist === 0 ? (
            <p style={{ color: "var(--paper-mute)", fontStyle: "italic", padding: "24px 0" }}>
              No mandates match the current filter, or every mandate on an
              active listing has more than {sortedThresholds[sortedThresholds.length - 1] ?? 60} days
              of runway left. Adjust the type filter above, or widen the
              windows in Settings.
            </p>
          ) : (
            <>
              <MandateSection
                title={`Expired (unresolved) · ${expiredFiltered.length}`}
                note="Latest mandate on the listing is past its expiry_date. Renew or record a replacement."
                rows={expiredFiltered}
                tone="alert"
              />
              {thresholdBucketsFiltered.map((b) => (
                <MandateSection
                  key={b.label}
                  title={`${b.label} · ${b.rows.length}`}
                  note={b.note}
                  rows={b.rows}
                  tone="warn"
                />
              ))}
              <MandateSection
                title={`Unknown expiry · ${unknownFiltered.length}`}
                note="Active mandates with no expiry_date recorded. Backfill from the signed PDF or email thread."
                rows={unknownFiltered.map((row) => ({ row, daysUntil: NaN }))}
                tone="info"
              />
            </>
          )}
        </section>
      </main>
    </>
  );
}

function MandateSection({
  title,
  note,
  rows,
  tone,
}: {
  title: string;
  note: string;
  rows: { row: MandateRow; daysUntil: number }[];
  tone: "alert" | "warn" | "info";
}) {
  if (rows.length === 0) return null;
  const stripeColor =
    tone === "alert" ? "var(--amber, #D17E22)" : tone === "warn" ? "var(--gold, #C8A032)" : "var(--mist, #cfd7e6)";
  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          borderLeft: `3px solid ${stripeColor}`,
          paddingLeft: 12,
          marginBottom: 12,
        }}
      >
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
        {rows.map(({ row, daysUntil }) => (
          <MandateEntry key={row.id} row={row} daysUntil={daysUntil} />
        ))}
      </ul>
    </div>
  );
}

function MandateEntry({ row, daysUntil }: { row: MandateRow; daysUntil: number }) {
  const address = row.listing.property?.primary_address ?? "Unknown address";
  const suburb = row.listing.property?.suburb?.name ?? null;
  const agentName = row.listing.agent?.name ?? "Unassigned";
  const isNullExpiry = Number.isNaN(daysUntil);

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "start",
        gap: 12,
        padding: "12px 0",
        borderBottom: "1px solid var(--hairline, #e2e8f5)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Link
          href={`/properties/${row.listing.property_id}`}
          style={{
            fontFamily: "'Fraunces', 'Cormorant Garamond', serif",
            fontSize: 18,
            color: "var(--estuary, #132B84)",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          {address}
        </Link>
        {suburb && (
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12,
              color: "var(--paper-mute, #6a7692)",
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              letterSpacing: "0.04em",
            }}
          >
            {suburb.toUpperCase()}
          </p>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <span
            className={`m-chip mandate-${row.type}`}
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: 3,
              background: "var(--paper-bg, #f5f1e8)",
              border: "1px solid var(--hairline, #e2e8f5)",
            }}
          >
            {row.type}
          </span>
          <span style={{ fontSize: 12, color: "var(--paper-mute, #6a7692)" }}>
            Agent: {agentName}
          </span>
          {row.counterparty_agency?.name && (
            <span style={{ fontSize: 12, color: "var(--paper-mute, #6a7692)" }}>
              Joint w/ {row.counterparty_agency.name}
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              color: "var(--paper-mute, #6a7692)",
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              letterSpacing: "0.04em",
            }}
          >
            Evidence: {row.evidence.replace(/_/g, " ")}
          </span>
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 140 }}>
        {isNullExpiry ? (
          <p
            style={{
              margin: 0,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 12,
              color: "var(--paper-mute, #6a7692)",
              letterSpacing: "0.02em",
            }}
          >
            No expiry recorded
          </p>
        ) : (
          <>
            <p
              style={{
                margin: 0,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 13,
                color: daysUntil < 0 ? "var(--amber, #D17E22)" : "var(--estuary, #132B84)",
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              {formatExpiryLine(daysUntil)}
            </p>
            {row.expiry_date && (
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 11,
                  color: "var(--paper-mute, #6a7692)",
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                }}
              >
                {row.expiry_date}
              </p>
            )}
          </>
        )}
      </div>
    </li>
  );
}
