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

  const redirectTo = process.env.NEXT_PUBLIC_SITE_URL
    ? `${process.env.NEXT_PUBLIC_SITE_URL}/login`
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
