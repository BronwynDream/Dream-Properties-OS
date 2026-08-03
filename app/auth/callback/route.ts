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
    return NextResponse.redirect(new URL("/login?error=missing_code", url));
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url),
    );
  }

  return NextResponse.redirect(new URL(next, url));
}
