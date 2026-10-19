import { redirect } from "next/navigation";

// Front door → the app. Unauthenticated users are bounced to /login by middleware.
// If Supabase ever falls back to the bare site address with an email-link code
// (it does when a redirect address isn't on its allow-list), finish it.
export default function Home({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const code = typeof searchParams.code === "string" ? searchParams.code : null;
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}&next=/account/password`);
  const tokenHash = typeof searchParams.token_hash === "string" ? searchParams.token_hash : null;
  const type = typeof searchParams.type === "string" ? searchParams.type : null;
  if (tokenHash && type) redirect(`/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`);
  redirect("/dashboard");
}
