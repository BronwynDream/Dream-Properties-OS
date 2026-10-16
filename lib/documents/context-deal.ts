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

type Party = { display_name: string; party_type: string; id_number: string | null; registration_no: string | null };

export async function buildDealContext(
  supabase: SupabaseClient,
  propertyId: string,
  transferId: string | null,
): Promise<{ ctx: DocContext; label: string }> {
  const { data: prop } = await supabase
    .from("property")
    .select("primary_address, extent_sqm, property_type:property_type_id(label)")
    .eq("id", propertyId)
    .maybeSingle();
  const propertyTypeLabel = ((Array.isArray(prop?.property_type) ? prop?.property_type[0] : prop?.property_type) as { label: string } | null | undefined)?.label ?? null;
  const { data: erf } = await supabase
    .from("erf")
    .select("erf_number")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const ctx: DocContext = {
    erf_number: erf?.erf_number ?? null,
    property_known_as: knownAs(prop?.primary_address ?? null),
    property_address: prop?.primary_address ?? null,
    extent_sqm: prop?.extent_sqm != null ? formatZar(Number(prop.extent_sqm)) : null,
    property_description:
      erf?.erf_number ? `Erf ${erf.erf_number} Knysna, Western Cape${prop?.primary_address ? `, known as ${knownAs(prop.primary_address)}, Knysna` : ""}` : null,
  };

  if (transferId) {
    const [{ data: tp }, { data: agreement }, { data: transfer }] = await Promise.all([
      supabase
        .from("transfer_party")
        .select("side, is_primary, party:party_id(display_name, party_type, id_number, registration_no)")
        .eq("transfer_id", transferId)
        .order("is_primary", { ascending: false }),
      supabase
        .from("agreement")
        .select("price, signature_date")
        .eq("transfer_id", transferId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("transfer").select("name").eq("id", transferId).maybeSingle(),
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
    // PPRA Section 67 answers, when the deal has a disclosure on record.
    Object.assign(ctx, await ppraContext(supabase, transferId, ppraFormTypeFor(propertyTypeLabel)));
  }

  const label = ctx.transfer_name ? String(ctx.transfer_name) : prop?.primary_address ?? "Document";
  return { ctx, label };
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
  amendments: "The amendments (numbered, one per paragraph)",
  agent_disclosures: "Disclosures the agent made (if any)",
};
