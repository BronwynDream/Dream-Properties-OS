"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function mergeProperties(
  winnerId: string,
  loserId: string,
  reason: string | null,
) {
  const supabase = createClient();
  const { error } = await supabase.rpc("merge_properties", {
    p_winner: winnerId,
    p_loser: loserId,
    p_reason: reason,
  });
  revalidatePath("/dupes");
  revalidatePath("/properties");
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function mergeParties(
  winnerId: string,
  loserId: string,
  reason: string | null,
) {
  const supabase = createClient();
  const { error } = await supabase.rpc("merge_parties", {
    p_winner: winnerId,
    p_loser: loserId,
    p_reason: reason,
  });
  revalidatePath("/dupes");
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function dismissDupe(
  kind: "property" | "party",
  aId: string,
  bId: string,
  reason: string | null,
) {
  const supabase = createClient();
  const { error } = await supabase.rpc("dismiss_dupe", {
    p_target_kind: kind,
    p_a_id: aId,
    p_b_id: bId,
    p_reason: reason,
  });
  revalidatePath("/dupes");
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}
