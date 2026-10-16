import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  /** The one live figure, big, in mono. */
  value: string;
  label: string;
  note?: string | null;
  noteTone?: "critical" | null;
};

const n = (r: { count: number | null }) => r.count ?? 0;

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
    liveAll, liveExclusive, inFlight, nearest, drafts, parties, erven,
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
  ]);

  const nearestRow = (nearest as { data: { name: string; transfer_date: string } | null }).data;
  let nearestNote: string | null = null;
  let nearestOverdue = false;
  if (nearestRow) {
    const days = Math.round((Date.parse(nearestRow.transfer_date + "T00:00:00") - todayStart.getTime()) / 86400_000);
    const short = nearestRow.name.replace(/,\s*Knysna\s*$/i, "");
    nearestOverdue = days < 0;
    nearestNote =
      days < 0 ? `${short} ${-days} d overdue`
      : days === 0 ? `${short} transfers today`
      : `next: ${short} · ${fmtDate(nearestRow.transfer_date)}`;
  }

  const tiles: Tile[] = [
    {
      href: "/map",
      title: "See what's on the market",
      what: "Every listing on the map — ours, Property24, the competition — over the erven.",
      value: String(n(liveAll)),
      label: n(liveAll) === 1 ? "live listing" : "live listings",
      note: n(liveExclusive) > 0 ? `${n(liveExclusive)} exclusive` : null,
    },
    {
      href: "/pipeline",
      title: "Work on a deal in progress",
      what: "Offers, conditions, conveyancing — where each sale stands and what's next.",
      value: String(n(inFlight)),
      label: "in conveyancing",
      note: nearestNote,
      noteTone: nearestOverdue ? "critical" : null,
    },
    {
      href: "/properties#new",
      title: "I have a new listing",
      what: "Start the property record from the erf, so the deeds, valuation and boundary come with it.",
      value: formatCount(n(erven)),
      label: "erven on file",
      note: "Knysna municipal roll",
    },
    {
      href: "/documents",
      title: "Prepare a document",
      what: "Mandates, agreements, addenda — from Bronwyn's templates, filled from the record.",
      value: String(n(drafts)),
      label: n(drafts) === 1 ? "document in progress" : "documents in progress",
    },
    {
      href: "/inbox",
      title: "Follow up on enquiries",
      what: "What came in by email and from the portals, and what's waiting for a reply.",
      value: String(n(enquiries)),
      label: n(enquiries) === 1 ? "item waiting" : "items waiting",
    },
    {
      href: "/contacts",
      title: "Find a person",
      what: "Sellers, buyers, conveyancers — who they are and every property they've touched.",
      value: formatCount(n(parties)),
      label: "people on record",
    },
  ];

  const today = [
    { href: "/viewings", count: n(viewingsToday), label: n(viewingsToday) === 1 ? "viewing today" : "viewings today" },
    { href: "/mandates", count: n(expiring), label: n(expiring) === 1 ? "mandate expiring ≤ 30 d" : "mandates expiring ≤ 30 d" },
    { href: "/inbox", count: n(enquiries), label: n(enquiries) === 1 ? "enquiry waiting" : "enquiries waiting" },
  ];

  return (
    <>
      <div className="land-band">
        <div className="land-band-inner">
          <header className="land-head">
            <h1 id="land-greeting" className="land-greeting">
              {greeting(now)}, {firstName}.
            </h1>
            <p className="land-date">
              {new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Johannesburg" }).format(now).toUpperCase()}
            </p>
          </header>
          <p className="land-today">
            {today.map((t) => (
              <Link key={t.href} href={t.href} className={t.count > 0 ? "land-today-item is-live" : "land-today-item"}>
                <span className="land-today-count">{t.count}</span>
                <span className="land-today-label">{t.label}</span>
              </Link>
            ))}
          </p>
        </div>
      </div>

      <section className="page land" aria-labelledby="land-greeting">
        <p className="land-ask">What are you here to do?</p>
        <ul className="land-tiles">
          {tiles.map((t) => (
            <li key={t.href}>
              <Link href={t.href} className="land-tile">
                <span className="land-tile-title">{t.title}</span>
                <span className="land-tile-what">{t.what}</span>
                <span className="land-tile-figure">
                  <span className="land-tile-value">{t.value}</span>
                  <span className="land-tile-label">
                    {t.label}
                    {t.note && <span className={t.noteTone === "critical" ? "land-tile-note is-critical" : "land-tile-note"}> · {t.note}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function formatCount(c: number): string {
  return String(c).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" }).format(new Date(iso + "T00:00:00"));
}
