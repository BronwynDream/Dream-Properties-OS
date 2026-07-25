import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 15;

// Address → ERF lookup via Knysna Municipality's ArcGIS Finance System layer.
// This is the SAME rateable-property database the muni valuation roll runs
// on — the paper roll Bronwyn uses is a printed extract. We're just querying
// the digital source directly. Free, no auth.
//
// Fields queried:
//   PhysicalSt / PhysicalStNo  →  match the property's street address
//   ErfNo                       →  muni-coded (e.g. 102935000 for erf 2935)
//   SGNumber                    →  the SG21 code that joins to cadastral_parcel
//
// POPIA note: this layer also contains owner names + ID numbers. We
// deliberately do NOT request those fields — outFields is an allow-list.
//
// GET /api/erf-lookup?address=12+Eagles+Way

const MUNI_FINANCE =
  "https://services3.arcgis.com/Kb9idbuOS9ILjfGd/arcgis/rest/services/Property_Ownership_Deeds_Test/FeatureServer/57/query";

type Candidate = {
  muniErfCode: string;   // raw ErfNo (e.g. "102935000")
  erfNumber: string;     // parsed short erf (e.g. "2935")
  sgNumber: string;      // full SG21 code
  streetNo: string | null;
  streetName: string;
};

type LookupResponse = {
  ok: boolean;
  candidates?: Candidate[];
  parsed?: { streetNo: string | null; streetName: string };
  error?: string;
};

// "12 Eagles Way, The Heads, Knysna" → { streetNo: '12', streetName: 'Eagles Way' }
// Accepts leading number + optional letter (12, 12A). Strips suburb / city.
function parseAddress(address: string): { streetNo: string | null; streetName: string } {
  const trimmed = address.trim();
  const m = trimmed.match(/^(\d+[A-Za-z]?)\s+([^,]+)/);
  if (m) {
    return { streetNo: m[1], streetName: m[2].trim() };
  }
  // No leading number — treat whole first-comma-block as street name.
  const first = trimmed.split(",")[0].trim();
  return { streetNo: null, streetName: first };
}

// SG21 code layout: last 10 chars encode "eeeeepppppp" where e = erf number
// (zero-padded), p = portion. "C03900050000449700000" → erf 4497.
function erfFromSg(sg: string | null | undefined): string | null {
  if (!sg) return null;
  const clean = sg.trim();
  if (clean.length < 10) return null;
  const erfPart = clean.slice(-10, -5);
  const n = parseInt(erfPart, 10);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const url = new URL(request.url);
  const address = (url.searchParams.get("address") ?? "").trim();
  if (!address) {
    return NextResponse.json(
      { ok: false, error: "address query required" } satisfies LookupResponse,
      { status: 400 },
    );
  }

  const parsed = parseAddress(address);
  const streetPattern = parsed.streetName
    .toUpperCase()
    .replace(/\s+/g, "%")   // accept "EAGLES WAY" or "EAGLESWAY"
    .replace(/[^A-Z0-9%]/g, "%");

  // Muni data uses ALL CAPS, sometimes packs suburb into the street field
  // ("EAGLESWAY BELVIDERE HEIG"). LIKE with wildcards catches both.
  const whereParts = [`PhysicalSt like '%${streetPattern}%'`];
  if (parsed.streetNo) {
    whereParts.push(`PhysicalStNo = '${parsed.streetNo}'`);
  }
  const where = whereParts.join(" AND ");

  const params = new URLSearchParams({
    where,
    outFields: "ErfNo,SGNumber,PhysicalStNo,PhysicalSt",
    returnGeometry: "false",
    resultRecordCount: "25",
    f: "json",
  });

  try {
    const res = await fetch(`${MUNI_FINANCE}?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Muni HTTP ${res.status}`);
    const data = await res.json();

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const features: any[] = data?.features ?? [];
    const candidates: Candidate[] = features
      .map((f) => {
        const a = f.attributes ?? {};
        const sg = a.SGNumber ? String(a.SGNumber).trim() : "";
        return {
          muniErfCode: a.ErfNo ? String(a.ErfNo).trim() : "",
          erfNumber: erfFromSg(sg) ?? "",
          sgNumber: sg,
          streetNo: a.PhysicalStNo ? String(a.PhysicalStNo).trim() : null,
          streetName: a.PhysicalSt ? String(a.PhysicalSt).trim() : "",
        };
      })
      .filter((c) => c.erfNumber);

    return NextResponse.json({
      ok: true,
      parsed,
      candidates,
    } satisfies LookupResponse);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message } satisfies LookupResponse,
      { status: 502 },
    );
  }
}
