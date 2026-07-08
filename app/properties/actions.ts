"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Create a new property from the take-on flow. Address is required; suburb,
// erf, deed are optional. Returns the new property id so the caller can
// redirect straight to /properties/[id] and start dragging documents onto it.
export async function createProperty(input: {
  primary_address: string;
  suburb_id?: string | null;
  erf_number?: string | null;
  title_deed_no?: string | null;
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

  const { data: newProp, error } = await supabase
    .from("property")
    .insert({
      primary_address: address,
      suburb_id: input.suburb_id ?? null,
      title_deed_no: (input.title_deed_no ?? "").trim() || null,
    })
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
