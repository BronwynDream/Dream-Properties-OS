import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDreamAgency } from "@/lib/agency";
import { loadTemplate } from "@/lib/documents/resolve";
import type { MandateRecordInputs } from "@/lib/documents/context";
import MandateEditor from "./MandateEditor";

// Prepare-Mandate page (plan 019 Arc A2). Loads the mandate template from
// the clause library, gathers what the record already knows (sellers, erf,
// address, extent, joint agency), and hands both to <MandateEditor>, which
// interviews the agent for the rest and renders the document live.
//
// Deliberately NOT wrapped in <TopBar> — a printable document surface
// should read as its own thing, not part of the app chrome.

export const dynamic = "force-dynamic";

type MandateType = "exclusive" | "joint" | "open";
// "sole" is accepted on the URL as a legacy alias for "exclusive" (they are
// the same mandate at Dream — see migration 0067) but is never written.
type Search = { type?: MandateType | "sole"; listing?: string };

const TEMPLATE_BY_TYPE: Record<MandateType, string> = {
  exclusive: "mandate_exclusive",
  joint: "mandate_joint",
  open: "mandate_open",
};

export default async function PrepareMandatePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Search;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const type: MandateType =
    searchParams.type === "joint" ? "joint" : searchParams.type === "open" ? "open" : "exclusive";

  const { data: prop } = await supabase
    .from("property")
    .select("id, primary_address, extent_sqm, title_deed_no")
    .eq("id", params.id)
    .maybeSingle();
  if (!prop) notFound();

  const model = await loadTemplate(supabase, TEMPLATE_BY_TYPE[type]);
  if (!model || model.slots.length === 0) {
    return (
      <main style={{ padding: 40 }}>
        <p>
          Template <code>{TEMPLATE_BY_TYPE[type]}</code> has no clauses in the library. Apply
          migrations 0068 and 0071 to the database.
        </p>
      </main>
    );
  }

  const { data: erfRow } = await supabase
    .from("erf")
    .select("erf_number")
    .eq("property_id", params.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Resolve the listing this mandate should attach to. Prefer the id passed
  // in the URL, fall back to the most-recent listing for the property. Null
  // is fine — the editor renders anyway and shows a warning that save is
  // blocked.
  let listingId: string | null = searchParams.listing ?? null;
  if (!listingId) {
    const { data: latest } = await supabase
      .from("listing")
      .select("id")
      .eq("property_id", params.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    listingId = latest?.id ?? null;
  }

  // Sellers: listing → transfer → transfer_party(side='seller') → party.
  // All sellers, primary first, so "John and Jane Smith" comes out right.
  let sellerNames: string | null = null;
  let sellerIdLine: string | null = null;
  let sellerIsJuristic = false;
  if (listingId) {
    const { data: listingRow } = await supabase
      .from("listing")
      .select("transfer_id")
      .eq("id", listingId)
      .maybeSingle();
    const transferId = (listingRow as { transfer_id: string | null } | null)?.transfer_id ?? null;
    if (transferId) {
      const { data: tpRows } = await supabase
        .from("transfer_party")
        .select("is_primary, party:party_id(display_name, party_type, id_number, passport_no, registration_no)")
        .eq("transfer_id", transferId)
        .eq("side", "seller")
        .order("is_primary", { ascending: false });
      type P = { display_name: string; party_type: string; id_number: string | null; passport_no: string | null; registration_no: string | null };
      const parties = ((tpRows ?? []) as unknown as { party: P | P[] }[])
        .map((r) => (Array.isArray(r.party) ? r.party[0] : r.party))
        .filter(Boolean) as P[];
      if (parties.length) {
        sellerNames = joinNames(parties.map((p) => p.display_name));
        const primary = parties[0];
        sellerIsJuristic = primary.party_type !== "individual";
        sellerIdLine = sellerIsJuristic
          ? primary.registration_no ? `(Reg. No. ${primary.registration_no})` : null
          : parties.length === 1
          ? primary.id_number ? `I.D. ${primary.id_number}` : primary.passport_no ? `Passport ${primary.passport_no}` : null
          : parties.every((p) => p.id_number)
          ? `I.D. ${parties.map((p) => p.id_number).join(" / ")}`
          : null;
      }
    }
  }

  // Joint-agency options. Filter out Dream itself.
  const { data: agencies } = await supabase
    .from("agency")
    .select("id, name, is_dream")
    .order("name", { ascending: true });
  const jointAgencyOptions = ((agencies ?? []) as { id: string; name: string; is_dream: boolean }[])
    .filter((a) => !a.is_dream)
    .map(({ id, name }) => ({ id, name }));

  const agency = await getDreamAgency();

  const record: MandateRecordInputs = {
    mandateType: type,
    sellerNames,
    sellerIdLine,
    sellerRepresentative: null,
    erfNumber: (erfRow as { erf_number: string } | null)?.erf_number ?? null,
    propertyKnownAs: knownAs(prop.primary_address),
    extentSqm: (prop as { extent_sqm: number | null }).extent_sqm,
    jointAgencyName: null,
  };

  return (
    <main style={{ background: "#F5F1E8", minHeight: "100vh", padding: "20px 20px 60px" }}>
      <div className="no-print" style={{ maxWidth: 780, margin: "0 auto 12px" }}>
        <Link
          href={`/properties/${params.id}`}
          style={{ fontSize: 12, color: "var(--paper-mute)", textDecoration: "none" }}
        >
          ← Back to property record
        </Link>
      </div>
      <MandateEditor
        type={type}
        model={model}
        record={record}
        sellerIsJuristic={sellerIsJuristic}
        listingId={listingId}
        propertyId={prop.id}
        propertyAddress={prop.primary_address}
        agency={agency}
        jointAgencyOptions={jointAgencyOptions}
      />
    </main>
  );
}

function joinNames(names: string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** "12 Eagles Way, The Heads, Knysna" → "12 Eagles Way, The Heads" — the
 *  master already prints ", KNYSNA" after the known-as blank. */
function knownAs(address: string | null): string | null {
  if (!address) return null;
  return address.replace(/,?\s*knysna\s*(,.*)?$/i, "").trim() || address;
}
