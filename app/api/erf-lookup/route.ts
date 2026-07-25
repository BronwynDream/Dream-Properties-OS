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

// Common SA street-type suffixes. The muni frequently uses abbreviations
// (RD/ST/AVE) where the user types the full word (ROAD/STREET/AVENUE),
// so we strip the suffix from BOTH sides before comparing.
const STREET_TYPE_RE =
  /\s+(ROAD|RD|STREET|ST|AVENUE|AVE|DRIVE|DR|LANE|LN|CLOSE|CL|CRESCENT|CRES|BOULEVARD|BLVD|WAY|PARK|PLACE|PL|SQUARE|SQ|ALLEY|AL|WALK|MEWS|RIDGE|VIEW|HEIGHTS|HTS|COURT|CT|LOOP|CIRCLE|CIR|TERRACE|TER)$/;

// Compact form for fuzzy matching: uppercase, drop everything but letters+digits.
// "Glen View Rd" and "GLENVIEW ROAD" and "glenview rd" all collapse to
// "GLENVIEW" once the suffix is stripped, so all three forms match each other.
function compactName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normaliseStreetSearch(streetName: string): {
  compactFull: string;   // full compacted street name incl. suffix
  compactRoot: string;   // suffix stripped (e.g. "GLENVIEW" from "GLENVIEW ROAD")
  firstWord: string;     // first alphabetic token — safe broad-fetch key
} {
  const clean = streetName.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const withoutSuffix = clean.replace(STREET_TYPE_RE, "").trim() || clean;
  const compactFull = compactName(clean);
  const compactRoot = compactName(withoutSuffix);
  const firstToken = withoutSuffix.split(/\s+/)[0] ?? "";
  return {
    compactFull,
    compactRoot: compactRoot || compactFull,
    firstWord: firstToken.length >= 3 ? firstToken : compactRoot.slice(0, 5),
  };
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
  const { compactFull, compactRoot, firstWord } = normaliseStreetSearch(parsed.streetName);

  // Two parallel broad fetches. The muni's street_name field is inconsistent
  // about word breaks ("GLENVIEW ROAD" vs "GLEN VIEW RD" vs "GLENVIEWRD"),
  // so we cast a wider net than a single ilike could:
  //   (a) contains-first-word — catches "GLENVIEW" written as one token
  //   (b) starts-with-4-letter-prefix — catches "GLEN VIEW" (split tokens)
  // Merge, dedupe, then normalise-score in-process. This makes lookups
  // robust to the muni's naming inconsistencies without needing new indexes.
  const cols =
    "sg_number, erf_number, street_no, street_name, suburb, suburb_hint, muni_valuation, extent_sqm, zoning, title_deed_no";
  const shortPrefix = compactRoot.slice(0, 4);
  const [byWord, byPrefix] = await Promise.all([
    supabase
      .from("muni_property")
      .select(cols)
      .ilike("street_name", `%${firstWord}%`)
      .limit(400),
    shortPrefix.length >= 3
      ? supabase
          .from("muni_property")
          .select(cols)
          .ilike("street_name", `${shortPrefix}%`)
          .limit(300)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (byWord.error) {
    return NextResponse.json(
      { ok: false, error: `local index: ${byWord.error.message}` } satisfies LookupResponse,
      { status: 500 },
    );
  }

  // Merge + dedupe by SG number.
  const seenSg = new Set<string>();
  const merged: NonNullable<typeof byWord.data> = [];
  for (const row of [...(byWord.data ?? []), ...(byPrefix.data ?? [])]) {
    if (!row.sg_number || seenSg.has(row.sg_number)) continue;
    seenSg.add(row.sg_number);
    merged.push(row);
  }

  // Score every row against the compacted target. 100 = exact root match,
  // 80 = target contained in row, 60 = row contained in target, 40 = shared
  // prefix ≥5 chars. Anything below 40 is filtered out.
  const scored = merged
    .map((r) => {
      const rowCompact = compactName(r.street_name ?? "");
      const rowRoot = compactName(
        (r.street_name ?? "").toUpperCase().replace(STREET_TYPE_RE, "").trim(),
      );
      let score = 0;
      if (rowRoot && rowRoot === compactRoot) score = 100;
      else if (rowCompact === compactFull) score = 100;
      else if (rowRoot && compactRoot.includes(rowRoot)) score = 85;
      else if (rowCompact.includes(compactRoot)) score = 80;
      else if (compactRoot.includes(rowRoot) && rowRoot.length >= 4) score = 65;
      else {
        const shared = commonPrefixLen(rowRoot || rowCompact, compactRoot);
        if (shared >= 5) score = 40 + Math.min(20, shared - 5);
      }
      return { r, score };
    })
    .filter((x) => x.score >= 40)
    .sort((a, b) => b.score - a.score);

  const candidates: Candidate[] = scored.slice(0, 50).map(({ r }) => ({
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

  // Rank exact-street-number matches first within the candidate pool.
  if (parsed.streetNo) {
    candidates.sort((a, b) => {
      const am = a.streetNo === parsed.streetNo ? 0 : 1;
      const bm = b.streetNo === parsed.streetNo ? 0 : 1;
      return am - bm;
    });
  }

  return NextResponse.json({ ok: true, parsed, candidates } satisfies LookupResponse);
}

function commonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}
