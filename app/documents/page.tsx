import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import DocumentStart, { type StartProperty } from "./DocumentStart";

// Documents — the start page (2026-10-19).
//
// Simon: "If you're coming in fresh, just straight from the menu, from
// Documents, it should give you four or five blocks as to which document you
// would like to work on, or which one you would like to generate. It
// shouldn't have a history of what documents you've done before."
//
// So this page asks two things: what are you making (five families of
// Bronwyn's templates), and which property is it for. The record then fills
// what it knows. The history moved to /documents/prepared, one link away.

export const dynamic = "force-dynamic";

type PropRow = {
  id: string;
  primary_address: string;
  lat: number | null;
  lng: number | null;
  prcl_key: string | null;
  suburb: { name: string } | { name: string }[] | null;
  listing:
    | {
        id: string;
        created_at: string;
        listing_agent: { agent: { app_user_id: string | null } | { app_user_id: string | null }[] | null }[] | null;
      }[]
    | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (v == null ? null : Array.isArray(v) ? v[0] ?? null : v);

export default async function DocumentsStart() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [propsRes, transfersRes] = await Promise.all([
    supabase
      .from("property")
      .select("id, primary_address, lat, lng, prcl_key, suburb:suburb_id(name), listing(id, created_at, listing_agent(agent:agent_id(app_user_id)))")
      .order("primary_address"),
    supabase.from("transfer").select("id, property_id, created_at").order("created_at", { ascending: false }),
  ]);

  // The property record treats its newest transfer as the deal documents
  // are prepared against; do the same here.
  const dealOf = new Map<string, string>();
  for (const t of (transfersRes.data ?? []) as { id: string; property_id: string }[]) {
    if (!dealOf.has(t.property_id)) dealOf.set(t.property_id, t.id);
  }

  const properties: StartProperty[] = ((propsRes.data ?? []) as unknown as PropRow[]).map((p) => {
    const listings = [...(p.listing ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const mine = listings.some((l) => (l.listing_agent ?? []).some((la) => one(la.agent)?.app_user_id === user.id));
    return {
      id: p.id,
      address: p.primary_address,
      suburb: one(p.suburb)?.name ?? null,
      lat: p.lat != null ? Number(p.lat) : null,
      lng: p.lng != null ? Number(p.lng) : null,
      prclKey: p.prcl_key ?? null,
      listingId: listings[0]?.id ?? null,
      transferId: dealOf.get(p.id) ?? null,
      mine,
    };
  });

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Documents</p>
          <h1>Prepare a document</h1>
          <p className="app-sub">
            Choose what you&apos;re making, then the property it&apos;s for. Dream OS fills in what the
            record already knows, and you finish the rest in the editor.
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <DocumentStart properties={properties} mapboxToken={(process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim()} />
          <p className="docstart-foot">
            Looking for something already made? <Link href="/documents/prepared">Prepared documents</Link>
          </p>
        </section>
      </main>
    </>
  );
}
