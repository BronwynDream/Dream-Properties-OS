import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Server-side take-on helpers (2026-10-19, with migration 0086).
//
// Property, listing, transfer and party INSERTS are director-only under RLS,
// but taking on a property and its seller is every agent's job. The take-on
// actions (Documents → Mandate, Properties → New property, Contacts → New
// seller) therefore write with the service client, after checking here that
// the caller is an active director or agent. Whatever they create is made
// theirs: the seller's party.owner_user_id, and the caller on the listing.

export type TakeOnCtx = {
  userId: string;
  isAdmin: boolean;
  db: ReturnType<typeof createServiceClient>;
};

export async function takeOnContext(): Promise<{ ok: true; ctx: TakeOnCtx } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out. Sign in again and retry." };
  const { data: me } = await supabase.from("app_user").select("role, active").eq("id", user.id).maybeSingle();
  if (!me || me.active === false || (me.role !== "admin" && me.role !== "agent")) {
    return { ok: false, error: "Your login isn't active on Dream OS." };
  }
  try {
    return { ok: true, ctx: { userId: user.id, isAdmin: me.role === "admin", db: createServiceClient() } };
  } catch {
    return { ok: false, error: "Dream OS can't write records right now (service key missing). Tell Simon." };
  }
}

/** Put the caller on a listing (lead if it has nobody yet). */
export async function claimListing(ctx: TakeOnCtx, listingId: string): Promise<void> {
  const { db, userId } = ctx;
  const { data: agent } = await db.from("agent").select("id").eq("app_user_id", userId).maybeSingle();
  const { data: l } = await db.from("listing").select("agent_user_id").eq("id", listingId).maybeSingle();
  if (agent) {
    const { data: existing } = await db.from("listing_agent").select("agent_id, position").eq("listing_id", listingId);
    const rows = (existing ?? []) as { agent_id: string; position: number }[];
    if (!rows.some((r) => r.agent_id === agent.id)) {
      await db.from("listing_agent").insert({
        listing_id: listingId,
        agent_id: agent.id,
        position: rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 1,
      });
    }
  }
  // Older screens read listing.agent_user_id as "the lead's login". Agents
  // without an agent-roster row (none today) still get access through it.
  if (l && !l.agent_user_id && (agent || !ctx.isAdmin)) {
    await db.from("listing").update({ agent_user_id: userId }).eq("id", listingId);
  }
}

/** Who is on a listing, and whether the caller is one of them. */
export async function listingMembers(
  db: TakeOnCtx["db"],
  listingId: string,
  userId: string,
): Promise<{ names: string[]; isMember: boolean }> {
  const [{ data: rows }, { data: l }] = await Promise.all([
    db.from("listing_agent").select("position, agent:agent_id(full_name, app_user_id, active)").eq("listing_id", listingId),
    db.from("listing").select("agent_user_id").eq("id", listingId).maybeSingle(),
  ]);
  type A = { full_name: string; app_user_id: string | null; active: boolean };
  const agents = ((rows ?? []) as unknown as { position: number; agent: A | A[] | null }[])
    .sort((a, b) => a.position - b.position)
    .map((r) => (Array.isArray(r.agent) ? r.agent[0] : r.agent))
    .filter(Boolean) as A[];
  const isMember = l?.agent_user_id === userId || agents.some((a) => a.active && a.app_user_id === userId);
  // A listing with nobody on it (intake creates these) is not up for grabs:
  // joining it would show its sellers and paperwork. A director assigns it.
  return { names: agents.map((a) => a.full_name), isMember };
}
