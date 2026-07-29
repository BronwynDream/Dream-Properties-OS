"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ViewingKind, ViewingStatus } from "@/lib/viewings";

async function requireAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "unauthorised" };
  const { data: me } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin" || me.active === false) return { ok: false as const, error: "admin only" };
  return { ok: true as const, supabase, userId: user.id };
}

// Schedule a viewing. Either listing/transfer/property must resolve
// to a property to satisfy the check constraint. propertyId is our
// preferred anchor since /viewings navigates by property.
export async function createViewing(input: {
  propertyId: string;
  listingId?: string | null;
  transferId?: string | null;
  agentUserId?: string | null;
  kind: ViewingKind;
  scheduledAt: string; // ISO datetime
  durationMinutes?: number;
  addressOverride?: string | null;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  if (!input.propertyId) return { ok: false, error: "propertyId required" };
  if (!input.scheduledAt) return { ok: false, error: "scheduledAt required" };
  const dt = new Date(input.scheduledAt);
  if (isNaN(dt.getTime())) return { ok: false, error: "invalid scheduledAt" };
  const { data, error } = await supabase
    .from("viewing")
    .insert({
      property_id: input.propertyId,
      listing_id: input.listingId ?? null,
      transfer_id: input.transferId ?? null,
      agent_user_id: input.agentUserId ?? null,
      kind: input.kind,
      scheduled_at: dt.toISOString(),
      duration_minutes: input.durationMinutes ?? 60,
      address_override: (input.addressOverride ?? "").trim() || null,
      notes: (input.notes ?? "").trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };
  revalidatePath("/viewings");
  revalidatePath(`/properties/${input.propertyId}`);
  return { ok: true, id: data.id };
}

export async function updateViewing(input: {
  id: string;
  propertyId: string;
  kind?: ViewingKind;
  status?: ViewingStatus;
  scheduledAt?: string;
  durationMinutes?: number;
  agentUserId?: string | null;
  addressOverride?: string | null;
  notes?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  const patch: Record<string, unknown> = {};
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.status !== undefined) patch.status = input.status;
  if (input.scheduledAt !== undefined) {
    const dt = new Date(input.scheduledAt);
    if (isNaN(dt.getTime())) return { ok: false, error: "invalid scheduledAt" };
    patch.scheduled_at = dt.toISOString();
  }
  if (input.durationMinutes !== undefined) patch.duration_minutes = input.durationMinutes;
  if (input.agentUserId !== undefined) patch.agent_user_id = input.agentUserId ?? null;
  if (input.addressOverride !== undefined) patch.address_override = (input.addressOverride ?? "").trim() || null;
  if (input.notes !== undefined) patch.notes = (input.notes ?? "").trim() || null;
  if (Object.keys(patch).length === 0) return { ok: false, error: "nothing to update" };
  const { error } = await supabase.from("viewing").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/viewings");
  revalidatePath(`/properties/${input.propertyId}`);
  return { ok: true };
}

export async function cancelViewing(input: {
  id: string;
  propertyId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateViewing({ id: input.id, propertyId: input.propertyId, status: "cancelled" });
}

// Attendee capture — walk-ins get name + email + phone as text; a
// known party links directly by id (skip name/email/phone in that case
// and pull from the party record for display).
export async function addAttendee(input: {
  viewingId: string;
  propertyId: string;
  partyId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  isInterested?: boolean | null;
  notes?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  if (!input.viewingId) return { ok: false, error: "viewingId required" };
  if (!input.partyId && !(input.name ?? "").trim()) {
    return { ok: false, error: "party or walk-in name required" };
  }
  const { data, error } = await supabase
    .from("viewing_attendee")
    .insert({
      viewing_id: input.viewingId,
      party_id: input.partyId ?? null,
      name: (input.name ?? "").trim() || null,
      email: (input.email ?? "").trim() || null,
      phone: (input.phone ?? "").trim() || null,
      is_interested: input.isInterested ?? null,
      notes: (input.notes ?? "").trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };
  revalidatePath("/viewings");
  revalidatePath(`/properties/${input.propertyId}`);
  return { ok: true, id: data.id };
}

export async function updateAttendee(input: {
  id: string;
  propertyId: string;
  followedUp?: boolean;
  isInterested?: boolean | null;
  notes?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  const patch: Record<string, unknown> = {};
  if (input.followedUp !== undefined) patch.followed_up = input.followedUp;
  if (input.isInterested !== undefined) patch.is_interested = input.isInterested;
  if (input.notes !== undefined) patch.notes = (input.notes ?? "").trim() || null;
  if (Object.keys(patch).length === 0) return { ok: false, error: "nothing to update" };
  const { error } = await supabase.from("viewing_attendee").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/viewings");
  revalidatePath(`/properties/${input.propertyId}`);
  return { ok: true };
}

export async function deleteAttendee(input: {
  id: string;
  propertyId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  const { error } = await supabase.from("viewing_attendee").delete().eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/viewings");
  revalidatePath(`/properties/${input.propertyId}`);
  return { ok: true };
}
