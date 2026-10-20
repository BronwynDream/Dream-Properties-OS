import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { collect, render } from "@/lib/health/dailyReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health/daily — the morning health email (2026-10-20).
//   * Vercel Cron (Bearer CRON_SECRET): builds the report and emails every
//     active director via Resend.
//   * A signed-in director: ?preview=1 shows today's email in the browser
//     without sending; ?send=1 sends it now.

function constantTimeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function caller(request: Request): Promise<"cron" | "admin" | null> {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (secret && bearer && constantTimeEq(bearer, secret)) return "cron";
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase.from("app_user").select("role, active").eq("id", user.id).single();
  return me?.role === "admin" && me.active !== false ? "admin" : null;
}

export async function GET(request: Request) {
  const who = await caller(request);
  if (!who) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const url = new URL(request.url);
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? url.origin).replace(/\/$/, "");

  const svc = createServiceClient();
  const report = render(await collect(svc), site);

  if (who === "admin" && !url.searchParams.has("send")) {
    return new NextResponse(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${report.subject}</title><p style="font-family:sans-serif;font-size:13px;color:#555;margin:12px">Preview — not sent. Subject: <b>${report.subject}</b></p>${report.html}`, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const from = (process.env.NOTIFY_FROM ?? "").trim();
  if (!apiKey || !from) return NextResponse.json({ error: "RESEND_API_KEY / NOTIFY_FROM not set" }, { status: 500 });
  const { data: admins } = await svc.from("app_user").select("email").eq("role", "admin").eq("active", true).not("email", "is", null);
  const to = ((admins ?? []) as { email: string | null }[]).map((a) => (a.email ?? "").trim()).filter(Boolean);
  if (!to.length) return NextResponse.json({ error: "no active directors with email" }, { status: 500 });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: report.subject, html: report.html, text: report.text }),
  });
  if (!res.ok) return NextResponse.json({ error: `Resend HTTP ${res.status}`, detail: (await res.text()).slice(0, 300) }, { status: 502 });
  return NextResponse.json({ ok: true, sentTo: to.length, verdict: report.verdict });
}
