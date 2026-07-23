import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

function daysBetween(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function humanStatus(raw: string | null | undefined): string {
  if (!raw) return "—";
  if (raw === "in_conveyancing") return "In conveyancing";
  if (raw === "registered") return "Registered";
  if (raw === "preparing") return "Preparing";
  return raw.replace(/_/g, " ");
}

function money(n: number | null | undefined): string {
  if (n == null) return "Price on request";
  if (n >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `R ${(n / 1_000).toFixed(0)}k`;
  return `R ${n}`;
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
  const isAdmin = profile?.role === "admin";

  // Three data pulls that feed the columns + Attention row.
  const [inFlightData, liveListingsData, waitingBatchesData] =
    await Promise.all([
      supabase
        .from("transfer")
        .select(
          "id, name, status, transfer_date, created_at, property:property_id(id, primary_address, suburb:suburb_id(name))",
        )
        .eq("status", "in_conveyancing")
        .order("transfer_date", { ascending: true, nullsFirst: false })
        .limit(6),
      supabase
        .from("listing")
        .select(
          "id, asking_price, listed_date, property:property_id(id, primary_address, suburb:suburb_id(name)), mandate:mandate(type)",
        )
        .eq("status", "live")
        .order("listed_date", { ascending: false, nullsFirst: false })
        .limit(6),
      supabase
        .from("ingest_batch")
        .select("id, label, status, tier, created_at")
        .neq("status", "committed")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

  const inFlight = (inFlightData.data ?? []) as any[];
  const liveListings = (liveListingsData.data ?? []) as any[];
  const waitingBatches = (waitingBatchesData.data ?? []) as any[];

  // Dupe callout — admins only. Two RPCs kept off the initial Promise.all so
  // agents (majority of loads) never pay the pairwise-scan cost. Limit 20:
  // if there are more, we render "20+" — the point is to drive review, not
  // to render an exhaustive list.
  const DUPE_LIMIT = 20;
  const [propertyDupeCount, partyDupeCount] = isAdmin
    ? await Promise.all([
        supabase
          .rpc("find_property_dupes", { p_threshold: 0.5, p_limit: DUPE_LIMIT })
          .then((r) => (r.data ?? []).length),
        supabase
          .rpc("find_party_dupes", { p_threshold: 0.5, p_limit: DUPE_LIMIT })
          .then((r) => (r.data ?? []).length),
      ])
    : [0, 0];
  const totalDupeCount = propertyDupeCount + partyDupeCount;
  const dupeCountCapped =
    propertyDupeCount >= DUPE_LIMIT || partyDupeCount >= DUPE_LIMIT;

  // Attention row: 3-5 items that need eyes on them today, ranked by
  // urgency. Replaces the "hero property" that hijacked the viewport with
  // one deal — Bronwyn opens the app for breadth (what's happening across
  // the book), not depth (one property). Categories, high → low urgency:
  //   1. Overdue transfers  (in_conveyancing past transfer_date)
  //   2. Red-tier review batches
  //   3. Imminent transfers (in_conveyancing within 14 days)
  //   4. Amber-tier review batches
  //   5. Dupe pairs to review (admins only)
  type AttentionItem = {
    key: string;
    urgency: number;
    primary: string;
    secondary: string | null;
    payload: string;
    href: string;
    variant: "urgent" | "warn" | "info";
  };
  const attention: AttentionItem[] = [];

  for (const t of inFlight) {
    const days = daysBetween(t.transfer_date);
    if (days == null) continue;
    if (days < 0) {
      const overdue = Math.abs(days);
      attention.push({
        key: `overdue-${t.id}`,
        urgency: 10000 + overdue,
        primary: t.property?.primary_address ?? t.name,
        secondary: t.property?.suburb?.name ?? null,
        payload: `${overdue} d past transfer date`,
        href: t.property?.id ? `/properties/${t.property.id}` : "#",
        variant: "urgent",
      });
    } else if (days <= 14) {
      attention.push({
        key: `imminent-${t.id}`,
        urgency: 3000 - days,
        primary: t.property?.primary_address ?? t.name,
        secondary: t.property?.suburb?.name ?? null,
        payload:
          days === 0
            ? "transfers today"
            : `transfer in ${days} d`,
        href: t.property?.id ? `/properties/${t.property.id}` : "#",
        variant: days <= 3 ? "urgent" : "warn",
      });
    }
  }

  for (const b of waitingBatches) {
    if (b.tier === "red" || b.tier === "amber") {
      attention.push({
        key: `batch-${b.id}`,
        urgency: b.tier === "red" ? 8000 : 2000,
        primary: b.label ?? "Dropped batch",
        secondary: "awaiting review",
        payload: b.tier.toUpperCase(),
        href: `/triage/${b.id}`,
        variant: b.tier === "red" ? "urgent" : "warn",
      });
    }
  }

  if (isAdmin && totalDupeCount > 0) {
    attention.push({
      key: "dupes",
      urgency: 1500,
      primary: `${totalDupeCount}${dupeCountCapped ? "+" : ""} likely duplicate${totalDupeCount === 1 && !dupeCountCapped ? "" : "s"}`,
      secondary: "awaiting merge review",
      payload: "DUPES",
      href: "/dupes",
      variant: "info",
    });
  }

  attention.sort((a, b) => b.urgency - a.urgency);
  const topAttention = attention.slice(0, 5);

  const totalNothing =
    inFlight.length === 0 && liveListings.length === 0 && waitingBatches.length === 0;

  return (
    <>
      <TopBar />
      <main className="page">
        {/* Attention row — 3-5 items that need eyes on them today, ranked by
            urgency. If nothing needs attention we show a small "caught up"
            state instead of hiding, so the section is a stable landmark. */}
        <section className="dash-attention">
          <p className="dash-attention-eyebrow">Attention today</p>
          {topAttention.length === 0 ? (
            <div className="dash-attention-empty">
              <p>Nothing needs attention right now — everything&apos;s caught up.</p>
            </div>
          ) : (
            <ul className="dash-attention-list">
              {topAttention.map((a) => (
                <li key={a.key}>
                  <Link
                    href={a.href}
                    className={`dash-attention-row dash-attention-${a.variant}`}
                  >
                    <span className="dash-attention-icon" aria-hidden>
                      {a.variant === "urgent" ? "▲" : a.variant === "warn" ? "◆" : "●"}
                    </span>
                    <div className="dash-attention-body">
                      <span className="dash-attention-primary">{a.primary}</span>
                      {a.secondary && (
                        <span className="dash-attention-secondary">{a.secondary}</span>
                      )}
                    </div>
                    <span className="dash-attention-payload">{a.payload}</span>
                    <span className="dash-attention-arrow" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {totalNothing && topAttention.length === 0 && (
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
            Nothing in flight anywhere. Drop a folder in{" "}
            <Link href="/triage" className="row-link" style={{ fontWeight: 600 }}>
              triage
            </Link>{" "}
            to bring in more deals.
          </p>
        )}

        {/* Director callout — only when there are pending dupe pairs. Sits
            between the hero and the work columns so a Director's eye lands
            on it before they dive into today's queue. */}
        {isAdmin && totalDupeCount > 0 && (
          <Link href="/dupes" className="dash-dupes-callout">
            <div className="dash-dupes-body">
              <p className="dash-dupes-eyebrow">Directors — needs a look</p>
              <h2 className="dash-dupes-headline">
                {totalDupeCount}
                {dupeCountCapped ? "+" : ""} likely duplicate
                {totalDupeCount === 1 && !dupeCountCapped ? "" : "s"} to review
              </h2>
              <p className="dash-dupes-breakdown">
                {propertyDupeCount > 0 && (
                  <>
                    <b>{propertyDupeCount}</b>{" "}
                    propert{propertyDupeCount === 1 ? "y" : "ies"}
                  </>
                )}
                {propertyDupeCount > 0 && partyDupeCount > 0 && " · "}
                {partyDupeCount > 0 && (
                  <>
                    <b>{partyDupeCount}</b>{" "}
                    part{partyDupeCount === 1 ? "y" : "ies"}
                  </>
                )}
              </p>
            </div>
            <span className="dash-dupes-arrow" aria-hidden>
              →
            </span>
          </Link>
        )}

        {/* Three columns of work */}
        <div className="dash-work">
          <WorkColumn
            title="Deals in flight"
            count={inFlight.length}
            emptyText="No conveyancing right now. Deals appear here once an agreement is signed."
            emptyCta={null}
          >
            {inFlight.map((t) => {
              const days = daysBetween(t.transfer_date);
              return (
                <WorkRow
                  key={t.id}
                  href={t.property?.id ? `/properties/${t.property.id}` : "#"}
                  primary={t.property?.primary_address ?? t.name}
                  secondary={t.property?.suburb?.name ?? null}
                  right={
                    t.transfer_date ? (
                      <span
                        className={`dash-days ${
                          days !== null && days < 7 ? "urgent" : ""
                        }`}
                      >
                        {days === null
                          ? t.transfer_date
                          : days > 0
                            ? `${days} d`
                            : days === 0
                              ? "today"
                              : `${Math.abs(days)} d past`}
                      </span>
                    ) : (
                      <span className="dash-days muted">no date</span>
                    )
                  }
                />
              );
            })}
          </WorkColumn>

          <WorkColumn
            title="Live listings"
            count={liveListings.length}
            emptyText="No listings live. When a mandate goes live, its listing appears here."
            emptyCta={{ href: "/map", label: "Open map" }}
          >
            {liveListings.map((l) => {
              const mandateRow = Array.isArray(l.mandate) ? l.mandate[0] : l.mandate;
              return (
                <WorkRow
                  key={l.id}
                  href={l.property?.id ? `/properties/${l.property.id}` : "/map"}
                  primary={l.property?.primary_address ?? "Unknown address"}
                  secondary={
                    [l.property?.suburb?.name, mandateRow?.type]
                      .filter(Boolean)
                      .join(" · ") || null
                  }
                  right={
                    <span className="dash-price">{money(l.asking_price)}</span>
                  }
                />
              );
            })}
          </WorkColumn>

          <WorkColumn
            title="Waiting for review"
            count={waitingBatches.length}
            emptyText="Nothing waiting. All dropped folders are committed or extracted."
            emptyCta={{ href: "/triage", label: "Open triage" }}
          >
            {waitingBatches.map((b) => (
              <WorkRow
                key={b.id}
                href={`/triage/${b.id}`}
                primary={b.label}
                secondary={humanStatus(b.status)}
                right={
                  b.tier ? (
                    <span className={`tier tier-${b.tier}`}>{b.tier}</span>
                  ) : null
                }
              />
            ))}
          </WorkColumn>
        </div>

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

function WorkColumn({
  title,
  count,
  emptyText,
  emptyCta,
  children,
}: {
  title: string;
  count: number;
  emptyText: string;
  emptyCta: { href: string; label: string } | null;
  children: React.ReactNode;
}) {
  return (
    <section className="dash-col">
      <header className="dash-col-head">
        <h2>{title}</h2>
        <span className="dash-col-count">{count}</span>
      </header>
      {count === 0 ? (
        <div className="dash-col-empty">
          <p>{emptyText}</p>
          {emptyCta && (
            <Link href={emptyCta.href} className="row-link" style={{ fontWeight: 600 }}>
              {emptyCta.label} →
            </Link>
          )}
        </div>
      ) : (
        <ul className="dash-col-list">{children}</ul>
      )}
    </section>
  );
}

function WorkRow({
  href,
  primary,
  secondary,
  right,
}: {
  href: string;
  primary: string;
  secondary: string | null;
  right: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="dash-row">
        <div className="dash-row-body">
          <span className="dash-row-primary">{primary}</span>
          {secondary && <span className="dash-row-secondary">{secondary}</span>}
        </div>
        <div className="dash-row-right">{right}</div>
      </Link>
    </li>
  );
}
