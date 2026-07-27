"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setSetting } from "@/lib/settings";

// Server action for the /settings page. Parses + validates the mandate
// expiry windows field, writes to app_setting via the service-role setter,
// then revalidates the two consumer pages so the change is visible on the
// next navigation without a hard reload.

export async function saveMandateExpiryWindows(formData: FormData): Promise<{
  ok: true;
} | {
  ok: false;
  error: string;
}> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };
  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { ok: false, error: "admin only" };

  const raw = (formData.get("windows") ?? "").toString().trim();
  if (raw.length === 0) {
    return { ok: false, error: "Enter at least one number of days (e.g. 30, 60)." };
  }

  // Accept commas, spaces, semicolons, slashes — any reasonable list
  // delimiter. Reject anything that isn't a positive integer under 3650
  // (10 years — sane upper bound for a mandate).
  const tokens = raw.split(/[,;\s/]+/).filter((s) => s.length > 0);
  const parsed: number[] = [];
  for (const t of tokens) {
    const n = Number(t);
    if (!Number.isInteger(n) || n <= 0 || n > 3650) {
      return { ok: false, error: `"${t}" is not a positive integer between 1 and 3650.` };
    }
    parsed.push(n);
  }
  // Dedupe + sort ascending so the stored form is canonical regardless of
  // input order, and the /mandates page can trust the order.
  const canonical = Array.from(new Set(parsed)).sort((a, b) => a - b);

  const res = await setSetting("mandate.expiry_window_days", canonical, user.id);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath("/settings");
  revalidatePath("/mandates");
  return { ok: true };
}
