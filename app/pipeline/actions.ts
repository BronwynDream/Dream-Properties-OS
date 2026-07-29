"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { PIPELINE_STAGES, STAGE_LABEL, type AnyStage, type PipelineStage } from "@/lib/pipeline";

const ALLOWED_STAGES: readonly AnyStage[] = [
  ...PIPELINE_STAGES,
  "registered",
  "cancelled",
  "lapsed",
];

// Stage-move server action. Any staff-role can move a transfer they
// have write access to (RLS handles the deeper gate). Terminal moves
// (→ registered / cancelled / lapsed) require an explicit confirmation
// prop from the client so a stray click doesn't accidentally mark a
// deal registered and trigger commission logic downstream.
export async function setTransferStage(input: {
  transferId: string;
  toStage: AnyStage;
  confirmTerminal?: boolean;
}): Promise<{ ok: true; propertyId: string | null } | { ok: false; error: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };
  const { data: me } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me || me.active === false) return { ok: false, error: "inactive" };

  if (!input.transferId) return { ok: false, error: "transferId required" };
  if (!ALLOWED_STAGES.includes(input.toStage)) {
    return { ok: false, error: `unknown stage: ${input.toStage}` };
  }

  const terminal = input.toStage === "registered" || input.toStage === "cancelled" || input.toStage === "lapsed";
  if (terminal && !input.confirmTerminal) {
    return { ok: false, error: `${STAGE_LABEL[input.toStage]} is a terminal state — confirm required` };
  }

  const { data: existing } = await supabase
    .from("transfer")
    .select("id, property_id, status")
    .eq("id", input.transferId)
    .single();
  if (!existing) return { ok: false, error: "transfer not found" };
  if (existing.status === input.toStage) {
    return { ok: true, propertyId: existing.property_id ?? null };
  }

  const { error } = await supabase
    .from("transfer")
    .update({ status: input.toStage })
    .eq("id", input.transferId);
  if (error) return { ok: false, error: error.message };

  // trg_transfer_status_changed_at (migration 0055) stamps status_changed_at.
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  if (existing.property_id) revalidatePath(`/properties/${existing.property_id}`);
  return { ok: true, propertyId: existing.property_id ?? null };
}
