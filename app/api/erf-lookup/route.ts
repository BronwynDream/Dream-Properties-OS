import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 15;

// Address → ERF lookup via the LOCAL muni_property mirror (populated by
// /api/muni/import). Fast, offline-tolerant, coherent with the rest of
// the OS. Falls back gracefully if the local table hasn't been populated
// yet ("no matches" + hint about running the import).
//
// GET /api/erf-lookup?address=12+Eagles+Way

type Candidate = {
  sgNumber: string;
  erfNumber: string;
  streetNo: string | null;
  streetName: string;
  suburb: string | null;
  suburbHint: string | null;
  muniValuation: number | null;
  extentSqm: number | null;
  zoning: string | null;
  titleDeedNo: string | null;
};

type LookupResponse = {
  ok: boolean;
  candidates?: Candidate[];
  parsed?: { streetNo: string | null; streetName: string };
  error?: string;
};

function parseAddress(address: string): { streetNo: string | null; streetName: string } {
  const trimmed = address.trim();
  const m = trimmed.match(/^(\d+[A-Za-z]?)\s+([^,]+)/);
  if (m) return { streetNo: m[1], streetName: m[2].trim() };
  const first = trimmed.split(",")[0].trim();
  return { streetNo: null, streetName: first };
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

  // Fuzzy street match via trigram (index built in migration 0040).
  // Case-insensitive. Muni data is uppercase; normalise both sides.
  const streetSearch = parsed.streetName.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim();

  const { data, error } = await supabase
    .from("muni_property")
    .select(
      "sg_number, erf_number, street_no, street_name, suburb, suburb_hint, muni_valuation, extent_sqm, zoning, title_deed_no",
    )
    .ilike("street_name", `%${streetSearch.replace(/\s+/g, "%")}%`)
    .limit(50);

  if (error) {
    return NextResponse.json(
      { ok: false, error: `local index: ${error.message}` } satisfies LookupResponse,
      { status: 500 },
    );
  }

  const candidates: Candidate[] = (data ?? []).map((r) => ({
    sgNumber: r.sg_number,
    erfNumber: r.erf_number ?? "",
    streetNo: r.street_no,
    streetName: r.street_name ?? "",
    suburb: r.suburb,
    suburbHint: r.suburb_hint,
    muniValuation: r.muni_valuation != null ? Number(r.muni_valuation) : null,
    extentSqm: r.extent_sqm,
    zoning: r.zoning,
    titleDeedNo: r.title_deed_no,
  }));

  // Rank exact-street-number matches first.
  if (parsed.streetNo) {
    candidates.sort((a, b) => {
      const am = a.streetNo === parsed.streetNo ? 0 : 1;
      const bm = b.streetNo === parsed.streetNo ? 0 : 1;
      return am - bm;
    });
  }

  return NextResponse.json({ ok: true, parsed, candidates } satisfies LookupResponse);
}
