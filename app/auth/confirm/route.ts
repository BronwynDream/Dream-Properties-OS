import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Email links (password reset, invitation) land here (2026-10-19).
//
// Why not /auth/callback? That route swaps a ?code= for a session, which only
// works in the same browser that asked for the email (PKCE keeps a secret in
// that browser's cookies). On an iPhone the reset is often asked for in the
// home-screen app or Outlook's browser and the email opens in Safari — a
// different cookie jar — so the swap failed and Simon landed back on the login
// page. A token_hash link carries everything it needs, so it works in any
// browser. Supabase's email templates point here:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account/password
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account/password
const TYPES: EmailOtpType[] = ["recovery", "invite", "signup", "magiclink", "email", "email_change"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const nextParam = url.searchParams.get("next") ?? "/account/password";
  // Only ever bounce within the site.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/account/password";

  if (!tokenHash || !type || !TYPES.includes(type)) {
    return NextResponse.redirect(new URL("/login?error=link_incomplete", url));
  }

  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    const why = /expired|invalid/i.test(error.message) ? "link_expired" : "link_failed";
    return NextResponse.redirect(new URL(`/login?error=${why}`, url));
  }
  return NextResponse.redirect(new URL(next, url));
}
