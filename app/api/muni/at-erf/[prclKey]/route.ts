import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

// GET /api/muni/at-erf/:prclKey
//
// Called from the map when a user clicks an erf boundary polygon that has
// no OS/P24 overlay. Returns the muni_property + summed muni_valuation
// for that specific parcel so the click can render a lightweight popup.
//
// prclKey is the value stored on the vector tile feature — the cadastre's
// tag_value column (numeric SG21 fragment). Match against muni_property
// by string-including it in the sg_number (same regex the
// muni_lookup_at_point PL/SQL function uses).
//
// Staff read only. Owner column is stripped for non-admin sessions.

export async function GET(_req: Request, { params }: { params: { prclKey: string } }) {
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

  // The prclKey coming from the vector tile is the tag_value — a numeric
  // fragment. Match by checking that the digits-only projection of
  // muni_property.sg_number contains it. Uses the same shape as
  // muni_lookup_at_point in migration 0049.
  const key = String(params.prclKey).replace(/[^0-9]/g, "");
  if (key.length === 0) {
    return NextResponse.json({ error: "invalid prclKey" }, { status: 400 });
  }

  const { data: props, error } = await service
    .from("muni_property")
    .select(
      "sg_number, erf_number, muni_erf_code, street_no, street_name, suburb, town_name, extent_sqm, zoning, ward_no, usage_, property_type, title_deed_no, deeds_office, purch_date, purch_price, owner, refreshed_at",
    )
    .filter(
      // Use REGEXP_REPLACE inside a filter isn't a first-class PostgREST
      // operation; approximate by checking with ilike on the padded key.
      "sg_number",
      "ilike",
      `%${key}%`,
    )
    .limit(5);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = props ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "no muni row for this parcel" }, { status: 404 });
  }
  // Prefer an exact numeric match on the last digits of sg_number.
  const best = rows.find((r) => (r.sg_number ?? "").replace(/[^0-9]/g, "").includes(key)) ?? rows[0];

  // Pull the per-tariff valuations for this sg_number and sum for the
  // headline number.
  const { data: vals } = await service
    .from("muni_valuation")
    .select("tariff, valuation, area_sqm, is_marker")
    .eq("sg_number", best.sg_number);
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
  });
}
