import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/muni/import
//
// Pages through Knysna Municipality's public ArcGIS layers and upserts
// into muni_property (keyed by SG21). Admin-only. Idempotent — safe to
// re-run any time; new rows overwrite by primary key.
//
// Three passes, each upserts the columns it's responsible for:
//   Layer 57 (Finance System)   → address, zoning, ward, sect-title flag
//   Layer 58 (Valuation Roll)   → suburb, tariff, valuation, area
//   Layer 56 (Ownership Deeds)  → extent, title deed, sect scheme, purchase history
//
// Owner names, ID numbers, phone, email are DELIBERATELY NEVER requested.
// outFields on every query is an explicit allow-list.

/* eslint-disable @typescript-eslint/no-explicit-any */

const MUNI_HOST =
  "https://services3.arcgis.com/Kb9idbuOS9ILjfGd/arcgis/rest/services/Property_Ownership_Deeds_Test/FeatureServer";
const PAGE_SIZE = 2000;

async function fetchPage(
  layer: number,
  outFields: string,
  offset: number,
): Promise<any[]> {
  const params = new URLSearchParams({
    where: "1=1",
    outFields,
    returnGeometry: "false",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: "OBJECTID",
    f: "json",
  });
  const res = await fetch(`${MUNI_HOST}/${layer}/query?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Layer ${layer} HTTP ${res.status}`);
  const data = await res.json();
  return (data?.features ?? []).map((f: any) => f.attributes ?? {});
}

async function fetchAll(layer: number, outFields: string): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const page = await fetchPage(layer, outFields, offset);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (offset > 200_000) break; // safety cap
  }
  return all;
}

