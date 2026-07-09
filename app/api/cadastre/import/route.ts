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

// George's parcel geometries are particularly dense and busted the 22s CSG
// timeout at 500. 250 keeps every response comfortably inside it. The
// resumable cursor absorbs the extra pages.
const PAGE_SIZE = 250;
// Max retries on a single paging fetch before we fail-forward the cursor.
// Two retries = up to three total attempts per page.
const PAGE_MAX_RETRIES = 2;

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
      // Use LIKE with a wildcard suffix rather than =. Discovery returns the
      // stored MAJ_REGION string verbatim, but the DFFE service tolerates
      // trailing whitespace / suffix variants on paging queries only via LIKE.
      // A single ' is escaped as '' per Postgres/OGC style.
      const url =
        CSG_BASE +
        "?" +
        new URLSearchParams({
          where: `MAJ_REGION LIKE '${town.replace(/'/g, "''")}%'`,
          outFields: "PARCEL_NO,TAG_VALUE,MAJ_REGION,MIN_REGION,PROVINCE,PRCL_KEY",
          returnGeometry: "true",
          outSR: "4326",
          f: "geojson",
          // orderByFields makes resultOffset paging deterministic. Without it,
          // some ArcGIS servers return the same first page repeatedly or drop
          // rows across pages. PRCL_KEY is unique so this is a stable sort.
          orderByFields: "PRCL_KEY",
          resultRecordCount: String(PAGE_SIZE),
          resultOffset: String(offset),
        }).toString();

      // Retry up to PAGE_MAX_RETRIES times, then FAIL FORWARD — advance the
      // cursor and log a warning so the auto-loop can't dead-lock on a
      // slow / broken town. Two failure modes handled the same way:
      //   - fetch throws / non-2xx  → log HTTP status / thrown message
      //   - HTTP 200 with ArcGIS error object → log code + message
      let payload: any = null;
      let fetchError: string | null = null;
      for (let attempt = 0; attempt <= PAGE_MAX_RETRIES; attempt++) {
        try {
          const res = await fetchWithTimeout(url, CSG_TIMEOUT_MS);
          if (!res.ok) {
            fetchError = `HTTP ${res.status}`;
            payload = null;
            continue;
          }
          const raw = await res.json();
          if (raw && typeof raw === "object" && raw.error) {
            const e = raw.error;
            fetchError =
              typeof e === "object"
                ? `CSG error ${e.code ?? "?"}: ${e.message ?? "unknown"}`
                : `CSG error ${String(e)}`;
            payload = null;
            continue;
          }
          payload = raw;
          fetchError = null;
          break;
        } catch (e) {
          fetchError = (e as Error).message;
          payload = null;
        }
      }

      if (fetchError || payload == null) {
        // Fail forward: never return with the cursor unchanged. If the first
        // page failed, skip the whole town (chances are the label itself is
        // bad / the town is broken for us). If a later page failed, skip
        // just that page — the town might have more parcels waiting.
        const before = { townIndex, offset };
        if (offset === 0) {
          townIndex++;
          offset = 0;
        } else {
          offset += PAGE_SIZE;
        }
        errors.push(
          `${town}@${before.offset}: ${fetchError ?? "no payload"} after ${PAGE_MAX_RETRIES + 1} attempts · advanced to ${townIndex >= townLabels.length ? "END" : `${townLabels[townIndex]}@${offset}`}`,
        );
        // Persist the advance so the next batch doesn't retry the same offset.
        const { error: persistErr } = await service
          .from("cadastral_import_cursor")
          .update({
            town_index: townIndex,
            offset_in_town: offset,
            total_imported: totalSoFar,
            last_ran_at: new Date().toISOString(),
          })
          .eq("id", true);
        if (persistErr) {
          errors.push(`cursor advance failed: ${persistErr.message}`);
          break;
        }
        continue;
      }

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
        const { error: persistErr } = await service
          .from("cadastral_import_cursor")
          .update({
            town_index: townIndex,
            offset_in_town: offset,
            total_imported: totalSoFar,
            last_ran_at: new Date().toISOString(),
          })
          .eq("id", true);
        if (persistErr) {
          errors.push(`cursor advance failed: ${persistErr.message}`);
          break;
        }
        continue;
      }
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
      if (features.length < PAGE_SIZE) {
        townIndex++;
        offset = 0;
      } else {
        offset += PAGE_SIZE;
      }
      const { error: pageWriteErr } = await service
        .from("cadastral_import_cursor")
        .update({
          town_index: townIndex,
          offset_in_town: offset,
          total_imported: totalSoFar,
          last_ran_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (pageWriteErr) {
        // If the cursor can't advance, every batch will replay the same page
        // — the "batch 17 · 0 erven" false-progress state. Bail loud instead.
        errors.push(`cursor advance failed: ${pageWriteErr.message}`);
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
