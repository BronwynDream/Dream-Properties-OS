import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Dashboard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // app_user row carries the display name + role (RLS lets a user read their own row).
  const { data: profile } = await supabase
    .from("app_user")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  const name = profile?.full_name ?? user.email;
  const role = profile?.role ?? "no role set";

  return (
    <main>
      <header className="app-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p className="eyebrow">Dream Knysna · Properties OS</p>
          <h1>Welcome, {name}</h1>
        </div>
        <form action="/auth/signout" method="post">
          <button className="ghost" type="submit">Sign out</button>
        </form>
      </header>
      <hr className="tideline" />
      <section className="app-body">
        <p>
          You are signed in as <span className="pill">{role}</span>
        </p>
        <p style={{ color: "#5b6885", marginTop: 20, lineHeight: 1.6 }}>
          This is the gated shell — proof that login, sessions and role-based access
          are working end to end against the live database. The first working screen
          (the migration triage queue) plugs in here next.
        </p>
        {!profile && (
          <p className="error" style={{ marginTop: 20 }}>
            No <code>app_user</code> row found for this account yet. Seed one (see the
            README) so your role and access resolve.
          </p>
        )}
      </section>
    </main>
  );
}
