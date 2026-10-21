"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAppRole, type AppRole } from "./roles";

// requireAdmin: the caller must be signed in AND flagged admin AND active.
// Every write in this file goes through it. Non-admins never reach the DB —
// RLS would block them anyway (0005_rls.sql), but a clean early return keeps
// the errors readable and stops us from wasting a service-role call on an
// unauthorised path.
async function requireAdmin(): Promise<
  | { ok: true; userId: string; email: string | null }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not signed in" };

  const { data: me } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me) return { ok: false, error: "your app_user record is missing" };
  if (me.role !== "admin") return { ok: false, error: "directors only" };
  if (me.active === false) return { ok: false, error: "your account is inactive" };

  return { ok: true, userId: user.id, email: user.email ?? null };
}

// Patch an app_user row. Only writes the columns explicitly passed — never
// coalesces a non-null column to null by mistake.
//
// Self-lockout: a Director cannot demote themselves or deactivate themselves.
// If the only admin were to remove their own admin, no one could restore
// team access; RLS on app_user is admin-only for writes. Guard is on the
// current session's user id.
export async function updateTeamMember(input: {
  userId: string;
  role?: AppRole;
  job_title?: string | null;
  phone?: string | null;
  active?: boolean;
  ppra_ffc?: string | null;         // FFC certificate number
  ffc_expiry_date?: string | null;  // ISO date; null clears
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false as const, error: gate.error };

  if (!input.userId) return { ok: false as const, error: "userId required" };

  const isSelf = input.userId === gate.userId;
  if (isSelf) {
    if (input.role !== undefined && input.role !== "admin") {
      return {
        ok: false as const,
        error: "You can't change your own access role away from Director.",
      };
    }
    if (input.active === false) {
      return {
        ok: false as const,
        error: "You can't deactivate your own account.",
      };
    }
  }

  const patch: Record<string, unknown> = {};
  if (input.role !== undefined) {
    if (!isAppRole(input.role)) {
      return { ok: false as const, error: `unknown role: ${input.role}` };
    }
    patch.role = input.role;
  }
  if (input.job_title !== undefined) {
    const v = (input.job_title ?? "").trim();
    patch.job_title = v.length > 0 ? v : null;
  }
  if (input.phone !== undefined) {
    const v = (input.phone ?? "").trim();
    patch.phone = v.length > 0 ? v : null;
  }
  if (input.active !== undefined) patch.active = input.active;
  if (input.ppra_ffc !== undefined) {
    const v = (input.ppra_ffc ?? "").trim();
    patch.ppra_ffc = v.length > 0 ? v : null;
  }
  if (input.ffc_expiry_date !== undefined) {
    // Accept empty string → null; validate ISO YYYY-MM-DD when set.
    const v = (input.ffc_expiry_date ?? "").trim();
    if (v.length === 0) {
      patch.ffc_expiry_date = null;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return { ok: false as const, error: "FFC expiry must be YYYY-MM-DD" };
    } else {
      patch.ffc_expiry_date = v;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false as const, error: "nothing to update" };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("app_user")
    .update(patch)
    .eq("id", input.userId);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/team");
  revalidatePath("/compliance");
  return { ok: true as const };
}

// Invite a new team member. Two-step (service-role):
//   1. auth.admin.inviteUserByEmail — sends the "set your password" email
//      via Supabase Auth. Supabase Auth email must be configured (SMTP or
//      the built-in test sender), otherwise this returns an error we
//      surface verbatim.
//   2. upsert the app_user row on the auth-user id — the profile fields
//      (role, job_title, phone) land immediately, so the invitee is
//      recognisable on the /team screen even before they've clicked
//      through and signed in.
//
// Uses createServiceClient so the invite has permission to write to auth
// (anon can't). Service key stays server-only — never leaks to the client.
export async function inviteTeamMember(input: {
  email: string;
  full_name: string;
  role: AppRole;
  job_title?: string | null;
  phone?: string | null;
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false as const, error: gate.error };

  const email = (input.email ?? "").trim().toLowerCase();
  const full_name = (input.full_name ?? "").trim();
  if (!email || !full_name) {
    return { ok: false as const, error: "Name and email are both required." };
  }
  if (!isAppRole(input.role)) {
    return { ok: false as const, error: `unknown role: ${input.role}` };
  }

  let service;
  try {
    service = createServiceClient();
  } catch (e) {
    return {
      ok: false as const,
      error:
        (e as Error).message +
        " — set SUPABASE_SERVICE_ROLE_KEY on Vercel to enable invites.",
    };
  }

  // Invite link is a code-exchange URL. Route it through /auth/callback so the
  // session cookie gets written; then land the invitee on /account/password to
  // set their initial password before they hit the rest of the app.
  const redirectTo = process.env.NEXT_PUBLIC_SITE_URL
    ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/account/password`
    : undefined;

  const { data: invite, error: inviteErr } =
    await service.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (inviteErr || !invite?.user?.id) {
    return {
      ok: false as const,
      error: inviteErr?.message ?? "invite failed (no user id returned)",
    };
  }

  const jobTitle = (input.job_title ?? "").trim();
  const phone = (input.phone ?? "").trim();

  const { error: upErr } = await service
    .from("app_user")
    .upsert(
      {
        id: invite.user.id,
        full_name,
        email,
        role: input.role,
        job_title: jobTitle || null,
        phone: phone || null,
        active: true,
      },
      { onConflict: "id" },
    );
  if (upErr) {
    return {
      ok: false as const,
      error: `invite email sent, but profile save failed: ${upErr.message}`,
    };
  }

  revalidatePath("/team");
  return { ok: true as const, userId: invite.user.id };
}

// ---------------------------------------------------------------------------
// Agent roster access (2026-10-19). Simon: "each agent is already listed as
// an agent but toggled off for access at this point. Then I want to invite
// them by turning on their access."
//
// The roster is the `agent` table (0085, from the website). Turning access ON:
//   * no login yet → send the Supabase invitation email and create their
//     app_user (role agent); the 0085 trigger links the roster row by email,
//     so their listings are theirs from the first sign-in;
//   * a login that already exists in Supabase Auth but has no app_user (an
//     invite sent from the Supabase dashboard) → create the app_user, no
//     second email;
//   * a login that was switched off → switch it back on.
// Turning access OFF sets app_user.active = false: from 0086 every access
// check starts with is_staff(), which requires an active login, so they see
// nothing from their next request. Their listings and contacts stay put.
// Directors are managed in the team list below the roster, not here.
// ---------------------------------------------------------------------------
export async function setAgentAccess(input: { agentId: string; on: boolean }) {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false as const, error: gate.error };

  let service;
  try {
    service = createServiceClient();
  } catch (e) {
    return { ok: false as const, error: `${(e as Error).message} — set SUPABASE_SERVICE_ROLE_KEY on Vercel.` };
  }

  let { data: agent } = await service
    .from("agent")
    .select("id, full_name, email, phone, app_user_id, invite_role")
    .eq("id", input.agentId)
    .maybeSingle();
  if (!agent) {
    // before migration 0087 (no invite_role column)
    const base = await service.from("agent").select("id, full_name, email, phone, app_user_id").eq("id", input.agentId).maybeSingle();
    agent = base.data ? { ...base.data, invite_role: "agent" } : null;
  }
  if (!agent) return { ok: false as const, error: "That agent isn't on the roster." };
  const email = String(agent.email).trim().toLowerCase();

  // Which login, if any, this agent has.
  let appUser: { id: string; role: string; active: boolean } | null = null;
  if (agent.app_user_id) {
    const { data } = await service.from("app_user").select("id, role, active").eq("id", agent.app_user_id).maybeSingle();
    appUser = data ?? null;
  }
  if (!appUser) {
    const { data } = await service.from("app_user").select("id, role, active").ilike("email", email).maybeSingle();
    appUser = data ?? null;
  }
  if (appUser && appUser.role === "admin") {
    return { ok: false as const, error: `${agent.full_name} is a director — change directors in the team list below.` };
  }
  if (appUser && appUser.id === gate.userId) {
    return { ok: false as const, error: "You can't switch off your own access." };
  }

  if (!input.on) {
    if (!appUser) return { ok: true as const, state: "off" as const };
    const { error } = await service.from("app_user").update({ active: false }).eq("id", appUser.id);
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/team");
    return { ok: true as const, state: "off" as const };
  }

  if (appUser) {
    const { error } = await service.from("app_user").update({ active: true }).eq("id", appUser.id);
    if (error) return { ok: false as const, error: error.message };
    if (!agent.app_user_id) await service.from("agent").update({ app_user_id: appUser.id }).eq("id", agent.id);
    revalidatePath("/team");
    return { ok: true as const, state: "on" as const };
  }

  // No app_user: maybe a Supabase Auth login already exists (invited from
  // the dashboard). Use it rather than sending a second invitation.
  let authUserId: string | null = null;
  let invited = false;
  const existing = await findAuthUserByEmail(service, email);
  if (existing) {
    authUserId = existing;
  } else {
    const redirectTo = process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/account/password`
      : undefined;
    const { data: invite, error: inviteErr } = await service.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inviteErr || !invite?.user?.id) {
      return { ok: false as const, error: inviteErr?.message ?? "The invitation didn't send." };
    }
    authUserId = invite.user.id;
    invited = true;
  }

  const { error: upErr } = await service.from("app_user").upsert(
    {
      id: authUserId,
      full_name: agent.full_name,
      email,
      role: agent.invite_role === "admin" ? "admin" : agent.invite_role === "compliance" ? "compliance" : "agent",
      phone: agent.phone ?? null,
      active: true,
    },
    { onConflict: "id" },
  );
  if (upErr) {
    return { ok: false as const, error: `${invited ? "Invitation sent, but" : ""} saving the login failed: ${upErr.message}` };
  }
  // The 0085 trigger links by email; make sure even if emails differ in case.
  await service.from("agent").update({ app_user_id: authUserId }).eq("id", agent.id).is("app_user_id", null);

  revalidatePath("/team");
  return { ok: true as const, state: invited ? ("invited" as const) : ("on" as const) };
}

