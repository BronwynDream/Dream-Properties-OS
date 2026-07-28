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

// Assign an agent to a listing. Admin-only. agentUserId=null clears the
// assignment. Enables the per-agent dashboard scoping (listings show up on
// /dashboard for the assigned agent) and the /mandates scoping.
export async function assignListingAgent(
  listingId: string,
  agentUserId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };
  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile?.active === false) {
    return { ok: false, error: "admin only" };
  }
  if (!listingId) return { ok: false, error: "listingId required" };

  // Guard: if agentUserId is set, verify it points to an active agent so we
  // don't accidentally assign to a director or a deactivated account.
  if (agentUserId) {
    const { data: assignee } = await supabase
      .from("app_user")
      .select("id, role, active")
      .eq("id", agentUserId)
      .single();
    if (!assignee) return { ok: false, error: "unknown user" };
    if (assignee.active === false) return { ok: false, error: "user is inactive" };
    // Allow both 'agent' and 'admin' as valid assignees — Bronwyn / Camilla
    // sometimes co-list a property themselves.
    if (assignee.role !== "agent" && assignee.role !== "admin") {
      return { ok: false, error: `${assignee.role} cannot be assigned` };
    }
  }

  // Look up the property_id before the update so revalidation hits the right
  // Property Record page even for edge-case callers not going through the
  // page-level component.
  const { data: listingRow } = await supabase
    .from("listing")
    .select("property_id")
    .eq("id", listingId)
    .single();

  const { error } = await supabase
    .from("listing")
    .update({ agent_user_id: agentUserId })
    .eq("id", listingId);
  if (error) return { ok: false, error: error.message };

  if (listingRow?.property_id) {
    revalidatePath(`/properties/${listingRow.property_id}`);
  }
  revalidatePath("/dashboard");
  revalidatePath("/mandates");
  return { ok: true };
}
