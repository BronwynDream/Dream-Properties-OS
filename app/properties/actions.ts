"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Create a new property from the take-on flow. Address is required; everything
// else is optional. Returns the new property id so the caller can redirect
// straight to /properties/[id] and start dragging documents onto it.
//
// Lightstone integration: if the agent picked a candidate from Property Search,
// we get lightstone_property_id + normalised address parts (lat/lng, suburb
// name). We coalesce those onto the row so the very first Fetch-from-Lightstone
// call on this property skips the address re-resolve.
export async function createProperty(input: {
  primary_address: string;
  suburb_id?: string | null;
  erf_number?: string | null;
  title_deed_no?: string | null;
  lightstone_property_id?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  suburb_name?: string | null;
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

  revalidatePath("/properties");
  return { ok: true as const, id: newProp.id };
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
