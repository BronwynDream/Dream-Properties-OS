import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
// Hobby cap. The CSG service is slow — we run bounded batches per invocation
// and store the cursor so a follow-up call resumes exactly where we stopped.
export const maxDuration = 60;

// GET/POST /api/cadastre/import
//
// Resumable Garden Route cadastre importer.
// Auth: admin session OR Authorization: Bearer $CRON_SECRET.
//
// Data source: CSG (Chief Surveyor General) via the DFFE portal ArcGIS
// service. First run discovers exact town labels; each subsequent run pages
// through the erven for the Garden Route towns 1000 at a time.
//
// Every invocation returns:
//   { done, importedThisRun, totalSoFar, cursor: { town, townIndex, townTotal, offset }, errors }
// The admin (or a cron) keeps calling until done: true.

const CSG_BASE =
  "https://dffeportal.environment.gov.za/hosting/rest/services/CSG_Cadaster/CSG_Cadastral_Data/MapServer/2/query";
const UA = "DreamOS/1.0 (+dreamproperties.app)";

// Reserve ~10s of the 60s cap for the wrap-up cursor write + response. That
// still leaves ~48s for CSG paging, which handles ~4–6 pages of 1000 rows
// per invocation depending on how quickly CSG responds.
const TIME_BUDGET_MS = 48_000;
const CSG_TIMEOUT_MS = 22_000;

// Bounded per-fetch timeout so a slow CSG call can't burn the whole budget.
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ac.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Auth
// -----------------------------------------------------------------------------
async function authorised(request: Request): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (secret && bearer && constantTimeEq(bearer, secret)) return { ok: true };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from("app_user")
      .select("role, active")
      .eq("id", user.id)
      .single();
    if (profile?.role === "admin" && profile.active !== false) return { ok: true };
    return { ok: false, status: 403, error: "admin only" };
  }
  return { ok: false, status: 401, error: "unauthorised" };
}

