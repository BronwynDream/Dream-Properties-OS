"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Shape of the optional seller block passed from NewPropertyForm.tsx.
// If present, creates a party + a preparing transfer + a draft listing under
// that transfer + a transfer_party(side='seller') linking them all. Kept
// permissive on the client (blank fields = null on the row) so an agent
// can capture whatever the seller has volunteered so far.
export type SellerInput = {
  party_type: "individual" | "trust" | "company" | "close_corporation";
  full_name?: string | null;
  id_number?: string | null;
  passport_no?: string | null;
  matrimonial_regime?:
    | "single"
    | "married_in_community"
    | "married_anc_no_accrual"
    | "married_anc_with_accrual"
    | "foreign_marriage"
    | "divorced"
    | "widowed"
    | "unknown"
    | null;
  entity_name?: string | null;
  registration_no?: string | null;
  email?: string | null;
  phone?: string | null;
};

// Create a new property from the take-on flow. Address is required; everything
// else is optional. Returns the new property id so the caller can redirect
// straight to /properties/[id] and start dragging documents onto it.
//
// Lightstone integration: if the agent picked a candidate from Property Search,
// we get lightstone_property_id + normalised address parts (lat/lng, suburb
// name). We coalesce those onto the row so the very first Fetch-from-Lightstone
// call on this property skips the address re-resolve.
//
// Seller integration: if the agent captured seller details in-line, the
// action also creates a preparing transfer + draft listing + transfer_party
// so mandates and OTPs generated later can pre-fill from party+property.
export async function createProperty(input: {
  primary_address: string;
  suburb_id?: string | null;
  erf_number?: string | null;
  title_deed_no?: string | null;
  lightstone_property_id?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  suburb_name?: string | null;
  seller?: SellerInput | null;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "unauthorised" };

  const address = (input.primary_address ?? "").trim();
  if (address.length < 3) {
    return { ok: false as const, error: "Address is required (at least 3 characters)." };
  }

  // If the caller passed a suburb name (from Lightstone) but no explicit id,
  // try to resolve it against the seeded suburb list. Never invents rows.
  let suburbId: string | null = input.suburb_id ?? null;
  const suburbName = (input.suburb_name ?? "").trim();
  if (!suburbId && suburbName) {
    const { data: match } = await supabase
      .from("suburb")
      .select("id")
      .ilike("name", suburbName)
      .maybeSingle();
    if (match?.id) suburbId = match.id;
  }

  const insertRow: Record<string, unknown> = {
    primary_address: address,
    suburb_id: suburbId,
    title_deed_no: (input.title_deed_no ?? "").trim() || null,
  };
  if (input.lightstone_property_id != null) {
    insertRow.lightstone_property_id = input.lightstone_property_id;
  }
  if (input.latitude != null) insertRow.lat = input.latitude;
  if (input.longitude != null) insertRow.lng = input.longitude;

  const { data: newProp, error } = await supabase
    .from("property")
    .insert(insertRow)
    .select("id")
    .single();

  if (error || !newProp) {
    return {
      ok: false as const,
      error: error?.message ?? "Could not create property.",
    };
  }

  const erf = (input.erf_number ?? "").trim();
  if (erf) {
    await supabase.from("erf").insert({
      property_id: newProp.id,
      erf_number: erf,
    });
  }

  // Seller capture — optional. Creates party + preparing transfer + draft
  // listing + transfer_party. Errors here don't roll back the property (agent
  // can re-attempt seller capture from the property record) but are surfaced
  // to the caller so the UI can show a warning.
  let sellerWarning: string | null = null;
  if (input.seller) {
    const sellerRes = await attachSellerToNewProperty(
      supabase,
      newProp.id,
      address,
      input.seller,
    );
    if (!sellerRes.ok) sellerWarning = sellerRes.error;
  }

  revalidatePath("/properties");
  revalidatePath("/contacts");
  return { ok: true as const, id: newProp.id, sellerWarning };
}