function erfFromSg(sg: string | null | undefined): string | null {
  if (!sg) return null;
  const clean = String(sg).trim();
  if (clean.length < 10) return null;
  const erfPart = clean.slice(-10, -5);
  const n = parseInt(erfPart, 10);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

function safeInt(v: any): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}
function safeNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function safeStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
function safeDate(v: any): string | null {
  if (v == null || v === "") return null;
  // ArcGIS dates come as unix millis
  const ms = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

// Split "EAGLESWAY BELVIDERE HEIG" into street + suburb hint. Anything after
// the first two "words" (or the entire trailing chunk with a known suburb
// marker) is the suburb hint. Heuristic — the muni doesn't structure it.
function splitStreetSuburb(raw: string | null): {
  street: string | null;
  hint: string | null;
} {
  if (!raw) return { street: null, hint: null };
  const parts = raw.trim().split(/\s+/);
  if (parts.length <= 2) return { street: raw.trim(), hint: null };
  // Look for a suburb marker (HEIG, HEIGHTS, ISLAND, PARK, TOWN, EXT, etc.)
  const markers = /^(HEIG|HEIGHTS?|ISLAND|PARK|BAY|POINT|EXT|EXTENSION|VILLAGE|ESTATE|CENTRAL|WEST|EAST|NORTH|SOUTH)$/i;
  for (let i = 1; i < parts.length; i++) {
    if (markers.test(parts[i])) {
      return {
        street: parts.slice(0, i).join(" "),
        hint: parts.slice(i - 1 >= 1 ? i - 1 : i).join(" "),
      };
    }
  }
  return { street: raw.trim(), hint: null };
}

// Auth: admin session cookie OR Authorization: Bearer $CRON_SECRET.
async function authorised(request: Request): Promise<boolean> {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (secret && bearer === secret) return true;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  return profile?.role === "admin" && profile?.active !== false;
}

async function runImport(request: Request) {
  if (!(await authorised(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const startedAt = Date.now();
  const counts = { finance: 0, valroll: 0, deeds: 0 };

  try {
    // --- Pass 1: Finance System (57) — address, zoning, ward, sect flag ---
    const finance = await fetchAll(
      57,
      "SGNumber,ErfNo,PhysicalSt,PhysicalStNo,Zoning,Area,WardNo,SectionalTitle,Usage_,PropertyDescription",
    );
    const financeRows = dedupeBySg(
      finance
        .filter((r) => safeStr(r.SGNumber))
        .map((r) => {
          const split = splitStreetSuburb(safeStr(r.PhysicalSt));
          return {
            sg_number: String(r.SGNumber).trim(),
            erf_number: erfFromSg(String(r.SGNumber)),
            muni_erf_code: safeStr(r.ErfNo),
            street_no: safeStr(r.PhysicalStNo),
            street_name: split.street,
            suburb_hint: split.hint,
            zoning: safeStr(r.Zoning),
            ward_no: safeStr(r.WardNo),
            sectional_title_flag: safeStr(r.SectionalTitle),
            usage_: safeStr(r.Usage_),
            prop_description: safeStr(r.PropertyDescription),
            refreshed_at: new Date().toISOString(),
          };
        }),
    );
    for (const chunk of chunks(financeRows, 500)) {
      const { error, count } = await service
        .from("muni_property")
        .upsert(chunk, { onConflict: "sg_number", count: "exact" });
      if (error) throw new Error(`finance upsert: ${error.message}`);
      counts.finance += count ?? chunk.length;
    }

    // --- Pass 2: Valuation Roll (58) — suburb (structured!), tariff, valuation ---
    const valroll = await fetchAll(58, "SG_NUMBER,SUBURB,TARIFF,AREA,VALUATION,ERF__");
    const valrollRows = dedupeBySg(
      valroll
        .filter((r) => safeStr(r.SG_NUMBER))
        .map((r) => ({
          sg_number: String(r.SG_NUMBER).trim(),
          erf_number: safeStr(r.ERF__) ?? erfFromSg(String(r.SG_NUMBER)),
          suburb: safeStr(r.SUBURB),
          tariff: safeStr(r.TARIFF),
          area_sqm_valroll: safeInt(r.AREA),
          muni_valuation: safeNum(r.VALUATION),
          refreshed_at: new Date().toISOString(),
        })),
    );
    for (const chunk of chunks(valrollRows, 500)) {
      const { error, count } = await service
        .from("muni_property")
        .upsert(chunk, { onConflict: "sg_number", count: "exact" });
      if (error) throw new Error(`valroll upsert: ${error.message}`);
      counts.valroll += count ?? chunk.length;
    }

    // --- Pass 3: Ownership Deeds (56) — extent, title deed, sect scheme, purchase ---
    // WARNING: this layer has PII fields (Buyer_name, Seller_name, IDs).
    // Our outFields is an ALLOW-LIST — never request them.
    // Deeds are naturally multi-per-property (multiple sales over time). We
    // sort by registration/purchase date so dedupeBySg keeps the latest.
    const deeds = await fetchAll(
      56,
      "SG21CODE,LPI,TOWNNAME,ERF,PORTION,EXTENT_SQM,Property_Type,SECT_SCHEME_NAME,UNIT,Title_Deed_No,OLD_TITLE_DEED_NO,DeedOffice,Purch_Date,Registration_Date,Purch_Price,BOND_NUMBER,BOND_AMOUNT,INSTITUTION",
    );
    const deedsRows = dedupeBySg(
      deeds
        .filter((r) => safeStr(r.SG21CODE) || safeStr(r.LPI))
        .sort((a, b) => {
          // Ascending — later entries win in dedupeBySg (Map.set overwrites).
          const ad = a.Registration_Date ?? a.Purch_Date ?? 0;
          const bd = b.Registration_Date ?? b.Purch_Date ?? 0;
          return (ad as number) - (bd as number);
        })
        .map((r) => {
          const sg = safeStr(r.SG21CODE) ?? safeStr(r.LPI)!;
          return {
            sg_number: sg,
            erf_number: safeStr(r.ERF) ?? erfFromSg(sg),
            town_name: safeStr(r.TOWNNAME),
            extent_sqm: safeInt(r.EXTENT_SQM),
            property_type: safeStr(r.Property_Type),
            sect_scheme_name: safeStr(r.SECT_SCHEME_NAME),
            sect_scheme_unit: safeInt(r.UNIT),
            title_deed_no: safeStr(r.Title_Deed_No),
            old_title_deed_no: safeStr(r.OLD_TITLE_DEED_NO),
            deeds_office: safeStr(r.DeedOffice),
            purch_date: safeDate(r.Purch_Date),
            registration_date: safeDate(r.Registration_Date),
            purch_price: safeNum(r.Purch_Price),
            bond_number: safeStr(r.BOND_NUMBER),
            bond_amount: safeNum(r.BOND_AMOUNT),
            bond_institution: safeStr(r.INSTITUTION),
            refreshed_at: new Date().toISOString(),
          };
        }),
    );
    for (const chunk of chunks(deedsRows, 500)) {
      const { error, count } = await service
        .from("muni_property")
        .upsert(chunk, { onConflict: "sg_number", count: "exact" });
      if (error) throw new Error(`deeds upsert: ${error.message}`);
      counts.deeds += count ?? chunk.length;
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    return NextResponse.json({
      ok: true,
      elapsedSec: elapsed,
      counts,
      total: finance.length + valroll.length + deeds.length,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message, counts },
      { status: 500 },
    );
  }
}

// Exported handlers — POST for the manual admin button, GET for Vercel Cron
// (Vercel Cron only issues GET). Both go through the same authorised()
// path; cron auths via CRON_SECRET bearer, admin via session cookie.
export async function POST(request: Request) {
  return runImport(request);
}
export async function GET(request: Request) {
  return runImport(request);
}

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

// Dedupe rows by sg_number keeping the LAST occurrence. The muni's Valuation
// Roll layer contains multiple entries per SG21 for some properties (rated
// revisions, sectional-scheme units sharing an SG). Postgres won't allow an
// upsert to touch the same row twice in one statement, so we collapse
// duplicates client-side. Later rows win by insertion order.
function dedupeBySg<T extends { sg_number: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    if (!r.sg_number) continue;
    map.set(r.sg_number, r);
  }
  return Array.from(map.values());
}
