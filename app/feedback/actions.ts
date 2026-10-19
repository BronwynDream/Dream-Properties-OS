"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// "Something's not right" + automatic error capture (2026-10-19, migration
// 0089). Rows are written as the signed-in user; RLS allows staff to insert
// their own and directors to read.

type Context = {
  path: string;
  viewport?: string;
  userAgent?: string;
  standalone?: boolean;
  recentErrors?: string[];
};

const clip = (s: string | undefined | null, n: number) => (s ?? "").slice(0, n);

function details(ctx: Context, extra: Record<string, unknown> = {}) {
  return {
    viewport: clip(ctx.viewport, 40) || null,
    userAgent: clip(ctx.userAgent, 400) || null,
    standalone: !!ctx.standalone,
    recentErrors: (ctx.recentErrors ?? []).slice(-5).map((e) => clip(e, 300)),
    deploy: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    ...extra,
  };
}

export async function reportProblem(input: { message: string } & Context): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = input.message.trim();
  if (!message) return { ok: false, error: "Say in a few words what went wrong." };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out. Sign in again and retry." };
  const { error } = await supabase.from("app_feedback").insert({
    kind: "report",
    message: clip(message, 4000),
    path: clip(input.path, 500),
    details: details(input),
  });
  if (error) return { ok: false, error: "Couldn't send that. Check your signal and try again." };
  return { ok: true };
}

export async function logClientError(
  input: { message: string; stack?: string; digest?: string; source: string } & Context,
): Promise<void> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // One row per user + page + message per 30 minutes; repeats only bump a count.
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const message = clip(input.message || "Unknown error", 1000);
    const path = clip(input.path, 500);
    const { createServiceClient } = await import("@/lib/supabase/service");
    const db = createServiceClient();
    const { data: dup } = await db
      .from("app_feedback")
      .select("id, details")
      .eq("kind", "error")
      .eq("user_id", user.id)
      .eq("path", path)
      .eq("message", message)
      .is("resolved_at", null)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (dup) {
      const d = (dup.details ?? {}) as Record<string, unknown>;
      await db.from("app_feedback").update({ details: { ...d, count: Number(d.count ?? 1) + 1, lastAt: new Date().toISOString() } }).eq("id", dup.id);
      return;
    }
    await supabase.from("app_feedback").insert({
      kind: "error",
      message,
      path,
      details: details(input, { source: clip(input.source, 40), stack: clip(input.stack, 3000) || null, digest: clip(input.digest, 80) || null, count: 1 }),
    });
  } catch {
    // Never let error logging cause an error.
  }
}

export async function resolveFeedback(id: string, done: boolean): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase
    .from("app_feedback")
    .update(done ? { resolved_at: new Date().toISOString(), resolved_by: user.id } : { resolved_at: null, resolved_by: null })
    .eq("id", id);
  revalidatePath("/admin/reports");
  return { ok: !error };
}