async function findAuthUserByEmail(service: ReturnType<typeof createServiceClient>, email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

// Put someone on the roster without inviting them (Simon, 2026-10-19:
// "load everyone and not have to send an invite"). No email goes out; the
// invitation is sent when their access is switched on.
export async function addRosterPerson(input: {
  full_name: string;
  email: string;
  phone?: string | null;
  role: "agent" | "admin" | "compliance";
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const full_name = (input.full_name ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  if (!full_name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false as const, error: "Add their name and a valid email address." };
  }
  let service;
  try {
    service = createServiceClient();
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
  const { data: dup } = await service.from("agent").select("id").ilike("email", email).maybeSingle();
  if (dup) return { ok: false as const, error: "That email is already on the list." };
  const row: Record<string, unknown> = {
    full_name,
    email,
    phone: (input.phone ?? "").trim() || null,
    invite_role: input.role === "admin" ? "admin" : input.role === "compliance" ? "compliance" : "agent",
  };
  let { data, error } = await service.from("agent").insert(row).select("id").single();
  if (error && /invite_role/.test(error.message)) {
    if (input.role !== "agent") {
      return { ok: false as const, error: "Adding a director or compliance person needs migration 0087 first." };
    }
    delete row.invite_role;
    ({ data, error } = await service.from("agent").insert(row).select("id").single());
  }
  if (error || !data) return { ok: false as const, error: error?.message ?? "Couldn't add them." };
  // If a login with this email already exists, link it (0085 trigger only
  // fires on app_user changes).
  const { data: u } = await service.from("app_user").select("id").ilike("email", email).maybeSingle();
  if (u) await service.from("agent").update({ app_user_id: u.id }).eq("id", data.id);
  revalidatePath("/team");
  return { ok: true as const, agentId: data.id };
}
