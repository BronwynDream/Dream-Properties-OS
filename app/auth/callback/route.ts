import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the ?code=… link that arrives from invite emails and password-recovery
// emails. Exchanges the code for a session cookie, then bounces the user to
// the ?next= param (defaults to /dashboard).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  if (!code) {
    // Invitation links from older templates carry the session in the #hash,
    // which a server never sees; the browser keeps the hash across this
    // redirect and the login page finishes the sign-in (see LoginPage).
    return NextResponse.redirect(new URL("/login?error=missing_code", url));
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Most often: the email was opened in a different browser from the one
    // that asked for it (see /auth/confirm). Say so on the login page.
    const why = /verifier|code/i.test(error.message) ? "other_browser" : /expired|invalid/i.test(error.message) ? "link_expired" : "link_failed";
    return NextResponse.redirect(new URL(`/login?error=${why}`, url));
  }

  return NextResponse.redirect(new URL(next, url));
}
