import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import { Rand } from "@/app/components/format";
import StageMover from "./StageMover";
import DuplicateTransfersBanner from "./DuplicateTransfersBanner";
import {
  PIPELINE_STAGES,
  STAGE_HELP,
  STAGE_LABEL,
  STAGE_STRIPE,
  type PipelineStage,
} from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pipeline kanban — every deal in flight, one column per lifecycle
// stage, cards ranked by days-in-stage (stickiest at top so Bronwyn
// sees stuck deals first). Estate-agency-design skill's pipeline
// pattern: monetary total per column (mono), left-edge stripe carries
// deal-stage colour, "under offer" is caution not success.
//
// Role scoping:
//   admin: sees every live transfer
//   agent: sees only transfers whose listing carries their agent id
//
// Terminal stages (registered / cancelled / lapsed) are not rendered as
// their own columns — they appear as a small "recently done" strip at
// the bottom for context.

type TransferCard = {
  id: string;
  propertyId: string | null;
  propertyAddress: string | null;
  status: PipelineStage;
  statusChangedAt: string | null;
  daysInStage: number;
  price: number | null;
  buyers: string[];
  sellers: string[];
  agentName: string | null;
  mandateType: string | null;
  mandateExpiry: string | null;
};

export default async function PipelinePage() {
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

  // 1. All live transfers (any of the pipeline stages, excluding
  //    terminal ones). If agent role, we filter to their listings
  //    after the fetch — easier than a nested filter.
  const { data: transferRows } = await supabase
    .from("transfer")
    .select(
      "id, status, status_changed_at, property_id, property:property_id(id, primary_address)",
    )
    .in("status", PIPELINE_STAGES as unknown as string[]);
  const rawTransfers = ((transferRows ?? []) as any[]).filter(
    (t) => PIPELINE_STAGES.includes(t.status),
  );

  if (rawTransfers.length === 0) {
    return (
      <>
        <TopBar />
        <main>
          <header className="app-head">
            <p className="eyebrow">Dream Knysna · Pipeline</p>
            <h1>No live deals</h1>
            <p className="app-sub">
              Nothing in flight. When a new transfer is created (via Triage or
              Take-on) it&apos;ll appear here in the appropriate column.
            </p>
          </header>
          <hr className="tideline" />
        </main>
      </>
    );
  }

  const transferIds = rawTransfers.map((t) => t.id);
  const propertyIds = Array.from(new Set(rawTransfers.map((t) => t.property_id).filter(Boolean))) as string[];

  // 2. Parties, agreements, listings (for agent scoping + mandate tag) — parallel.
  //    Mandate query is chained after listings resolve (needs listing_ids).
  const [{ data: tps }, { data: agrs }, { data: listings }] = await Promise.all([
    supabase
      .from("transfer_party")
      .select("transfer_id, side, party:party_id(id, display_name)")
      .in("transfer_id", transferIds),
    supabase
      .from("agreement")
      .select("transfer_id, price, agreement_type, version")
      .in("transfer_id", transferIds),
    supabase
      .from("listing")
      .select("id, transfer_id, property_id, agent_user_id, agent:agent_user_id(id, full_name)")
      .in("transfer_id", transferIds),
  ]);
  const listingIds = ((listings ?? []) as any[]).map((l) => l.id);
  const { data: mandatesReal } = listingIds.length > 0
    ? await supabase
        .from("mandate")
        .select("listing_id, mandate_type, expiry_date, signed_at")
        .in("listing_id", listingIds)
    : { data: [] as any[] };

  // Best price per transfer = most recent sale-type agreement version
  const priceByTransfer = new Map<string, number>();
  for (const a of (agrs ?? []) as any[]) {
    if (a.price == null) continue;
    if (a.agreement_type !== "sale_improved" && a.agreement_type !== "sale_land_freehold") continue;
    const cur = priceByTransfer.get(a.transfer_id);
    if (cur == null || (a.version ?? 0) > 0) priceByTransfer.set(a.transfer_id, Number(a.price));
  }

  // Buyers / sellers per transfer
  const buyersByTransfer = new Map<string, string[]>();
  const sellersByTransfer = new Map<string, string[]>();
  for (const tp of (tps ?? []) as any[]) {
    const name = tp.party?.display_name;
    if (!name) continue;
    if (tp.side === "purchaser") {
      const arr = buyersByTransfer.get(tp.transfer_id) ?? [];
      arr.push(name);
      buyersByTransfer.set(tp.transfer_id, arr);
    } else if (tp.side === "seller") {
      const arr = sellersByTransfer.get(tp.transfer_id) ?? [];
      arr.push(name);
      sellersByTransfer.set(tp.transfer_id, arr);
    }
  }

  // Agent per transfer + mandate details
  const listingByTransfer = new Map<string, any>();
  for (const l of (listings ?? []) as any[]) listingByTransfer.set(l.transfer_id, l);
  const mandateByListing = new Map<string, any>();
  for (const m of (mandatesReal ?? []) as any[]) {
    const cur = mandateByListing.get(m.listing_id);
    // Latest signed wins
    if (!cur || (m.signed_at ?? "") > (cur.signed_at ?? "")) mandateByListing.set(m.listing_id, m);
  }

  // 3. Build cards, then role-scope (agent sees only theirs)
  const today0 = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const cards: TransferCard[] = rawTransfers.map((t) => {
    const listing = listingByTransfer.get(t.id);
    const mandate = listing ? mandateByListing.get(listing.id) : null;
    const changed = t.status_changed_at ? Date.parse(t.status_changed_at) : Date.now();
    const days = Math.max(0, Math.floor((today0 - changed) / 86_400_000));
    const agentJoin = Array.isArray(listing?.agent) ? listing.agent[0] : listing?.agent;
    return {
      id: t.id,
      propertyId: t.property?.id ?? t.property_id ?? null,
      propertyAddress: t.property?.primary_address ?? null,
      status: t.status as PipelineStage,
      statusChangedAt: t.status_changed_at ?? null,
      daysInStage: days,
      price: priceByTransfer.get(t.id) ?? null,
      buyers: buyersByTransfer.get(t.id) ?? [],
      sellers: sellersByTransfer.get(t.id) ?? [],
      agentName: agentJoin?.full_name ?? null,
      mandateType: mandate?.mandate_type ?? null,
      mandateExpiry: mandate?.expiry_date ?? null,
    };
  });

  const scopedCards = isAdmin
    ? cards
    : cards.filter((c) => {
        const listing = listingByTransfer.get(c.id);
        return listing?.agent_user_id === profile.id;
      });

  // 4. Group by column, sort by days-in-stage (descending — stuck deals bubble up)
  const byStage = new Map<PipelineStage, TransferCard[]>();
  for (const s of PIPELINE_STAGES) byStage.set(s, []);
  for (const c of scopedCards) byStage.get(c.status)?.push(c);
  for (const s of PIPELINE_STAGES) {
    byStage.get(s)?.sort((a, b) => b.daysInStage - a.daysInStage);
  }

  const totalDeals = scopedCards.length;
  const totalRand = scopedCards.reduce((s, c) => s + (c.price ?? 0), 0);

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Pipeline{isAdmin ? "" : " · your deals"}</p>
          <h1>
            {totalDeals} deal{totalDeals === 1 ? "" : "s"} in flight
          </h1>
          <p className="app-sub" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12 }}>
            Total pipeline value <Rand value={totalRand} />
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body" style={{ overflowX: "auto" }}>
          <DuplicateTransfersBanner
            cards={scopedCards.map((c) => ({
              id: c.id,
              propertyId: c.propertyId,
              propertyAddress: c.propertyAddress,
              status: c.status,
              daysInStage: c.daysInStage,
            }))}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${PIPELINE_STAGES.length}, minmax(260px, 1fr))`,
              gap: 14,
              alignItems: "start",
              paddingBottom: 24,
            }}
          >
            {PIPELINE_STAGES.map((stage) => (
              <PipelineColumn key={stage} stage={stage} cards={byStage.get(stage) ?? []} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function PipelineColumn({ stage, cards }: { stage: PipelineStage; cards: TransferCard[] }) {
  const total = cards.reduce((s, c) => s + (c.price ?? 0), 0);
  const stripe = STAGE_STRIPE[stage];
  return (
    <div
      style={{
        background: "var(--paper-1, #F5F1E8)",
        borderTop: `3px solid ${stripe}`,
        borderRadius: "0 0 6px 6px",
        padding: "10px 10px 14px",
        minHeight: 140,
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <p
          style={{
            margin: 0,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--ink-500, #6B6153)",
          }}
        >
          {STAGE_LABEL[stage]} · {cards.length}
        </p>
        <p style={{ margin: "2px 0 0", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, color: "var(--ink-700, #423B31)" }}>
          <Rand value={total} />
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--paper-mute, #6a7692)" }}>
          {STAGE_HELP[stage]}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {cards.length === 0 ? (
          <p style={{ margin: 0, fontSize: 11, color: "var(--paper-mute, #6a7692)", fontStyle: "italic" }}>
            Empty
          </p>
        ) : (
          cards.map((c) => <PipelineCard key={c.id} card={c} />)
        )}
      </div>
    </div>
  );
}

function PipelineCard({ card }: { card: TransferCard }) {
  const stripe = STAGE_STRIPE[card.status];
  const stuckTone = card.daysInStage >= 30 ? "var(--critical, #9A3B34)" : card.daysInStage >= 14 ? "var(--caution, #A9772F)" : "var(--paper-mute, #6a7692)";
  return (
    <article
      style={{
        background: "var(--paper-0, #FBF9F4)",
        borderLeft: `3px solid ${stripe}`,
        borderRadius: "0 4px 4px 0",
        padding: "10px 12px",
        boxShadow: "0 1px 2px rgba(31,27,22,.06)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 10,
            color: stuckTone,
            fontWeight: 600,
            letterSpacing: "0.06em",
          }}
        >
          {card.daysInStage}d
        </span>
        {card.price !== null && (
          <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, color: "var(--estuary, #132B84)", fontWeight: 600 }}>
            <Rand value={card.price} />
          </span>
        )}
      </div>
      {card.propertyId ? (
        <Link
          href={`/properties/${card.propertyId}`}
          prefetch={false}
          style={{
            margin: 0,
            fontFamily: "'Fraunces', 'Cormorant Garamond', serif",
            fontSize: 14,
            color: "var(--estuary, #132B84)",
            fontWeight: 500,
            textDecoration: "none",
            lineHeight: 1.25,
          }}
        >
          {card.propertyAddress ?? card.id.slice(0, 8)}
        </Link>
      ) : (
        <p
          style={{
            margin: 0,
            fontFamily: "'Fraunces', 'Cormorant Garamond', serif",
            fontSize: 14,
            color: "var(--estuary, #132B84)",
            fontWeight: 500,
          }}
        >
          {card.id.slice(0, 8)}
        </p>
      )}

      {(card.sellers.length > 0 || card.buyers.length > 0) && (
        <div style={{ fontSize: 11, color: "var(--ink-700, #423B31)", lineHeight: 1.35 }}>
          {card.sellers.length > 0 && (
            <p style={{ margin: 0 }}>
              <span style={{ color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase" }}>Seller · </span>
              {card.sellers.join(", ")}
            </p>
          )}
          {card.buyers.length > 0 && (
            <p style={{ margin: 0 }}>
              <span style={{ color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase" }}>Buyer · </span>
              {card.buyers.join(", ")}
            </p>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2, fontSize: 10, color: "var(--paper-mute, #6a7692)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {card.agentName && <span>{card.agentName}</span>}
        {card.mandateType && (
          <span style={{ padding: "1px 6px", background: "var(--paper-2, #ECE6D8)", borderRadius: 2 }}>
            {card.mandateType.replace(/_/g, " ")}
          </span>
        )}
      </div>

      <StageMover transferId={card.id} currentStage={card.status} />
    </article>
  );
}
