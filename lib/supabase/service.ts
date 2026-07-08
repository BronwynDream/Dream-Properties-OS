import { createClient as createSbClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client — bypasses RLS. Only for server-side callers
// that have no authenticated user session (webhooks, scheduled jobs, admin
// scripts). Never expose the returned client to the browser.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in the environment (Vercel Project →
// Settings → Environment Variables). The key is the "service_role" from
// Supabase Dashboard → Settings → API — treat it like a root password.
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createSbClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
