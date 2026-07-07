"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
