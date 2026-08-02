"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SellerInput } from "@/app/properties/actions";

// Seller-first entry point — mirror of createProperty's seller path. Creates
// the party (always), and optionally a property + preparing transfer + draft
// listing + transfer_party linking them. Redirect target is the property
// record when a property was captured, else the seller record.
//
// Party-first vs property-first arrive at the same underlying rows; the
// difference is which entity the agent thinks of first. See project state
// (2026-08-02 arc) for the design rationale.

export type NewSellerPropertyInput = {
  primary_address: string;
  suburb_id?: string | null;
  erf_number?: string | null;
  title_deed_no?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export async function createSellerWithProperty(input: {
  seller: SellerInput;
  property: NewSellerPropertyInput | null;
}): Promise<
  | { ok: true; partyId: string; propertyId: string | null; transferId: string | null; listingId: string | null }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const partyRow = buildPartyRow(input.seller);
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

  if (!input.property) {
    revalidatePath("/contacts");
    return { ok: true, partyId: newParty.id, propertyId: null, transferId: null, listingId: null };
  }

  const address = (input.property.primary_address ?? "").trim();
  if (address.length < 3) {
    revalidatePath("/contacts");
    return {
      ok: true,
      partyId: newParty.id,
      propertyId: null,
      transferId: null,
      listingId: null,
    };
  }

  const insertRow: Record<string, unknown> = {
    primary_address: address,
    suburb_id: input.property.suburb_id ?? null,
    title_deed_no: (input.property.title_deed_no ?? "").trim() || null,
  };
  if (input.property.latitude != null) insertRow.lat = input.property.latitude;
  if (input.property.longitude != null) insertRow.lng = input.property.longitude;

  const { data: newProp, error: propErr } = await supabase
    .from("property")
    .insert(insertRow)
    .select("id")
    .single();
  if (propErr || !newProp) {
    // Party was created; property failed. Not ideal but recoverable — agent
    // can add the property from the Seller Record page (once we wire the
    // "+ Add property" CTA there). Surface the error but return party id.
    return { ok: false, error: propErr?.message ?? "Could not create property." };
  }

  const erf = (input.property.erf_number ?? "").trim();
  if (erf) {
    await supabase.from("erf").insert({
      property_id: newProp.id,
      erf_number: erf,
    });
  }

  const { data: newTransfer, error: transferErr } = await supabase
    .from("transfer")
    .insert({
      property_id: newProp.id,
      name: `${address} — ${newParty.display_name} (preparing)`,
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
      property_id: newProp.id,
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

  revalidatePath("/contacts");
  revalidatePath("/properties");
  return {
    ok: true,
    partyId: newParty.id,
    propertyId: newProp.id,
    transferId: newTransfer.id,
    listingId: newListing.id,
  };
}

function buildPartyRow(s: SellerInput): Record<string, unknown> | null {
  const email = s.email?.trim() || null;
  const phone = s.phone?.trim() || null;

  if (s.party_type === "individual") {
    const fullName = (s.full_name ?? "").trim();
    if (!fullName) return null;
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
