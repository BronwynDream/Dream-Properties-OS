// Context for documents prepared from a DEAL (transfer): movables agreement,
// addenda, condition-report appendix, and later the sale agreements.
//
// Same fill-source rule as mandates: the record supplies what it can, the
// draft editor asks for the rest, nothing is defaulted. Migration 0074 put
// {{tokens}} into the short templates seeded in 0069, so what is built here
// lands on the page; signature blocks keep their blanks for signing day.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocContext } from "./resolve";
import { formatZar, numberToWords } from "./resolve";
import { ppraContext } from "./ppra";
import { ppraFormTypeFor } from "@/lib/ppraDisclosure";

type Party = {
  display_name: string;
  party_type: string;
  id_number: string | null;
  passport_no: string | null;
  registration_no: string | null;
  postal_address: string | null;
  domicilium_address: string | null;
  physical_address: string | null;
  matrimonial_regime: string | null;
  email: string | null;
  phone: string | null;
};

const PARTY_COLS =
  "display_name, party_type, id_number, passport_no, registration_no, postal_address, domicilium_address, physical_address, matrimonial_regime, email, phone";

const MARITAL: Record<string, string> = {
  single: "Unmarried",
  married_in_community: "Married in community of property",
  married_anc_no_accrual: "Married out of community of property, without accrual",
  married_anc_with_accrual: "Married out of community of property, with accrual",
  foreign_marriage: "Married under foreign law",
  divorced: "Divorced",
  widowed: "Widowed",
};

