import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 15;

// Point → ERF lookup via public SA cadastre REST endpoints. Free, no auth.
// See dream-erf-lookup-vendors memory (~/.claude/…/memory/dream-erf-lookup-vendors.md)
// for the research context and licensing notes.
//
// Query flow: Knysna Municipality first (town-specific, POPIA-clean — owner
// fields return NULL there), then GISCOE-hosted national CSG mirror as
// fallback for edges the muni layer misses (water lots, new subdivisions,
// or if we're ever asked about a non-Knysna property).
//
// GET /api/erf-lookup?lng=23.0181&lat=-34.0393

const KNYSNA_MUNI =
  "https://services3.arcgis.com/Kb9idbuOS9ILjfGd/arcgis/rest/services/Property_Info/FeatureServer/1/query";
const NATIONAL_CSG =
  "https://imagery.esri-southafrica.com/arcgis/rest/services/Cadastre/South_Africa_Cadastre/FeatureServer/0/query";

/* eslint-disable @typescript-eslint/no-explicit-any */
type LookupResult = {
  ok: boolean;
  erf?: string;
  sg21?: string;
  propDesc?: string;
  source?: "knysna_muni" | "national_csg";
  error?: string;
};

async function queryArcgis(
  url: string,
  lng: number,
  lat: number,
  outFields: string,
): Promise<any> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    returnGeometry: "false",
    f: "json",
  });
  const res = await fetch(`${url}?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const url = new URL(request.url);
  const lng = Number(url.searchParams.get("lng"));
  const lat = Number(url.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return NextResponse.json(
      { ok: false, error: "lng and lat required" } satisfies LookupResult,
      { status: 400 },
    );
  }

  // Primary: Knysna Municipality — town-specific, no owner PII returned.
  try {
    const data = await queryArcgis(KNYSNA_MUNI, lng, lat, "ERFNO,SG21CDE,PROP_DESC");
    const attrs = data?.features?.[0]?.attributes;
    if (attrs?.ERFNO != null) {
      return NextResponse.json({
        ok: true,
        erf: String(attrs.ERFNO).trim(),
        sg21: attrs.SG21CDE ? String(attrs.SG21CDE).trim() : undefined,
        propDesc: attrs.PROP_DESC ? String(attrs.PROP_DESC).trim() : undefined,
        source: "knysna_muni",
      } satisfies LookupResult);
    }
  } catch (e) {
    console.warn("[erf-lookup] Knysna Muni failed:", (e as Error).message);
  }

  // Fallback: national CSG mirror.
  try {
    const data = await queryArcgis(NATIONAL_CSG, lng, lat, "PROPNO,SG21KEY,PROPDESC");
    const attrs = data?.features?.[0]?.attributes;
    if (attrs?.PROPNO != null) {
      return NextResponse.json({
        ok: true,
        erf: String(attrs.PROPNO).trim(),
        sg21: attrs.SG21KEY ? String(attrs.SG21KEY).trim() : undefined,
        propDesc: attrs.PROPDESC ? String(attrs.PROPDESC).trim() : undefined,
        source: "national_csg",
      } satisfies LookupResult);
    }
  } catch (e) {
    console.warn("[erf-lookup] National CSG failed:", (e as Error).message);
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        "No erf found at that point. Try clicking closer to the actual roof — pin drift on shared driveways / green belts is common.",
    } satisfies LookupResult,
    { status: 404 },
  );
}
