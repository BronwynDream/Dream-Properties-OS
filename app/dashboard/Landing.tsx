import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FEEDS, feedLight, type FeedLatest, type Light } from "@/lib/feeds/registry";

// The landing page proper (plan 019, Arc D1 pulled forward 2026-10-16).
//
// Simon: "when the agent lands on the page, what is it that they are trying
// to use the system for at that point in time?" So the page asks that, in
// the agent's own words, as six tiles, each carrying one live figure. Above
// them, one line of what today holds. Nothing here needs reading before
// clicking; everything that does (the attention list, the work columns)
// stays below.
//
// Server component: all figures are cheap counts, agent-scoped where the
// data has an agent on it.

type Props = {
  supabase: SupabaseClient;
  userId: string;
  firstName: string;
  isAdmin: boolean;
  myListingIds: string[];
  myPropertyIds: string[];
};

type Tile = {
  href: string;
  title: string;
  what: string;
  figure: string | null;
  figureNote?: string | null;
};

const n = (r: { count: number | null }) => r.count ?? 0;
const plural = (c: number, one: string, many = `${one}s`) => `${c} ${c === 1 ? one : many}`;

function greeting(now: Date): string {
  const h = Number(new Intl.DateTimeFormat("en-ZA", { hour: "numeric", hour12: false, timeZone: "Africa/Johannesburg" }).format(now));
  return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
}

