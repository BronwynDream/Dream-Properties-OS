import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Estate document vault — index page.
// Every estate carries architectural manuals, HOA rules, plant lists,
// disturbance-area plans per plot, entry-fee rules etc. Those live on
// the estate, not on any individual property (though property.estate_id
// ties them together). This page is the catalogue.

export default async function EstatesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Estates + doc counts + property counts. Two follow-up queries are
  // cheaper than a giant join at Dream's scale (< 20 estates).
  const { data: estates } = await supabase
    .from("estate")
    .select("id, name, kind, hoa_name, suburb:suburb_id(name)")
    .order("name", { ascending: true });

  const rows = (estates ?? []) as any[];
  const ids = rows.map((r) => r.id);

  const [{ data: propCounts }, { data: docCounts }] = ids.length
    ? await Promise.all([
        supabase.from("property").select("estate_id").in("estate_id", ids),
        supabase.from("document").select("estate_id").in("estate_id", ids),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }];

  const propCountByEstate = new Map<string, number>();
  for (const p of (propCounts ?? []) as any[]) {
    propCountByEstate.set(p.estate_id, (propCountByEstate.get(p.estate_id) ?? 0) + 1);
  }
  const docCountByEstate = new Map<string, number>();
  for (const d of (docCounts ?? []) as any[]) {
    docCountByEstate.set(d.estate_id, (docCountByEstate.get(d.estate_id) ?? 0) + 1);
  }

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Estate document vault</p>
          <h1>{rows.length} estate{rows.length === 1 ? "" : "s"}</h1>
          <p className="app-sub">
            Architectural manuals, HOA rules, plant lists, disturbance-area plans — everything that lives on the estate rather than on any single property.
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          {rows.length === 0 ? (
            <p style={{ color: "var(--paper-mute, #6a7692)", fontStyle: "italic", padding: "24px 0" }}>
              No estates yet. Migration 0058 seeds Pezula, Thesen, Leisure Isle, Simola and The Heads on apply.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {rows.map((e) => {
                const docCount = docCountByEstate.get(e.id) ?? 0;
                const propCount = propCountByEstate.get(e.id) ?? 0;
                return (
                  <li key={e.id}>
                    <Link
                      href={`/estates/${e.id}`}
                      prefetch={false}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 12,
                        padding: "14px 18px",
                        background: "var(--paper-1, #F5F1E8)",
                        border: "1px solid var(--line-soft, #E7E0D2)",
                        borderRadius: 6,
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      <div>
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "'Fraunces', 'Cormorant Garamond', serif",
                            fontSize: 18,
                            color: "var(--estuary, #132B84)",
                            fontWeight: 500,
                          }}
                        >
                          {e.name}
                        </p>
                        <p
                          style={{
                            margin: "3px 0 0",
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            fontSize: 10,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "var(--paper-mute, #6a7692)",
                          }}
                        >
                          {e.kind.replace(/_/g, " ")}
                          {(() => {
                            const s = Array.isArray(e.suburb) ? e.suburb[0] : e.suburb;
                            return s?.name ? ` · ${s.name}` : "";
                          })()}
                          {e.hoa_name && ` · ${e.hoa_name}`}
                        </p>
                      </div>
                      <div
                        style={{
                          textAlign: "right",
                          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                          fontSize: 11,
                          color: "var(--ink-700, #423B31)",
                          alignSelf: "center",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {docCount} doc{docCount === 1 ? "" : "s"} · {propCount} propert{propCount === 1 ? "y" : "ies"}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
