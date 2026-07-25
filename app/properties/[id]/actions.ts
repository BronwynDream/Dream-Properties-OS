"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Attach an erf number to a property. Written to be called from the ErfLookup
// flow (satellite-click → point→erf lookup → this action) but works for any
// caller with an admin session.
//
// The insert fires trg_erf_snap_property (migration 0039), which snaps the
// property's lat/lng to the cadastre centroid and stores prcl_key. So one
// call = correct pin position + correct erf assigned.
export async function attachErfToProperty(
  propertyId: string,
  erfNumber: string,
  sgNumber?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile?.active === false) {
    return { ok: false, error: "admin only" };
  }

  const trimmed = (erfNumber ?? "").trim();
  if (!trimmed) return { ok: false, error: "erf number required" };
  if (!propertyId) return { ok: false, error: "propertyId required" };
  const sg = sgNumber ? sgNumber.trim() : null;

  const { error } = await supabase.from("erf").insert({
    property_id: propertyId,
    erf_number: trimmed,
    sg_number: sg,
  });
  if (error) {
    // Unique-constraint violation on (property_id, erf_number, portion) OR
    // the 0041 partial index on the null-portion pair just means the erf is
    // already attached — treat as success but still try to backfill the
    // sg_number if the existing row has none.
    if (error.code === "23505") {
      if (sg) {
        await supabase
          .from("erf")
          .update({ sg_number: sg })
          .eq("property_id", propertyId)
          .eq("erf_number", trimmed)
          .is("sg_number", null);
      }
      return { ok: true };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/map");
  return { ok: true };
}
