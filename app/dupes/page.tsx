import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PairCard, { PropertyPair, PartyPair, Pair } from "./PairCard";

export const dynamic = "force-dynamic";

type SearchParams = { kind?: string; threshold?: string };

export default async function DupesPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Admins only — the RPCs enforce this too, but bail early with a message.
  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin";

  const kind = searchParams.kind === "party" ? "party" : "property";
  const threshold = Math.max(0.3, Math.min(0.95, parseFloat(searchParams.threshold ?? "0.5") || 0.5));

  let pairs: Pair[] = [];
  let notReady = false;
  let queryError: string | null = null;

  if (isAdmin) {
    if (kind === "property") {
      const { data, error } = await supabase.rpc("find_property_dupes", {
        p_threshold: threshold,
        p_limit: 50,
      });
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) notReady = true;
        else queryError = error.message;
      } else {
        pairs = ((data ?? []) as PropertyPair[]).map((p) => ({ ...p, kind: "property" }));
      }
    } else {
      const { data, error } = await supabase.rpc("find_party_dupes", {
        p_threshold: threshold,
        p_limit: 50,
      });
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) notReady = true;
        else queryError = error.message;
      } else {
        pairs = ((data ?? []) as PartyPair[]).map((p) => ({ ...p, kind: "party" }));
      }
    }
  }

  return (
    <main>
      <header
        className="app-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <p className="eyebrow">Dream Knysna · Duplicate finder</p>
          <h1>Merge duplicate records</h1>
        </div>
        <Link href="/dashboard" className="ghost-link">
          ← Dashboard
        </Link>
      </header>
      <hr className="tideline" />

      <section className="app-body" style={{ maxWidth: 1000 }}>
        {!isAdmin ? (
          <p className="error">
            Admin only. Your role ({profile?.role ?? "unknown"}) can&apos;t merge records.
          </p>
        ) : notReady ? (
          <p className="error">
            The dupe-finder functions aren&apos;t in the database yet. Run{" "}
            <code>0013_dupe_finder.sql</code> in the Supabase SQL Editor, then reload.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 20, alignItems: "baseline", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <Link
                  href={`/dupes?kind=property&threshold=${threshold}`}
                  className={kind === "property" ? "cta" : "ghost-dark"}
                  style={{ textDecoration: "none" }}
                >
                  Properties
                </Link>
                <Link
                  href={`/dupes?kind=party&threshold=${threshold}`}
                  className={kind === "party" ? "cta" : "ghost-dark"}
                  style={{ textDecoration: "none" }}
                >
                  Parties
                </Link>
              </div>
              <form
                action="/dupes"
                method="get"
                style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}
              >
                <input type="hidden" name="kind" value={kind} />
                <label style={{ fontSize: 12, color: "#6b78a0" }}>Threshold</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.3"
                  max="0.95"
                  name="threshold"
                  defaultValue={threshold}
                  style={{
                    width: 70,
                    padding: "4px 8px",
                    border: "1px solid var(--mist)",
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                />
                <button className="ghost-dark" type="submit">
                  Rescan
                </button>
              </form>
            </div>

            <p style={{ color: "#5b6885", fontSize: 13, marginTop: 4, marginBottom: 20 }}>
              Trigram-fuzzy scan of{" "}
              {kind === "property" ? "property addresses" : "party names"} at score ≥ {threshold}.
              Exact deed / ID / registration matches score 1.00. Dismissed pairs stay hidden.
            </p>

            {queryError && (
              <p className="error" style={{ marginBottom: 16 }}>
                Scan failed: {queryError}
              </p>
            )}

            {pairs.length === 0 && !queryError ? (
              <p style={{ color: "#5b6885" }}>
                No candidate duplicates at this threshold. Lower it if you suspect something
                is being missed.
              </p>
            ) : (
              pairs.map((p) => <PairCard key={`${p.a_id}-${p.b_id}`} pair={p} />)
            )}
          </>
        )}
      </section>
    </main>
  );
}