// Internal: build the seller-party row, create the preparing-transfer +
// draft-listing skeleton, and link party↔transfer via transfer_party. Extracted
// so we can call it from both the property-first flow (createProperty) and the
// seller-first flow (/contacts/new) in a follow-up ship.
async function attachSellerToNewProperty(
  supabase: ReturnType<typeof createClient>,
  propertyId: string,
  primaryAddress: string,
  seller: SellerInput,
): Promise<{ ok: true; partyId: string; transferId: string; listingId: string } | { ok: false; error: string }> {
  const partyRow = buildPartyRow(seller);
  if (!partyRow) {
    return { ok: false, error: "Seller name is required." };
  }

  const { data: newParty, error: partyErr } = await supabase
    .from("party")
    .insert(partyRow)
    .select("id, display_name")
    .single();
  if (partyErr || !newParty) {
    return { ok: false, error: partyErr?.message ?? "Could not create seller." };
  }

  const { data: newTransfer, error: transferErr } = await supabase
    .from("transfer")
    .insert({
      property_id: propertyId,
      name: `${primaryAddress} — ${newParty.display_name} (preparing)`,
      status: "preparing",
    })
    .select("id")
    .single();
  if (transferErr || !newTransfer) {
    return { ok: false, error: transferErr?.message ?? "Could not open preparing transfer." };
  }

  const { data: newListing, error: listingErr } = await supabase
    .from("listing")
    .insert({
      property_id: propertyId,
      transfer_id: newTransfer.id,
      status: "draft",
    })
    .select("id")
    .single();
  if (listingErr || !newListing) {
    return { ok: false, error: listingErr?.message ?? "Could not create draft listing." };
  }

  const { error: tpErr } = await supabase.from("transfer_party").insert({
    transfer_id: newTransfer.id,
    party_id: newParty.id,
    side: "seller",
    is_primary: true,
  });
  if (tpErr) {
    return { ok: false, error: tpErr.message };
  }

  return { ok: true, partyId: newParty.id, transferId: newTransfer.id, listingId: newListing.id };
}

function buildPartyRow(s: SellerInput): Record<string, unknown> | null {
  const email = s.email?.trim() || null;
  const phone = s.phone?.trim() || null;

  if (s.party_type === "individual") {
    const fullName = (s.full_name ?? "").trim();
    if (!fullName) return null;
    // Naive split: last word = surname, everything before = first_names. SA
    // compound surnames (van der Merwe, etc) get miscategorised; agent can
    // edit on the Seller Record page. Good enough for pre-fill on a mandate.
    const parts = fullName.split(/\s+/);
    const surname = parts.length > 1 ? parts.slice(-1).join(" ") : null;
    const firstNames = parts.length > 1 ? parts.slice(0, -1).join(" ") : fullName;
    return {
      party_type: "individual",
      display_name: fullName,
      first_names: firstNames,
      surname,
      id_number: s.id_number?.trim() || null,
      passport_no: s.passport_no?.trim() || null,
      matrimonial_regime: s.matrimonial_regime ?? "unknown",
      email,
      phone,
    };
  }

  const entityName = (s.entity_name ?? "").trim();
  if (!entityName) return null;
  return {
    party_type: s.party_type,
    display_name: entityName,
    entity_name: entityName,
    registration_no: s.registration_no?.trim() || null,
    email,
    phone,
  };
}

// Fold `loserId` into `winnerId`. Both must belong to the same property (the
// RPC enforces this defensively). Destructive: the loser transfer row is
// deleted. All parties, agreements, milestones, documents move to the winner.
// Audit trail written to audit_log by the RPC.
export async function mergeTransfers(
  winnerId: string,
  loserId: string,
  propertyId: string,
  reason: string | null,
) {
  const supabase = createClient();
  const { error } = await supabase.rpc("merge_transfers", {
    p_winner: winnerId,
    p_loser: loserId,
    p_reason: reason,
  });
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/properties");
  revalidatePath("/dashboard");
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

// Agent action: mark a transfer sold. Wraps the mark_transfer_sold RPC
// (migration 0033). Dream-sold records intent only; external categories
// flip status to sold_external and skip the deed workflow. Note is
// optional freeform (partner agency name, context).
export type SoldBy = "dream" | "partner" | "other" | "pre_mandate";

export async function markTransferSold(
  transferId: string,
  propertyId: string,
  soldBy: SoldBy,
  soldByNote: string | null,
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "unauthorised" };

  const { error } = await supabase.rpc("mark_transfer_sold", {
    p_transfer_id: transferId,
    p_sold_by: soldBy,
    p_sold_by_note: soldByNote,
  });
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/properties");
  revalidatePath("/dashboard");
  revalidatePath("/map");
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}
