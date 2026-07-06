import { createClient } from "@/lib/supabase/server";
import TopBarClient from "./TopBarClient";

export default async function TopBar() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("app_user")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  return (
    <TopBarClient
      name={profile?.full_name ?? user.email ?? "Signed in"}
      role={profile?.role ?? "agent"}
    />
  );
}