export async function buildDealContext(
  supabase: SupabaseClient,
  propertyId: string,
  transferId: string | null,
): Promise<{ ctx: DocContext; label: string }> {
  const { data: prop } = await supabase
    .from("property")
    .select("primary_address, extent_sqm, title_deed_no, property_type:property_type_id(label), suburb:suburb_id(name), estate:estate_id(name)")
    .eq("id", propertyId)
    .maybeSingle();
  const propertyTypeLabel = ((Array.isArray(prop?.property_type) ? prop?.property_type[0] : prop?.property_type) as { label: string } | null | undefined)?.label ?? null;
  const { data: erf } = await supabase
    .from("erf")
    .select("erf_number, scheme_name, portion")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const ctx: DocContext = {
    erf_number: erf?.erf_number ?? null,
    property_known_as: knownAs(prop?.primary_address ?? null),
    property_address: prop?.primary_address ?? null,
    extent_sqm: prop?.extent_sqm != null ? formatZar(Number(prop.extent_sqm)) : null,
    title_deed_no: prop?.title_deed_no ?? null,
    // Sectional title: the scheme lives on the erf row.
    scheme_name: erf?.scheme_name ?? null,
    suburb: (one(prop?.suburb as { name: string } | { name: string }[] | null))?.name ?? null,
    estate_name: (one(prop?.estate as { name: string } | { name: string }[] | null))?.name ?? null,
    property_description:
      erf?.erf_number ? `Erf ${erf.erf_number} Knysna, Western Cape${prop?.primary_address ? `, known as ${knownAs(prop.primary_address)}, Knysna` : ""}` : null,
  };

  if (transferId) {
    const [{ data: tp }, { data: agreement }, { data: transfer }] = await Promise.all([
      supabase
        .from("transfer_party")
        .select(`side, is_primary, party:party_id(${PARTY_COLS})`)
        .eq("transfer_id", transferId)
        .order("is_primary", { ascending: false }),
      supabase
        .from("agreement")
        .select("price, deposit, signature_date, transfer_date")
        .eq("transfer_id", transferId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("transfer")
        .select("name, transfer_date, lead:lead_agent_user_id(full_name), firm:conveyancer_firm_id(name, phone, email)")
        .eq("id", transferId)
        .maybeSingle(),
    ]);
    const rows = ((tp ?? []) as unknown as { side: string; party: Party | Party[] }[]).map((r) => ({
      side: r.side,
      party: Array.isArray(r.party) ? r.party[0] : r.party,
    }));
    const sellers = rows.filter((r) => r.side === "seller" && r.party).map((r) => r.party);
    const purchasers = rows.filter((r) => r.side === "purchaser" && r.party).map((r) => r.party);
    ctx.seller_names = joinNames(sellers.map((p) => p.display_name)) || null;
    ctx.purchaser_names = joinNames(purchasers.map((p) => p.display_name)) || null;
    ctx.seller_id_line = idLine(sellers);
    ctx.purchaser_id_line = idLine(purchasers);
    ctx.transfer_name = transfer?.name ?? null;
    if (agreement?.price != null) {
      ctx.purchase_price = formatZar(Number(agreement.price));
      ctx.purchase_price_words = numberToWords(Number(agreement.price));
    }
    ctx.agreement_date = longDate(agreement?.signature_date ?? null);
    if (agreement?.deposit != null) ctx.deposit = formatZar(Number(agreement.deposit));
    ctx.transfer_date = longDate(agreement?.transfer_date ?? (transfer as { transfer_date?: string | null } | null)?.transfer_date ?? null);

    // Contract information page of the agreement of sale: one block per side.
    Object.assign(ctx, partyBlock("seller", sellers), partyBlock("purchaser", purchasers));

    const t = transfer as unknown as {
      lead: { full_name: string | null } | { full_name: string | null }[] | null;
      firm: { name: string; phone: string | null; email: string | null } | { name: string; phone: string | null; email: string | null }[] | null;
    } | null;
    ctx.agent_name = one(t?.lead ?? null)?.full_name ?? null;
    const firm = one(t?.firm ?? null);
    ctx.conveyancer_name = firm?.name ?? null;
    ctx.conveyancer_contact = firm ? [firm.phone, firm.email].filter(Boolean).join(" · ") || null : null;
    // PPRA Section 67 answers, when the deal has a disclosure on record.
    Object.assign(ctx, await ppraContext(supabase, transferId, ppraFormTypeFor(propertyTypeLabel)));
  }

  // Commission % from the most recent mandate on this property's listing.
  const { data: mandateRow } = await supabase
    .from("mandate")
    .select("commission_pct, created_at, listing:listing_id!inner(property_id)")
    .eq("listing.property_id", propertyId)
    .not("commission_pct", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (mandateRow?.commission_pct != null) ctx.commission_pct = Number(mandateRow.commission_pct);
  ctx.principal_name = "Bronwyn Eyre";

  const label = ctx.transfer_name ? String(ctx.transfer_name) : prop?.primary_address ?? "Document";
  return { ctx, label };
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

/** The CONTRACT INFORMATION rows for one side of the agreement. Several
 *  parties on a side are joined; a value the record doesn't hold stays
 *  empty so the editor asks for it. */
function partyBlock(side: "seller" | "purchaser", parties: Party[]): DocContext {
  const out: DocContext = {};
  if (parties.length === 0) return out;
  const join = (xs: (string | null)[]) => {
    const v = xs.filter((x): x is string => !!x && x.trim() !== "");
    return v.length ? Array.from(new Set(v)).join("; ") : null;
  };
  out[`${side}_ids`] = join(parties.map((p) => p.id_number ?? p.passport_no ?? p.registration_no));
  out[`${side}_postal`] = join(parties.map((p) => p.postal_address ?? p.physical_address));
  out[`${side}_domicilium`] = join(parties.map((p) => p.domicilium_address ?? p.physical_address));
  out[`${side}_email`] = join(parties.map((p) => p.email));
  out[`${side}_phone`] = join(parties.map((p) => p.phone));
  const marital = join(parties.filter((p) => p.party_type === "individual").map((p) => (p.matrimonial_regime ? MARITAL[p.matrimonial_regime] ?? null : null)));
  if (marital) out[`${side}_marital`] = marital;
  // Only juristic persons sign through a representative; for people the
  // line reads N/A, which is what the agent would write by hand.
  if (parties.every((p) => p.party_type === "individual")) {
    out[`${side}_represented_by`] = "N/A";
    if (parties.every((p) => p.matrimonial_regime === "single" || p.matrimonial_regime === "divorced" || p.matrimonial_regime === "widowed")) {
      out[`${side}_marriage`] = "N/A";
    }
  }
  return out;
}

function idLine(parties: Party[]): string | null {
  if (parties.length === 0) return null;
  const p = parties[0];
  if (p.party_type !== "individual") return p.registration_no ? `(Reg. No. ${p.registration_no})` : null;
  if (parties.length === 1) return p.id_number ? `I.D. ${p.id_number}` : null;
  return parties.every((x) => x.id_number) ? `I.D. ${parties.map((x) => x.id_number).join(" / ")}` : null;
}

export function joinNames(names: string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** "2026-03-14" → "14 March 2026", as a contract writes a date. */
export function longDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" });
}

/** "12 Eagles Way, The Heads, Knysna" → "12 Eagles Way, The Heads". */
export function knownAs(address: string | null): string | null {
  if (!address) return null;
  return address.replace(/,?\s*knysna\s*(,.*)?$/i, "").trim() || address;
}

/** Tokens the draft editor shows as inputs, with labels. `*_words` tokens
 *  are derived from their numeric sibling and never asked for directly. */
export const DEAL_TOKEN_LABELS: Record<string, string> = {
  seller_names: "Seller name(s)",
  seller_id_line: "Seller ID / registration number",
  purchaser_names: "Purchaser name(s)",
  purchaser_id_line: "Purchaser ID / registration number",
  erf_number: "Erf number",
  property_known_as: "Street address",
  extent_sqm: "Extent (m²)",
  purchase_price: "Purchase price (ZAR)",
  agreement_date: "Agreement date",
  movables_price: "Price for the movables (ZAR)",
  movables_agreement_date: "Date of the movables agreement",
  seller_represented_by: "Seller — duly represented by",
  seller_ids: "Seller — ID / passport / registration no.",
  seller_postal: "Seller — postal address",
  seller_domicilium: "Seller — domicilium citandi",
  seller_marital: "Seller — marital status",
  seller_marriage: "Seller — date and place of marriage",
  seller_email: "Seller — email",
  seller_phone: "Seller — contact numbers",
  purchaser_represented_by: "Purchaser — duly represented by",
  purchaser_ids: "Purchaser — ID / passport / registration no.",
  purchaser_postal: "Purchaser — postal address",
  purchaser_domicilium: "Purchaser — domicilium citandi",
  purchaser_marital: "Purchaser — marital status",
  purchaser_marriage: "Purchaser — date and place of marriage",
  purchaser_email: "Purchaser — email",
  purchaser_phone: "Purchaser — contact numbers",
  title_deed_no: "Title deed / sectional title certificate number",
  deposit: "Deposit (ZAR)",
  bond_amount: "Bond amount (ZAR) — leave empty for a cash sale",
  guarantee_date: "Balance guaranteed on or before",
  transfer_date: "Transfer date",
  occupation_date: "Occupation date (e.g. date of registration of transfer)",
  occupational_rent: "Occupational rent per month (ZAR)",
  conveyancer_name: "Conveyancer",
  conveyancer_contact: "Conveyancer — tel and email",
  agent_name: "Agent / property practitioner",
  commission_pct: "Commission % (plus VAT)",
  offer_expires: "Offer open until 12h00 on",
  estate_name: "Estate name",
  purchaser_property: "Purchaser's property to be sold",
  purchaser_property_by: "…sold and transferred by",
  viewing_by: "Purchaser to view the property by",
  principal_name: "Accepting commission for Dream",
  section_no: "Section number",
  scheme_name: "Scheme name",
  door_no: "Door number",
  building_name: "Building known as",
  section_plan_no: "Sectional plan number (the part after SS)",
  parking_bay: "Exclusive-use parking bay",
  deposit_by: "Deposit payable on or before",
  amendments: "The amendments (numbered, one per paragraph)",
  agent_disclosures: "Disclosures the agent made (if any)",
};
