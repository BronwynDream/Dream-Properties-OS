import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import SearchInput from "./SearchInput";
import ErfResultsTable from "./ErfResultsTable";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Staff-facing muni lookup. Type an ERF number ("1453") or a partial address
// ("15 eagles") and get the muni_property rows back — valuation, extent,
// zoning, deed history, purchase price. Same muni_property mirror that
// feeds the Property Record hero; this page just exposes it for the
// "agent gets a cold enquiry about a property Dream doesn't own yet" case.
//
// Search modes are auto-detected:
//   - All digits → erf_number exact match (there will typically be many hits
//     across suburbs since erf numbers repeat per suburb)
//   - Anything else → parsed into street_no + street_name tokens and matched
//     against those fields, plus a fallback ilike on suburb / suburb_hint

type Search = { q?: string; suburb?: string };

// muni_valuation moved to its own table in migration 0049 — the underlying
// muni_property row no longer has valuation / tariff / area_sqm_valroll
// columns. Read them via the nested join and let the result-rendering step
// sum them for the headline number.
const RESULT_COLS =
  "sg_number, erf_number, muni_erf_code, street_no, street_name, suburb, suburb_hint, zoning, ward_no, sectional_title_flag, usage_, extent_sqm, property_type, sect_scheme_name, sect_scheme_unit, title_deed_no, old_title_deed_no, deeds_office, purch_date, registration_date, purch_price, bond_number, bond_amount, bond_institution, refreshed_at, valuations:muni_valuation(tariff, valuation, area_sqm)";

function looksNumericErf(q: string): boolean {
  return /^\d{1,7}$/.test(q.trim());
}

// Parse a raw address query into (leading number, remaining tokens). Tokens
// are ilike-safe (escaped % and _). Handles the common "15 eagles way",
// "15 eagles", "eagles way" shapes.
function parseAddress(q: string): { streetNo: string | null; tokens: string[] } {
  const cleaned = q.trim().replace(/\s+/g, " ");
  const m = cleaned.match(/^(\d+)\s+(.*)$/);
  const streetNo = m ? m[1] : null;
  const remainder = m ? m[2] : cleaned;
  const tokens = remainder
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[%_]/g, (c) => `\\${c}`));
  return { streetNo, tokens };
}

// Collapse the nested `valuations` array into (a) a total for the compact
// row headline and (b) a breakdown array for the detail panel. Sentinel
// '__none__' tariff is stripped back to null for display so users don't
// see the internal token.
type ValuationRow = { tariff: string; valuation: number | null; area_sqm: number | null };
function shapeRow(raw: any): any {
  const valuations: ValuationRow[] = Array.isArray(raw.valuations)
    ? raw.valuations.map((v: any) => ({
        tariff: v.tariff === "__none__" ? null : v.tariff,
        valuation: v.valuation != null ? Number(v.valuation) : null,
        area_sqm: v.area_sqm != null ? Number(v.area_sqm) : null,
      }))
    : [];
  const total = valuations.reduce(
    (sum, v) => (v.valuation != null ? sum + v.valuation : sum),
    0,
  );
  return {
    ...raw,
    valuations,
    muni_valuation_total: valuations.length > 0 ? total : null,
    // Preferred extent = deed extent, fallback = valuation-roll area (which
    // now comes from the sum-first valuation row).
    area_sqm_valroll: valuations[0]?.area_sqm ?? null,
  };
}

async function fetchDistinctSuburbs(supabase: any): Promise<string[]> {
  // muni_property has ~21k rows; suburb is well-indexed. Distinct across
  // that is cheap. Used to populate the suburb-narrowing dropdown so a user
  // searching for ERF 1453 can pick "LEISURE ISLE" and see just the one row.
  const { data } = await supabase
    .from("muni_property")
    .select("suburb")
    .not("suburb", "is", null)
    .order("suburb", { ascending: true });
  const uniq = new Set<string>();
  for (const r of (data ?? []) as { suburb: string | null }[]) {
    if (r.suburb && r.suburb.trim().length > 0) uniq.add(r.suburb.trim());
  }
  return Array.from(uniq).sort((a, b) => a.localeCompare(b));
}

