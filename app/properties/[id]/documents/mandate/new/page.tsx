import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDreamAgency } from "@/lib/agency";
import { maritalRegimeLabel } from "@/app/documents/format";
import MandateEditor from "./MandateEditor";

// Prepare-Mandate render page. Loads property + seller + agency for the
// merge fields, then hands off to <MandateEditor> for the live preview and
// print/save controls. Deliberately NOT wrapped in <TopBar> — a printable
// document surface should read as its own thing, not part of the app chrome.

export const dynamic = "force-dynamic";

type Search = { type?: "sole" | "joint"; listing?: string };

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

  const type: "sole" | "joint" =
    searchParams.type === "joint" ? "joint" : "sole";

  const { data: prop } = await supabase
    .from("property")
    .select("id, primary_address, extent_sqm, title_deed_no")
    .eq("id", params.id)
    .maybeSingle();
  if (!prop) notFound();

  const { data: erfRow } = await supabase
    .from("erf")
    .select("erf_number")
    .eq("property_id", params.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Resolve the listing this mandate should attach to. Prefer the id passed
  // in the URL (self-documenting), fall back to the most-recent listing for
  // the property. Null is fine — the editor renders anyway and shows a
  // warning that save is blocked.
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

  // Seller: walk listing → transfer → transfer_party(side='seller') → party.
  // Falls back to null when no listing / no transfer / no seller_party.
  // The template renders blank underscored lines for the missing fields so
  // the printed doc is still hand-fillable.
  let seller: {
    displayName: string;
    idOrRegistration: string | null;
    maritalRegimeLabel: string | null;
    addressLine: string | null;
    phone: string | null;
    email: string | null;
  } | null = null;
  if (listingId) {
    const { data: listingRow } = await supabase
      .from("listing")
      .select("transfer_id")
      .eq("id", listingId)
      .maybeSingle();
    const transferId = (listingRow as { transfer_id: string | null } | null)?.transfer_id ?? null;
    if (transferId) {
      const { data: tpRow } = await supabase
        .from("transfer_party")
        .select(
          "party:party_id(display_name, party_type, id_number, passport_no, registration_no, matrimonial_regime, physical_address, postal_address, domicilium_address, phone, email)",
        )
        .eq("transfer_id", transferId)
        .eq("side", "seller")
        .eq("is_primary", true)
        .maybeSingle();
      const p = Array.isArray((tpRow as any)?.party)
        ? (tpRow as any).party[0]
        : (tpRow as any)?.party;
      if (p) {
        const idOrReg =
          p.party_type === "individual"
            ? p.id_number ?? (p.passport_no ? `Passport ${p.passport_no}` : null)
            : p.registration_no
              ? `Reg no. ${p.registration_no}`
              : null;
        seller = {
          displayName: p.display_name ?? "",
          idOrRegistration: idOrReg
            ? p.party_type === "individual" && p.id_number
              ? `ID ${idOrReg}`
              : idOrReg
            : null,
          maritalRegimeLabel:
            p.party_type === "individual" ? maritalRegimeLabel(p.matrimonial_regime) : null,
          addressLine:
            p.physical_address ?? p.domicilium_address ?? p.postal_address ?? null,
          phone: p.phone,
          email: p.email,
        };
      }
    }
  }

  // Joint-agency options (for the joint-mandate dropdown). Filter out Dream
  // itself — a mandate joint-with-yourself doesn't parse.
  const { data: agencies } = await supabase
    .from("agency")
    .select("id, name, is_dream")
    .order("name", { ascending: true });
  const jointAgencyOptions = ((agencies ?? []) as { id: string; name: string; is_dream: boolean }[])
    .filter((a) => !a.is_dream)
    .map(({ id, name }) => ({ id, name }));

  const agency = await getDreamAgency();

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
        listingId={listingId}
        agency={agency}
        seller={seller}
        property={{
          id: prop.id,
          primaryAddress: prop.primary_address,
          erfNumber: (erfRow as { erf_number: string } | null)?.erf_number ?? null,
          titleDeed: prop.title_deed_no,
          extentSqm: (prop as { extent_sqm: number | null }).extent_sqm,
        }}
        jointAgencyOptions={jointAgencyOptions}
      />
    </main>
  );
}
