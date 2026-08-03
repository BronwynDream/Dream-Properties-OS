import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import ChangePasswordForm from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <TopBar />
      <main className="account-wrap">
        <header className="page-head">
          <p className="eyebrow">Account</p>
          <h1>Change password</h1>
        </header>
        <div className="account-panel">
          <p className="account-signed-in">
            Signed in as <strong>{user.email}</strong>
          </p>
          <ChangePasswordForm />
        </div>
      </main>
    </>
  );
}
