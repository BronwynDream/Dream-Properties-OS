import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Uses the public anon key; RLS does the gating.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
