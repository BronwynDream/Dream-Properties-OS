import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { overallFeedLight } from "@/lib/feeds/overall";
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
  const role = profile?.role ?? "agent";

  // The compliance role sees the FICA desk and her account, nothing else
  // (2026-10-21, migration 0090). RLS already gives her no rows elsewhere;
  // this keeps her off empty pages.
  if (role === "compliance") {
    const path = headers().get("x-pathname") ?? "";
    const allowed = path === "/fica" || path.startsWith("/fica/") || path.startsWith("/account");
    if (!allowed) redirect("/fica");
  }
  const healthLight = role === "admin" ? await overallFeedLight(supabase) : null;

  return (
    <TopBarClient
      name={profile?.full_name ?? user.email ?? "Signed in"}
      role={role}
      healthLight={healthLight}
    />
  );
}