export default async function ErfLookupPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const q = (searchParams.q ?? "").trim();
  const suburbFilter = (searchParams.suburb ?? "").trim();
  const suburbs = await fetchDistinctSuburbs(supabase);

  let rows: any[] = [];
  let mode: "erf" | "address" | "empty" = "empty";
  if (q.length > 0) {
    if (looksNumericErf(q)) {
      mode = "erf";
      let query = supabase
        .from("muni_property")
        .select(RESULT_COLS)
        .eq("erf_number", q);
      if (suburbFilter) query = query.eq("suburb", suburbFilter);
      const { data } = await query
        .order("suburb", { ascending: true })
        .order("street_no", { ascending: true })
        .limit(200);
      rows = (data ?? []).map(shapeRow);
    } else {
      mode = "address";
      const { streetNo, tokens } = parseAddress(q);
      let query = supabase.from("muni_property").select(RESULT_COLS);

      // Street number narrows first (exact match against text column); then
      // each address token has to appear in street_name (ilike per token).
      // A pure-word query with no number falls back to street_name ilike on
      // every token — good for "Leisure Isle" or "Eagles Way".
      if (streetNo) query = query.eq("street_no", streetNo);
      for (const t of tokens) {
        query = query.ilike("street_name", `%${t}%`);
      }
      if (suburbFilter) query = query.eq("suburb", suburbFilter);

      const { data } = await query
        .order("suburb", { ascending: true })
        .order("street_name", { ascending: true })
        .order("street_no", { ascending: true })
        .limit(200);
      rows = (data ?? []).map(shapeRow);
    }
  }

  return (
    <>
      <TopBar />
      <main>
        <header className="app-head">
          <p className="eyebrow">Dream Knysna · Erf Lookup</p>
          <h1>
            {q === ""
              ? "Municipal roll — search"
              : rows.length === 0
              ? `No matches for "${q}"${suburbFilter ? ` in ${suburbFilter}` : ""}`
              : `${rows.length} match${rows.length === 1 ? "" : "es"} · ${mode === "erf" ? "ERF" : "address"} search`}
          </h1>
          <p className="app-sub">
            Reads from{" "}
            <code style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
              muni_property
            </code>{" "}
            — Knysna Muni's public rateable-property mirror (valuation roll,
            finance system, deeds). Refreshed weekly via the map's{" "}
            <Link href="/map" style={{ color: "var(--navy)", fontWeight: 600 }}>
              Refresh Muni data
            </Link>{" "}
            button.
          </p>
        </header>
        <hr className="tideline" />

        <section className="app-body">
          <div style={{ marginBottom: 24 }}>
            <SearchInput initialQ={q} initialSuburb={suburbFilter} suburbs={suburbs} />
          </div>

          {q === "" ? (
            <p
              style={{
                color: "var(--paper-mute, #6a7692)",
                fontStyle: "italic",
                padding: "24px 0",
                lineHeight: 1.6,
              }}
            >
              Type an ERF number (e.g. <code>1453</code>) or a partial address
              (e.g. <code>15 eagles way</code>, <code>bowden park</code>).
              ERF numbers repeat across suburbs in Knysna — narrow with the
              suburb dropdown if you know it. Owner names, IDs, and contact
              details are deliberately not stored; only rates-roll public
              fields.
            </p>
          ) : rows.length === 0 ? (
            <p
              style={{
                color: "var(--paper-mute, #6a7692)",
                fontStyle: "italic",
                padding: "24px 0",
              }}
            >
              Nothing matched. Try dropping the street number, or clearing the
              suburb filter. ERF numbers are typed as digits only — no{" "}
              <code>&quot;ERF&quot;</code> prefix.
            </p>
          ) : (
            <ErfResultsTable rows={rows} />
          )}
        </section>
      </main>
    </>
  );
}