export default async function Landing({ supabase, userId, firstName, isAdmin, myListingIds, myPropertyIds }: Props) {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const in30 = new Date(now.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
  const scopedProps = !isAdmin && myPropertyIds.length > 0;
  const scopedListings = !isAdmin && myListingIds.length > 0;

  const [
    viewingsToday, expiring, enquiries,
    liveAll, liveExclusive, inFlight, nearest, drafts, parties, erven, feedRows,
  ] = await Promise.all([
    // Today strip
    (() => {
      let q = supabase.from("viewing").select("id", { count: "exact", head: true })
        .eq("status", "scheduled").gte("scheduled_at", todayStart.toISOString()).lt("scheduled_at", todayEnd.toISOString());
      if (!isAdmin) q = q.eq("agent_user_id", userId);
      return q;
    })(),
    (() => {
      if (!isAdmin && !scopedListings) return Promise.resolve({ count: 0 });
      let q = supabase.from("mandate").select("id", { count: "exact", head: true })
        .not("expiry_date", "is", null).lte("expiry_date", in30).gte("expiry_date", now.toISOString().slice(0, 10));
      if (!isAdmin) q = q.in("listing_id", myListingIds);
      return q;
    })(),
    supabase.from("ingest_batch").select("id", { count: "exact", head: true }).neq("status", "committed"),
    // Tiles
    supabase.from("listing").select("id", { count: "exact", head: true }).eq("status", "live"),
    supabase.from("mandate").select("id", { count: "exact", head: true }).eq("type", "exclusive").or(`expiry_date.is.null,expiry_date.gte.${now.toISOString().slice(0, 10)}`),
    (() => {
      if (!isAdmin && !scopedProps) return Promise.resolve({ count: 0 });
      let q = supabase.from("transfer").select("id", { count: "exact", head: true }).eq("status", "in_conveyancing");
      if (!isAdmin) q = q.in("property_id", myPropertyIds);
      return q;
    })(),
    (() => {
      if (!isAdmin && !scopedProps) return Promise.resolve({ data: null });
      let q = supabase.from("transfer").select("name, transfer_date").eq("status", "in_conveyancing").not("transfer_date", "is", null);
      if (!isAdmin) q = q.in("property_id", myPropertyIds);
      return q.order("transfer_date", { ascending: true }).limit(1).maybeSingle();
    })(),
    supabase.from("document_draft").select("id", { count: "exact", head: true }).eq("status", "draft"),
    supabase.from("party").select("id", { count: "exact", head: true }),
    supabase.from("muni_property").select("sg_number", { count: "exact", head: true }),
    isAdmin ? supabase.from("v_feed_latest").select("feed, status, trigger, started_at, finished_at, items, error") : Promise.resolve({ data: [] }),
  ]);

  const nearestRow = (nearest as { data: { name: string; transfer_date: string } | null }).data;
  const nearestNote = nearestRow ? `next: ${nearestRow.name} · ${fmtDate(nearestRow.transfer_date)}` : null;

  const tiles: Tile[] = [
    {
      href: "/map",
      title: "See what's on the market",
      what: "Every listing on the map — ours, Property24, the competition — over the erven.",
      figure: `${plural(n(liveAll), "live listing")}`,
      figureNote: n(liveExclusive) > 0 ? `${n(liveExclusive)} exclusive` : null,
    },
    {
      href: "/pipeline",
      title: "Work on a deal in progress",
      what: "Offers, conditions, conveyancing — where each sale stands and what's next.",
      figure: plural(n(inFlight), "deal in conveyancing", "deals in conveyancing"),
      figureNote: nearestNote,
    },
    {
      href: "/properties#new",
      title: "I have a new listing",
      what: "Start the property record from the erf, so the deeds, valuation and boundary come with it.",
      figure: `${formatCount(n(erven))} erven on file`,
      figureNote: "Knysna municipal roll",
    },
    {
      href: "/documents",
      title: "Prepare a document",
      what: "Mandates, agreements, addenda — from Bronwyn's templates, filled from the record.",
      figure: plural(n(drafts), "document in progress", "documents in progress"),
    },
    {
      href: "/inbox",
      title: "Follow up on enquiries",
      what: "What came in by email and from the portals, and what's waiting for a reply.",
      figure: plural(n(enquiries), "item waiting", "items waiting"),
    },
    {
      href: "/contacts",
      title: "Find a person",
      what: "Sellers, buyers, conveyancers — who they are and every property they've touched.",
      figure: `${formatCount(n(parties))} people on record`,
    },
  ];

  const today = [
    { href: "/viewings", count: n(viewingsToday), label: plural(n(viewingsToday), "viewing") + " today" },
    { href: "/mandates", count: n(expiring), label: plural(n(expiring), "mandate") + " expiring within 30 days" },
    { href: "/inbox", count: n(enquiries), label: plural(n(enquiries), "enquiry", "enquiries") + " waiting" },
  ];

  let healthLight: Light | null = null;
  if (isAdmin) {
    const latest = new Map<string, FeedLatest>();
    for (const r of ((feedRows as { data: FeedLatest[] | null }).data ?? [])) latest.set(r.feed, r);
    const lights = FEEDS.map((f) => feedLight(f, latest.get(f.key)));
    healthLight = lights.includes("red") ? "red" : lights.includes("amber") ? "amber" : lights.includes("grey") ? "grey" : "green";
  }

  return (
    <section className="land" aria-labelledby="land-greeting">
      <header className="land-head">
        <h1 id="land-greeting" className="land-greeting">
          {greeting(now)}, {firstName}.
        </h1>
        <p className="land-date">
          {new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Johannesburg" }).format(now)}
        </p>
      </header>

      <p className="land-today">
        {today.map((t, i) => (
          <span key={t.href}>
            {i > 0 && <span className="land-today-sep" aria-hidden> · </span>}
            <Link href={t.href} className={t.count > 0 ? "land-today-item is-live" : "land-today-item"}>
              {t.label}
            </Link>
          </span>
        ))}
      </p>

      <p className="land-ask">What are you here to do?</p>
      <ul className="land-tiles">
        {tiles.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="land-tile">
              <span className="land-tile-title">{t.title}</span>
              <span className="land-tile-what">{t.what}</span>
              {t.figure && (
                <span className="land-tile-figure">
                  {t.figure}
                  {t.figureNote && <span className="land-tile-note"> · {t.figureNote}</span>}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {isAdmin && healthLight && (
        <p className="land-admin">
          <Link href="/admin/health" className="land-admin-item">
            <span className={`land-dot land-dot-${healthLight}`} aria-hidden />
            Data feeds {healthLight === "green" ? "healthy" : healthLight === "amber" ? "need a look" : healthLight === "red" ? "have a problem" : "not yet run"}
          </Link>
          <span className="land-today-sep" aria-hidden> · </span>
          <Link href="/triage" className="land-admin-item">{plural(n(enquiries), "batch", "batches")} in triage</Link>
          <span className="land-today-sep" aria-hidden> · </span>
          <Link href="/admin/valuation-rolls" className="land-admin-item">Valuation rolls</Link>
        </p>
      )}
    </section>
  );
}

function formatCount(c: number): string {
  return String(c).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" }).format(new Date(iso + "T00:00:00"));
}