function constantTimeEq(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// -----------------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------------
export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function run(request: Request) {
  const gate = await authorised(request);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const service = createServiceClient();
    const start = Date.now();

    // 1. Load cursor.
    const { data: cursorRow, error: cErr } = await service
      .from("cadastral_import_cursor")
      .select("town_labels, town_index, offset_in_town, total_imported")
      .eq("id", true)
      .maybeSingle();
    if (cErr || !cursorRow) {
      return NextResponse.json(
        { ok: false, error: `cursor read failed: ${cErr?.message ?? "no row"}` },
        { status: 500 },
      );
    }
    let townLabels: string[] = Array.isArray(cursorRow.town_labels) ? cursorRow.town_labels : [];
    let townIndex: number = Number(cursorRow.town_index) || 0;
    let offset: number = Number(cursorRow.offset_in_town) || 0;
    let totalSoFar: number = Number(cursorRow.total_imported) || 0;

    const errors: string[] = [];
    let importedThisRun = 0;

    // 2. Discover town labels on first run.
    if (townLabels.length === 0) {
      try {
        const labels = await discoverTownLabels();
        townLabels = labels;
        townIndex = 0;
        offset = 0;
        await service
          .from("cadastral_import_cursor")
          .update({
            town_labels: townLabels,
            town_index: 0,
            offset_in_town: 0,
            last_ran_at: new Date().toISOString(),
          })
          .eq("id", true);
      } catch (e) {
        return NextResponse.json(
          { ok: false, error: `town discovery failed: ${(e as Error).message}` },
          { status: 502 },
        );
      }
    }

    // 3. Loop through towns paging by 1000 until the time budget is exhausted.
    while (townIndex < townLabels.length) {
      if (Date.now() - start > TIME_BUDGET_MS) break;

      const town = townLabels[townIndex];
      const url =
        CSG_BASE +
        "?" +
        new URLSearchParams({
          where: `MAJ_REGION = '${town.replace(/'/g, "''")}'`,
          outFields: "PARCEL_NO,TAG_VALUE,MAJ_REGION,MIN_REGION,PROVINCE,PRCL_KEY",
          returnGeometry: "true",
          outSR: "4326",
          f: "geojson",
          resultRecordCount: "1000",
          resultOffset: String(offset),
        }).toString();

      let payload: any = null;
      try {
        const res = await fetchWithTimeout(url, CSG_TIMEOUT_MS);
        if (!res.ok) {
          errors.push(`${town}@${offset}: HTTP ${res.status}`);
          break;
        }
        payload = await res.json();
      } catch (e) {
        errors.push(`${town}@${offset}: ${(e as Error).message}`);
        break;
      }

      const features: any[] = Array.isArray(payload?.features) ? payload.features : [];
      for (const f of features) {
        const props = (f?.properties ?? {}) as Record<string, any>;
        const prcl_key = String(props.PRCL_KEY ?? "").trim();
        if (!prcl_key || !f?.geometry) continue;

        // Polygon → MultiPolygon so the geom column type stays consistent.
        let geomJson = f.geometry;
        if (geomJson.type === "Polygon") {
          geomJson = { type: "MultiPolygon", coordinates: [geomJson.coordinates] };
        } else if (geomJson.type !== "MultiPolygon") {
          continue;
        }

        const { error: upErr } = await service.rpc("upsert_parcel", {
          p_prcl_key: prcl_key,
          p_parcel_no: props.PARCEL_NO ?? null,
          p_tag_value: props.TAG_VALUE ?? null,
          p_maj_region: props.MAJ_REGION ?? null,
          p_min_region: props.MIN_REGION ?? null,
          p_province: props.PROVINCE ?? null,
          p_geom_json: JSON.stringify(geomJson),
        });
        if (upErr) {
          errors.push(`upsert ${prcl_key}: ${upErr.message}`);
        } else {
          importedThisRun++;
        }
      }
      totalSoFar += features.length;

      // Advance the cursor. Persist per-town so a mid-town abort is safe.
      if (features.length < 1000) {
        townIndex++;
        offset = 0;
      } else {
        offset += 1000;
      }
      await service
        .from("cadastral_import_cursor")
        .update({
          town_index: townIndex,
          offset_in_town: offset,
          total_imported: totalSoFar,
          last_ran_at: new Date().toISOString(),
        })
        .eq("id", true);
    }

    const done = townIndex >= townLabels.length;

    // On completion, run the erf-snap so records with coords + no manual
    // override land on their real parcel centroid + carry the prcl_key.
    // Failure here is non-fatal — the caller can rerun /api/cadastre/snap.
    let snapped: { propertiesSnapped: number; listingsSnapped: number } | null = null;
    if (done) {
      try {
        const { data: snapData, error: snapErr } = await service.rpc(
          "snap_all_to_parcels",
        );
        if (snapErr) {
          errors.push(`snap failed: ${snapErr.message}`);
        } else {
          const row = Array.isArray(snapData) ? snapData[0] : snapData;
          snapped = {
            propertiesSnapped: Number(row?.properties_snapped ?? 0),
            listingsSnapped: Number(row?.listings_snapped ?? 0),
          };
        }
      } catch (e) {
        errors.push(`snap threw: ${(e as Error).message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      done,
      importedThisRun,
      totalSoFar,
      // Top-level cursor fields so the admin UI can render them without
      // destructuring the nested object.
      town: townLabels[townIndex] ?? null,
      offset,
      cursor: {
        town: townLabels[townIndex] ?? null,
        townIndex,
        townTotal: townLabels.length,
        offset,
      },
      snapped,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message ?? String(e) },
      { status: 500 },
    );
  }
}

// -----------------------------------------------------------------------------
// Discover exact town labels (MAJ_REGION strings). CSG stores towns as
// uppercase names; the wildcard match catches variants like "PLETT" vs
// "PLETTENBERG BAY" so we import whichever the service actually holds.
// -----------------------------------------------------------------------------
async function discoverTownLabels(): Promise<string[]> {
  const url =
    CSG_BASE +
    "?" +
    new URLSearchParams({
      returnDistinctValues: "true",
      outFields: "MAJ_REGION",
      where:
        "MAJ_REGION LIKE '%KNYSNA%' OR MAJ_REGION LIKE '%SEDGEFIELD%' OR MAJ_REGION LIKE '%PLETT%' OR MAJ_REGION LIKE '%GEORGE%'",
      returnGeometry: "false",
      f: "json",
    }).toString();

  const res = await fetchWithTimeout(url, CSG_TIMEOUT_MS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    features?: { attributes?: Record<string, string> }[];
  };
  const set = new Set<string>();
  for (const f of json.features ?? []) {
    const label = f?.attributes?.MAJ_REGION;
    if (typeof label === "string" && label.trim().length > 0) set.add(label.trim());
  }
  return Array.from(set).sort();
}
