import type { SupabaseClient } from "@supabase/supabase-js";

// The listings this login works on (2026-10-19). Before, the dashboard,
// Mandates and Pipeline read listing.agent_user_id — the LEAD agent only —
// so a co-agent (Vanessa on Bronwyn's listings) saw none of their shared
// listings. This is the same rule the database uses (0086
// works_on_listing): on listing_agent through their agent roster row, or
// listing.agent_user_id.
export async function myListingIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const ids = new Set<string>();
  const [{ data: lead }, { data: agent }] = await Promise.all([
    supabase.from("listing").select("id").eq("agent_user_id", userId),
    supabase.from("agent").select("id").eq("app_user_id", userId).eq("active", true).maybeSingle(),
  ]);
  for (const r of (lead ?? []) as { id: string }[]) ids.add(r.id);
  if (agent?.id) {
    const { data: la } = await supabase.from("listing_agent").select("listing_id").eq("agent_id", agent.id);
    for (const r of (la ?? []) as { listing_id: string }[]) ids.add(r.listing_id);
  }
  return [...ids];
}
