import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/* eslint-disable @typescript-eslint/no-explicit-any */

// GET /api/muni/at-erf/:prclKey?erf=<erfNumber>&town=<townName>
//
// Called from the map when a user clicks an erf boundary polygon that has
// no OS/P24 overlay. The parcels vector tile exposes tag_value (the
// erf number as displayed on the CSG parcel — usually the same as the
// muni's erf_number) and maj_region (uppercase town). The click handler
// passes these as query params. We match muni_property on (erf_number,
// town_name) which works for both the ArcGIS-sourced rows (real SG21)
// and the Full-GV synthetic rows (`GV:erf:ptn:unit:TOWN` keyed).
//
// The :prclKey path segment is kept for compatibility with the earlier
// version — if erf/town params aren't provided, we fall back to
// digits-only sg_number ilike matching (works only for ArcGIS-sourced
// rows, misses GV-synthetic ones).

export async function GET(req: Request, { params }: { params: { prclKey: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" && profile?.role !== "agent") {
    return NextResponse.json({ error: "staff only" }, { status: 403 });
  }
  const isAdmin = profile?.role === "admin";

  const service = createServiceClient();

  const url = new URL(req.url);
  const erf = (url.searchParams.get("erf") ?? "").trim();
  const town = (url.searchParams.get("town") ?? "").trim();

  // Primary path — (erf_number, town_name) match. Works for both
  // ArcGIS-sourced and GV-synthetic sg_numbers.
  const SELECT =
    "sg_number, erf_number, muni_erf_code, street_no, street_name, suburb, town_name, extent_sqm, zoning, ward_no, usage_, property_type, title_deed_no, deeds_office, purch_date, purch_price, owner, refreshed_at";
  let rows: any[] = [];
  if (erf) {
    let q = service.from("muni_property").select(SELECT).eq("erf_number", erf).limit(20);
    if (town) q = q.ilike("town_name", town);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows = data ?? [];
  }

  // Fallback path — digits-only sg_number ilike. Only useful when the
  // caller didn't supply erf/town. Left in place for older clients.
  if (rows.length === 0) {
    const key = String(params.prclKey).replace(/[^0-9]/g, "");
    if (key.length > 0) {
      const { data } = await service
        .from("muni_property")
        .select(SELECT)
        .ilike("sg_number", `%${key}%`)
        .limit(5);
      rows = data ?? [];
    }
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: `no muni row for erf ${erf || "?"} in ${town || "unknown town"}` },
      { status: 404 },
    );
  }

  // When multiple rows match (rare — usually sectional-title units on
  // the same erf), collapse to one card: pick the row with the most
  // populated address as canonical, sum valuations across every match.
  const best =
    rows
      .slice()
      .sort((a, b) => {
        const aFilled = (a.street_name ? 1 : 0) + (a.street_no ? 1 : 0) + (a.owner ? 1 : 0);
        const bFilled = (b.street_name ? 1 : 0) + (b.street_no ? 1 : 0) + (b.owner ? 1 : 0);
        return bFilled - aFilled;
      })[0];

  const allSgs = rows.map((r) => r.sg_number);
  const { data: vals } = await service
    .from("muni_valuation")
    .select("tariff, valuation, area_sqm, is_marker, sg_number")
    .in("sg_number", allSgs);

  const total = (vals ?? []).reduce(
    (s, v) => (v.valuation != null && !v.is_marker ? s + Number(v.valuation) : s),
    0,
  );

  return NextResponse.json({
    sgNumber: best.sg_number,
    erfNumber: best.erf_number,
    town: best.town_name ?? best.suburb ?? null,
    suburb: best.suburb ?? null,
    address: [best.street_no, best.street_name].filter(Boolean).join(" ") || null,
    extentSqm: best.extent_sqm ?? null,
    zoning: best.zoning ?? null,
    ward: best.ward_no ?? null,
    use: best.usage_ ?? null,
    propertyType: best.property_type ?? null,
    titleDeed: best.title_deed_no ?? null,
    deedsOffice: best.deeds_office ?? null,
    purchDate: best.purch_date ?? null,
    purchPrice: best.purch_price != null ? Number(best.purch_price) : null,
    // Owner: admin-only. Return null for agents.
    owner: isAdmin ? (best.owner ?? null) : null,
    muniValuationTotal: total > 0 ? total : null,
    valuations: (vals ?? []).map((v) => ({
      tariff: v.tariff === "__none__" ? null : v.tariff,
      valuation: v.valuation != null ? Number(v.valuation) : null,
      areaSqm: v.area_sqm ?? null,
      isMarker: v.is_marker ?? false,
    })),
    refreshedAt: best.refreshed_at ?? null,
    matchCount: rows.length,
  });
}
