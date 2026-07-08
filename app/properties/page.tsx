import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import NewPropertyForm from "./NewPropertyForm";

export const dynamic = "force-dynamic";

type PropRow = {
  id: string;
  primary_address: string;
  title_deed_no: string | null;
  extent_sqm: number | null;
  suburb: { name: string } | null;
};

export default async function PropertiesList() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data }, suburbsRes] = await Promise.all([
    supabase
      .from("property")
      .select("id, primary_address, title_deed_no, extent_sqm, suburb:suburb_id(name)")
      .order("primary_address"),
    supabase.from("suburb").select("id, name").order("name"),
  ]);
  const props = (data ?? []) as unknown as PropRow[];
  const suburbs = (suburbsRes.data ?? []) as { id: string; name: string }[];

  return (
    <>
    <TopBar />
    <main>
      <header
        className="app-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <p className="eyebrow">Dream Knysna · Properties</p>
          <h1>Property database</h1>
        </div>
      </header>
      <hr className="tideline" />

      <section className="app-body" style={{ maxWidth: 1000 }}>
        <div style={{ marginBottom: 20 }}>
          <NewPropertyForm suburbs={suburbs} />
        </div>

        {props.length === 0 ? (
          <p style={{ color: "#5b6885" }}>
            No properties yet. Click <b>+ New property</b> above to take one on, or commit a
            batch from the migration triage.
          </p>
        ) : (
          <table className="queue">
            <thead>
              <tr>
                <th>Address</th>
                <th>Suburb</th>
                <th>Erf / Title deed</th>
                <th>Extent</th>
              </tr>
            </thead>
            <tbody>
              {props.map((p) => (
                <tr key={p.id}>
                  <td className="strong">
                    <Link href={`/properties/${p.id}`} className="row-link">
                      {p.primary_address}
                    </Link>
                  </td>
                  <td>{p.suburb?.name ?? "—"}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{p.title_deed_no ?? "—"}</td>
                  <td>{p.extent_sqm ? `${p.extent_sqm} m²` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
    </>
  );
}
