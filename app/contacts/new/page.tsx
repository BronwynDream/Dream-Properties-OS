import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import NewSellerForm from "./NewSellerForm";

// Seller-first entry point. Mirror of /properties/+ New — either flow lands
// on the same underlying rows (property + party + preparing transfer + draft
// listing + transfer_party) so the agent can start from whichever entity
// they know first.

export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: suburbs } = await supabase
    .from("suburb")
    .select("id, name")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · New seller</p>
          <h1>Capture the seller</h1>
        </header>
        <hr className="tideline" />

        <section className="app-body" style={{ maxWidth: 880 }}>
          <div style={{ marginBottom: 16 }}>
            <Link
              href="/contacts"
              style={{ fontSize: 12, color: "var(--paper-mute)", textDecoration: "none" }}
            >
              ← Back to contact search
            </Link>
          </div>
          <NewSellerForm suburbs={(suburbs ?? []) as { id: string; name: string }[]} />
        </section>
      </main>
    </>
  );
}
