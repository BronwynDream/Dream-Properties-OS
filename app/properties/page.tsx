import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import NewPropertyForm from "./NewPropertyForm";

export const dynamic = "force-dynamic";

// Properties (2026-10-17): every website listing is now a property record
// with its agents (lib/dream/sync.ts). Three views:
//   mine     — listings this user is an agent on. An agent's default.
//   listings — every property with a current listing. The office default.
//   all      — the whole property database, listings or not.

type AgentLink = { position: number; agent: { full_name: string; app_user_id: string | null } | null };
type ListingRow = {
  id: string;
  status: string;
  asking_price: number | null;
  created_at: string;
  website_slug: string | null;
  listing_agent?: AgentLink[];
};
type PropRow = {
  id: string;
  primary_address: string;
  title_deed_no: string | null;
  extent_sqm: number | null;
  address_to_confirm?: boolean;
  suburb: { name: string } | null;
  listing?: ListingRow[];
};

type View = "mine" | "listings" | "all";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  live: "For sale",
  under_offer: "Under offer",
  sold: "Sold",
  withdrawn: "Withdrawn",
  expired: "Expired",
};
const OPEN = new Set(["draft", "live", "under_offer"]);

const groupDigits = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export default async function PropertiesList({ searchParams }: { searchParams: { view?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Listings + agents arrive with migration 0085; until it has run, fall
  // back to the plain list so the page never breaks on deploy order.
  const FULL =
    "id, primary_address, title_deed_no, extent_sqm, address_to_confirm, suburb:suburb_id(name), listing(id, status, asking_price, created_at, website_slug, listing_agent(position, agent:agent_id(full_name, app_user_id)))";
  const BASE = "id, primary_address, title_deed_no, extent_sqm, suburb:suburb_id(name)";

  const [full, suburbsRes, meRes] = await Promise.all([
    supabase.from("property").select(FULL).order("primary_address"),
    supabase.from("suburb").select("id, name").order("name"),
    supabase.from("agent").select("id").eq("app_user_id", user.id).maybeSingle(),
  ]);
  let props = (full.data ?? []) as unknown as PropRow[];
  const hasListings = !full.error;
  if (full.error) {
    const base = await supabase.from("property").select(BASE).order("primary_address");
    props = (base.data ?? []) as unknown as PropRow[];
  }
  const suburbs = (suburbsRes.data ?? []) as { id: string; name: string }[];
  const isAgent = !meRes.error && !!meRes.data;

  // The listing that describes the property now: the newest open one, else the newest.
  const current = (p: PropRow): ListingRow | null => {
    const ls = [...(p.listing ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return ls.find((l) => OPEN.has(l.status)) ?? ls[0] ?? null;
  };
  const agentsOf = (l: ListingRow | null) =>
    [...(l?.listing_agent ?? [])].sort((a, b) => a.position - b.position).map((x) => x.agent).filter(Boolean) as {
      full_name: string;
      app_user_id: string | null;
    }[];
  const isMine = (p: PropRow) => (p.listing ?? []).some((l) => agentsOf(l).some((a) => a.app_user_id === user.id));

  const mine = props.filter(isMine);
  const withListing = props.filter((p) => {
    const l = current(p);
    return l != null && OPEN.has(l.status);
  });

  const requested = searchParams.view as View | undefined;
  const view: View = !hasListings
    ? "all"
    : requested === "mine" || requested === "listings" || requested === "all"
      ? requested
      : isAgent && mine.length > 0
        ? "mine"
        : "listings";
  const shown = view === "mine" ? mine : view === "listings" ? withListing : props;
  const toConfirm = shown.filter((p) => p.address_to_confirm).length;

  const tab = (v: View, label: string, n: number) => (
    <Link
      href={`/properties?view=${v}`}
      className={`prop-tab${view === v ? " on" : ""}`}
      aria-current={view === v ? "page" : undefined}
    >
      {label} <span className="prop-tab-n">{n}</span>
    </Link>
  );

  return (
    <>
      <TopBar />
      <main>
        <header
          className="app-head"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <div>
            <p className="eyebrow">Dream Knysna · Properties</p>
            <h1>{view === "mine" ? "My listings" : view === "listings" ? "Current listings" : "Property database"}</h1>
          </div>
        </header>
        <hr className="tideline" />

        <section className="app-body" style={{ maxWidth: 1100 }}>
          <div id="new" style={{ marginBottom: 20, scrollMarginTop: 80 }}>
            <NewPropertyForm
              suburbs={suburbs}
              lightstoneConnected={!!(process.env.LIGHTSTONE_API_BASE && process.env.LIGHTSTONE_API_KEY)}
            />
          </div>

          {hasListings && (
            <nav className="prop-tabs" aria-label="Which properties">
              {(isAgent || mine.length > 0) && tab("mine", "My listings", mine.length)}
              {tab("listings", "Current listings", withListing.length)}
              {tab("all", "All properties", props.length)}
            </nav>
          )}

          {view === "mine" && toConfirm > 0 && (
            <p className="prop-hint">
              {toConfirm === 1 ? "One of your listings needs" : `${toConfirm} of your listings need`} a street address. The
              website didn&rsquo;t publish one, so the record is named after the listing for now. Open it and use{" "}
              <b>Edit details</b>.
            </p>
          )}

          {shown.length === 0 ? (
            <p style={{ color: "#5b6885", marginTop: 24 }}>
              {view === "mine"
                ? "No listings are assigned to you yet."
                : "No properties yet. Click + New property above to take one on."}
            </p>
          ) : (
            <table className="queue">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Suburb</th>
                  {hasListings && <th>Status</th>}
                  {hasListings && <th style={{ textAlign: "right" }}>Price</th>}
                  {hasListings && <th>Agents</th>}
                  {!hasListings && <th>Erf / Title deed</th>}
                  <th>Extent</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const l = current(p);
                  const agents = agentsOf(l);
                  return (
                    <tr key={p.id}>
                      <td className="strong" data-label="Address">
                        <Link href={`/properties/${p.id}`} className="row-link">
                          {p.primary_address}
                        </Link>
                        {p.address_to_confirm && <span className="prop-confirm">Address to confirm</span>}
                      </td>
                      <td data-label="Suburb">{p.suburb?.name ?? "—"}</td>
                      {hasListings && (
                        <td data-label="Status">
                          {l ? (
                            <span className={`prop-status s-${l.status}`}>{STATUS_LABEL[l.status] ?? l.status}</span>
                          ) : (
                            <span className="prop-status s-none">No listing</span>
                          )}
                        </td>
                      )}
                      {hasListings && (
                        <td className="mono" data-label="Price" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {l?.asking_price ? `R ${groupDigits(Number(l.asking_price))}` : l ? "POA" : "—"}
                        </td>
                      )}
                      {hasListings && (
                        <td data-label="Agents">
                          {agents.length
                            ? agents.map((a, i) => (
                                <span key={a.full_name} className={`prop-agent${a.app_user_id === user.id ? " me" : ""}`}>
                                  {a.full_name}
                                  {i === 0 && agents.length > 1 ? <span className="prop-lead"> · lead</span> : null}
                                </span>
                              ))
                            : "—"}
                        </td>
                      )}
                      {!hasListings && (
                        <td className="mono" style={{ fontSize: 12 }} data-label="Erf / Deed">
                          {p.title_deed_no ?? "—"}
                        </td>
                      )}
                      <td data-label="Extent">{p.extent_sqm ? `${groupDigits(Number(p.extent_sqm))} m²` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
