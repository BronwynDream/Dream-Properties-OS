import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/cadastre/snap
//
// Runs snap_all_to_parcels() — for every property and every active
// external_listing that has coords and geo_manual=false, find the smallest
// containing parcel, move the coord to its centroid, and remember the
// prcl_key. Rows with geo_manual=true are left alone.
//
// Called manually by an admin (Bronwyn / Camilla) after a fresh import.
// Also safe to call any time — the ST_Contains join is bounded by the
// GIST index on cadastral_parcel.geom.

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile?.active === false) {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }
  // Silence the unused-param lint until we accept a body.
  void request;

  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc("snap_all_to_parcels");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      ok: true,
      propertiesSnapped: Number(row?.properties_snapped ?? 0),
      listingsSnapped: Number(row?.listings_snapped ?? 0),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
