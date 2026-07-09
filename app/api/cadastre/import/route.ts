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
// Raised from 22s so a slow-but-eventually-successful page doesn't abort
// pointlessly. Still inside TIME_BUDGET_MS with room for the response
// parse + upsert.
const CSG_TIMEOUT_MS = 35_000;

// Kept small so unsimplified geometry pages still fit inside the timeout.
// DFFE rejects the geometry-simplification params (geometryPrecision,
// maxAllowableOffset) with HTTP 400 "Failed to execute query", so we have
// to page smaller instead of shipping smaller polygons.
const PAGE_SIZE = 200;

// Timeout retries cross batches — persisted on the cursor as
// consecutive_fail. When it reaches this many, we advance anyway.
const MAX_TIMEOUT_RETRIES = 3;

// Distinct-value discovery runs one query per keyword and unions the exact
// MAJ_REGION labels the service actually holds. A single query with several
// ORed LIKE clauses returns empty on the DFFE portal (confirmed live), so
// per-keyword is the reliable shape.
//
// Order matters: KNYSNA first so Dream's core area imports before the big
// slow towns. If the whole run is aborted (Vercel kill / network wobble),
// the parcels Bronwyn actually needs are already in.
const TOWN_KEYWORDS = [
  "KNYSNA",
  "SEDGEFIELD",
  "PLETTENBERG BAY",
  "GEORGE",
];

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

    // 0. ?reset=1 wipes the cursor before we look at it. Lets the admin
    //    force a clean run when the previous cursor is stale — for
    //    example after a failed town-discovery that only landed empty
    //    labels, or after CSG updates their parcel set.
    const reqUrl = new URL(request.url);
    const wantsReset = reqUrl.searchParams.get("reset") === "1";
    if (wantsReset) {
      const { error: resetErr } = await service
        .from("cadastral_import_cursor")
        .update({
          town_labels: [],
          town_index: 0,
          offset_in_town: 0,
          total_imported: 0,
          last_ran_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (resetErr) {
        return NextResponse.json(
          { ok: false, error: `cursor reset failed: ${resetErr.message}` },
          { status: 500 },
        );
      }
    }

    // 1. Load cursor.
    const { data: cursorRow, error: cErr } = await service
      .from("cadastral_import_cursor")
      .select("town_labels, town_index, offset_in_town, total_imported, consecutive_fail")
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
    let consecutiveFail: number = Number((cursorRow as any).consecutive_fail) || 0;

    async function persistCursor(): Promise<string | null> {
      const { error: perr } = await service
        .from("cadastral_import_cursor")
        .update({
          town_index: townIndex,
          offset_in_town: offset,
          total_imported: totalSoFar,
          consecutive_fail: consecutiveFail,
          last_ran_at: new Date().toISOString(),
        })
        .eq("id", true);
      return perr ? perr.message : null;
    }

    const errors: string[] = [];
    let importedThisRun = 0;

    // 2. Discover town labels on first run.
    if (townLabels.length === 0) {
      let labels: string[];
      try {
        labels = await discoverTownLabels();
      } catch (e) {
        return NextResponse.json(
          { ok: false, error: `town discovery failed: ${(e as Error).message}` },
          { status: 502 },
        );
      }
      // Empty result means the CSG service accepted our query but returned
      // no MAJ_REGION strings — a genuine failure, not a completed import.
      // Refuse to write a done-looking cursor so the failure is loud.
      if (labels.length === 0) {
        return NextResponse.json(
          { ok: false, error: "CSG town discovery returned no labels" },
          { status: 502 },
        );
      }
      townLabels = labels;
      townIndex = 0;
      offset = 0;
      const { error: labelWriteErr } = await service
        .from("cadastral_import_cursor")
        .update({
          town_labels: townLabels,
          town_index: 0,
          offset_in_town: 0,
          last_ran_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (labelWriteErr) {
        // If we can't persist the discovered labels, every subsequent batch
        // will re-run discovery (~30–50s each) and never advance. Fail loud.
        return NextResponse.json(
          {
            ok: false,
            error: `cursor label write failed: ${labelWriteErr.message}`,
            discoveredLabels: townLabels,
          },
          { status: 500 },
        );
      }
    }

    // 3. Loop through towns paging by PAGE_SIZE until the time budget is exhausted.
    while (townIndex < townLabels.length) {
      if (Date.now() - start > TIME_BUDGET_MS) break;

      const town = townLabels[townIndex];
      // Paging query. IMPORTANT: DFFE's layer 400s on `f=geojson`
      // combined with `returnGeometry=true` — confirmed live. `f=json`
      // (native ESRI shape) works fine with the same paging, so we
      // fetch as ESRI JSON and convert rings → GeoJSON below before
      // handing the polygon to upsert_parcel. Everything else matches
      // Bronwyn's confirmed-working curl exactly.
      const url =
        CSG_BASE +
        "?" +
        new URLSearchParams({
          where: `MAJ_REGION='${town.replace(/'/g, "''")}'`,
          outFields: "PRCL_KEY,TAG_VALUE",
          returnGeometry: "true",
          outSR: "4326",
          f: "json",
          resultRecordCount: String(PAGE_SIZE),
          resultOffset: String(offset),
        }).toString();

      // Single attempt per page. Three failure modes, three behaviours:
      //   - AbortError (timeout)                → cross-batch retry via
      //                                            consecutive_fail on cursor;
      //                                            skip forward only after 3
      //   - HTTP 4xx/5xx                        → skip forward immediately
      //   - HTTP 200 with ArcGIS error envelope → skip forward immediately
      let payload: any = null;
      let errorKind: "timeout" | "http" | "arcgis" | null = null;
      let errorMsg: string | null = null;
      try {
        const res = await fetchWithTimeout(url, CSG_TIMEOUT_MS);
        if (!res.ok) {
          errorKind = "http";
          errorMsg = `HTTP ${res.status} · URL: ${url}`;
        } else {
          const raw = await res.json();
          if (raw && typeof raw === "object" && raw.error) {
            const e = raw.error;
            errorKind = "arcgis";
            // ArcGIS's error.details is an array of specific complaints
            // ("Cannot perform query. Invalid query parameters." etc).
            // That's what tells us which param DFFE is rejecting — surface
            // it verbatim along with the URL so we can reproduce.
            const detailsStr = Array.isArray(e?.details)
              ? ` · details: ${JSON.stringify(e.details).slice(0, 300)}`
              : e?.details
                ? ` · details: ${String(e.details).slice(0, 300)}`
                : "";
            errorMsg =
              typeof e === "object"
                ? `CSG error ${e.code ?? "?"}: ${e.message ?? "unknown"}${detailsStr} · URL: ${url}`
                : `CSG error ${String(e)} · URL: ${url}`;
          } else {
            payload = raw;
          }
        }
      } catch (e) {
        const err = e as Error;
        // AbortController.abort() raises DOMException with name AbortError.
        // Some Node versions surface it via the message; be tolerant.
        const isTimeout =
          err.name === "AbortError" || /abort/i.test(err.message ?? "");
        errorKind = isTimeout ? "timeout" : "http";
        errorMsg = err.message ?? String(err);
      }

      // --- Timeout: cross-batch retry via consecutive_fail. ------------
      if (errorKind === "timeout") {
        consecutiveFail += 1;
        if (consecutiveFail >= MAX_TIMEOUT_RETRIES) {
          // Give up on this page — advance forward and clear the counter.
          const before = { townIndex, offset };
          if (offset === 0) {
            townIndex++;
            offset = 0;
          } else {
            offset += PAGE_SIZE;
          }
          consecutiveFail = 0;
          errors.push(
            `${town}@${before.offset}: timeout after ${MAX_TIMEOUT_RETRIES} tries · advanced to ${townIndex >= townLabels.length ? "END" : `${townLabels[townIndex]}@${offset}`}`,
          );
          const persistErr = await persistCursor();
          if (persistErr) {
            errors.push(`cursor advance failed: ${persistErr}`);
            break;
          }
          continue;
        }
        // Still under the retry threshold — persist the fail count and let
        // the next batch call try the same offset.
        errors.push(
          `${town}@${offset}: timeout ${consecutiveFail}/${MAX_TIMEOUT_RETRIES} · will retry next batch`,
        );
        const persistErr = await persistCursor();
        if (persistErr) {
          errors.push(`cursor timeout-persist failed: ${persistErr}`);
        }
        break;
      }

      // --- HTTP / ArcGIS error: skip forward immediately, reset counter. ---
      if (errorKind === "http" || errorKind === "arcgis") {
        const before = { townIndex, offset };
        if (offset === 0) {
          townIndex++;
          offset = 0;
        } else {
          offset += PAGE_SIZE;
        }
        consecutiveFail = 0;
        errors.push(
          `${town}@${before.offset}: ${errorMsg} · advanced to ${townIndex >= townLabels.length ? "END" : `${townLabels[townIndex]}@${offset}`}`,
        );
        const persistErr = await persistCursor();
        if (persistErr) {
          errors.push(`cursor advance failed: ${persistErr}`);
          break;
        }
        continue;
      }

      // --- Success: clear consecutive_fail if it was set. ------------------
      if (consecutiveFail !== 0) consecutiveFail = 0;

      const features: any[] = Array.isArray(payload?.features) ? payload.features : [];

      // Empty first page: log the URL + payload snippet for diagnosis, then
      // skip the town rather than looping (per fail-forward rule).
      if (features.length === 0 && offset === 0) {
        const snippet = JSON.stringify(payload ?? {}, null, 0).slice(0, 400);
        errors.push(
          `${town}@${offset}: 0 features on first page. URL: ${url} · payload keys: ${Object.keys(payload ?? {}).join(",")} · snippet: ${snippet}`,
        );
        townIndex++;
        offset = 0;
        const persistErr = await persistCursor();
        if (persistErr) {
          errors.push(`cursor advance failed: ${persistErr}`);
          break;
        }
        continue;
      }
      for (const f of features) {
        // ESRI JSON shape: features[i] = { attributes, geometry: { rings } }
        const attrs = (f?.attributes ?? {}) as Record<string, any>;
        const prcl_key = String(attrs.PRCL_KEY ?? "").trim();
        if (!prcl_key || !f?.geometry) continue;

        // Convert ESRI rings → GeoJSON. First ring is the outer boundary,
        // subsequent rings are holes (Esri convention: outer clockwise,
        // holes counter-clockwise). We wrap it as a MultiPolygon so the
        // upsert's ST_Multi() is a no-op and geom column stays consistent.
        const rings = (f.geometry as { rings?: number[][][] })?.rings;
        if (!Array.isArray(rings) || rings.length === 0) continue;
        const geomJson = {
          type: "MultiPolygon",
          coordinates: [rings],
        };

        // We only pull PRCL_KEY + TAG_VALUE from CSG (the layer 400s on
        // any other outField). maj_region comes from the local loop
        // variable — we already know it because that's what we queried
        // by. min_region + parcel_no + province stay null until we
        // find field spellings the service will accept.
        const { error: upErr } = await service.rpc("upsert_parcel", {
          p_prcl_key: prcl_key,
          p_parcel_no: null,
          p_tag_value: attrs.TAG_VALUE ?? null,
          p_maj_region: town,
          p_min_region: null,
          p_province: null,
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
      if (features.length < PAGE_SIZE) {
        townIndex++;
        offset = 0;
      } else {
        offset += PAGE_SIZE;
      }
      const persistErr2 = await persistCursor();
      if (persistErr2) {
        // If the cursor can't advance, every batch will replay the same page
        // — the "batch 17 · 0 erven" false-progress state. Bail loud instead.
        errors.push(`cursor advance failed: ${persistErr2}`);
        break;
      }
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
      // Surface the discovered labels so a false-empty run is diagnosable
      // from the client — you can eyeball whether the labels look right.
      discoveredLabels: townLabels,
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
// Discover exact town labels (MAJ_REGION strings) — one distinct query per
// keyword. The DFFE portal rejects a single query with several ORed LIKE
// clauses (returns an empty feature list), so we page over TOWN_KEYWORDS
// and union the labels each keyword yields.
//
// returnGeometry=false is mandatory or the service refuses DISTINCT.
// -----------------------------------------------------------------------------
async function discoverTownLabels(): Promise<string[]> {
  // Preserve keyword order in the returned array — KNYSNA's labels first,
  // then SEDGEFIELD, then PLETTENBERG BAY, then GEORGE. An alphabetical
  // sort would put GEORGE before KNYSNA, which is exactly what we don't
  // want on a run that might get aborted midway.
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const keyword of TOWN_KEYWORDS) {
    const url =
      CSG_BASE +
      "?" +
      new URLSearchParams({
        returnDistinctValues: "true",
        outFields: "MAJ_REGION",
        where: `MAJ_REGION LIKE '%${keyword.replace(/'/g, "''")}%'`,
        returnGeometry: "false",
        f: "json",
      }).toString();

    let res: Response;
    try {
      res = await fetchWithTimeout(url, CSG_TIMEOUT_MS);
    } catch (e) {
      // A single keyword timing out shouldn't take the whole discovery
      // down — keep going, we'll union what other keywords return.
      // eslint-disable-next-line no-console
      console.warn(`[cadastre] discovery(${keyword}) fetch: ${(e as Error).message}`);
      continue;
    }
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[cadastre] discovery(${keyword}) HTTP ${res.status}`);
      continue;
    }
    let json: { features?: { attributes?: Record<string, string> }[] };
    try {
      json = await res.json();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[cadastre] discovery(${keyword}) parse: ${(e as Error).message}`);
      continue;
    }
    for (const f of json.features ?? []) {
      const label = f?.attributes?.MAJ_REGION;
      if (typeof label === "string" && label.trim().length > 0) {
        const l = label.trim();
        if (!seen.has(l)) {
          seen.add(l);
          ordered.push(l);
        }
      }
    }
  }

  return ordered;
}
