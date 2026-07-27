// Upsert-from-parsed-rows domain logic. Runs after a Valuation Roll PDF
// has been parsed (via parse-full-gv or parse-supplement) and the admin
// hits "Commit" in the UI. Idempotent — re-running with the same input
// produces the same DB state.
//
// Strategy per row:
//   1. Resolve or mint an sg_number.
//      - Supplement: SG21 is present in the row.
//      - Full GV: SG21 is absent. Try to match an existing muni_property
//        by (erf_number, portion, town). If found, use its sg_number. If
//        not, mint a synthetic key `GV:{erf}:{ptn}:{town}` so downstream
//        joins still work by sg_number.
//   2. Upsert muni_property with the identity + address + owner + extent
//      fields. Provenance columns (roll_upload_id) are set on every write.
//   3. Delete existing muni_valuation rows for this SG that were written
//      by an EARLIER upload of the same kind (Full GV supersedes prior
//      Full GV; Supplement supersedes prior data on that erf) — then
//      insert the new valuation row.
//
// Handling of ArcGIS-sourced rows:
//   - Full GV apply DELETES all muni_valuation rows with upload_kind='arcgis'
//     for the SGs it touches, because the GV is the authoritative source.
//   - Supplement apply DELETES arcgis rows for its SGs too, for the same
//     reason — a change recorded in the supplement means the arcgis mirror
//     is definitely stale for that property.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FullGvRow, SupplementRow } from "./types";

export type ApplyResult = {
  properties_upserted: number;
  valuations_inserted: number;
  arcgis_valuations_purged: number;
  synthetic_sg_created: number;
  markers_stored: number;
  errors: string[];
};

// SG21 synthesis for Full GV rows without an SG21 in the PDF.
// Deterministic so re-parsing the same PDF produces the same keys.
function syntheticSg(erf: string, ptn: number, town: string): string {
  const t = town.replace(/\s+/g, "_").toUpperCase();
  return `GV:${erf}:${ptn}:${t}`;
}

function chunk<T>(a: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Full GV apply
// ---------------------------------------------------------------------------
export async function applyFullGv(
  supabase: SupabaseClient,
  rows: FullGvRow[],
  uploadId: string,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    properties_upserted: 0,
    valuations_inserted: 0,
    arcgis_valuations_purged: 0,
    synthetic_sg_created: 0,
    markers_stored: 0,
    errors: [],
  };

  // Pre-fetch every existing (erf, portion, town) → sg_number mapping so
  // we can reuse the real SG21 when the ArcGIS import previously
  // populated one. Only bother for the towns represented in the payload.
  const townsInPayload = Array.from(new Set(rows.map((r) => r.town).filter(Boolean)));
  const { data: existingProps } = await supabase
    .from("muni_property")
    .select("sg_number, erf_number, town_name")
    .in("town_name", townsInPayload);
  const existingBy = new Map<string, string>(); // "erf|town" -> sg_number
  for (const p of (existingProps ?? []) as { sg_number: string; erf_number: string | null; town_name: string | null }[]) {
    if (!p.erf_number || !p.town_name) continue;
    // For Full GV, portion is almost always 0 — collapse into an
    // (erf, town) key for the match. Sectional units / portions get
    // synthesized keys.
    const k = `${p.erf_number}|${p.town_name}`;
    if (!existingBy.has(k)) existingBy.set(k, p.sg_number);
  }

  // Prepare property upserts + valuation inserts.
  const propRows: Record<string, unknown>[] = [];
  const valRows: Record<string, unknown>[] = [];
  const sgList: string[] = [];

  for (const r of rows) {
    const isSimple = r.portion === 0 && r.unit === 0;
    let sg = isSimple ? existingBy.get(`${r.erf_number}|${r.town}`) : undefined;
    if (!sg) {
      sg = syntheticSg(r.erf_number, r.portion, r.town);
      if (sg.startsWith("GV:")) result.synthetic_sg_created++;
    }
    sgList.push(sg);

    propRows.push({
      sg_number: sg,
      erf_number: r.erf_number,
      town_name: r.town,
      suburb: r.town,               // GV has no separate "suburb" — town serves both
      street_no: r.street_no,
      street_name: r.street,
      extent_sqm: r.land_sqm,
      property_type: r.category,
      owner: r.owner,
      roll_upload_id: uploadId,
      refreshed_at: new Date().toISOString(),
    });

    // valuation: markers still get a row so we can render "VALUED WITH ERF X"
    // in the UI, but they carry is_marker=true and no valuation.
    valRows.push({
      sg_number: sg,
      tariff: r.category || "__none__",
      valuation: r.is_marker ? null : r.valuation,
      area_sqm: r.land_sqm,
      comment: r.comment,
      note: r.is_marker ? r.comment : null,   // for GV, the marker text is in "comment"
      upload_kind: "full_gv",
      roll_upload_id: uploadId,
      is_marker: r.is_marker,
      refreshed_at: new Date().toISOString(),
    });
    if (r.is_marker) result.markers_stored++;
  }

  // Upsert properties in batches. onConflict on sg_number — new rows insert,
  // existing rows update.
  for (const c of chunk(propRows, 500)) {
    const { error, count } = await supabase
      .from("muni_property")
      .upsert(c, { onConflict: "sg_number", count: "exact" });
    if (error) {
      result.errors.push(`muni_property upsert: ${error.message}`);
    } else {
      result.properties_upserted += count ?? c.length;
    }
  }

  // Purge existing muni_valuation rows for these SGs, then insert fresh.
  // Delete pattern matches migration 0049's importer — keeps the write
  // idempotent and prevents stale tariff rows from lingering.
  const uniqSgs = Array.from(new Set(sgList));
  for (const c of chunk(uniqSgs, 500)) {
    const { count: purged } = await supabase
      .from("muni_valuation")
      .delete({ count: "exact" })
      .in("sg_number", c)
      .eq("upload_kind", "arcgis");
    result.arcgis_valuations_purged += purged ?? 0;

    const { error: delErr } = await supabase
      .from("muni_valuation")
      .delete()
      .in("sg_number", c)
      .neq("upload_kind", "arcgis");
    if (delErr) result.errors.push(`muni_valuation purge: ${delErr.message}`);
  }

  // Dedupe on (sg, tariff) defensively — some GV rows may share these
  // if a property was double-listed under two categories (rare).
  const seen = new Set<string>();
  const insertRows = valRows.filter((v) => {
    const k = `${v.sg_number}|${v.tariff}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (const c of chunk(insertRows, 500)) {
    const { error, count } = await supabase
      .from("muni_valuation")
      .insert(c, { count: "exact" });
    if (error) {
      result.errors.push(`muni_valuation insert: ${error.message}`);
    } else {
      result.valuations_inserted += count ?? c.length;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Supplement apply
// ---------------------------------------------------------------------------
export async function applySupplement(
  supabase: SupabaseClient,
  rows: SupplementRow[],
  uploadId: string,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    properties_upserted: 0,
    valuations_inserted: 0,
    arcgis_valuations_purged: 0,
    synthetic_sg_created: 0,
    markers_stored: 0,
    errors: [],
  };

  const propRows: Record<string, unknown>[] = [];
  const valRows: Record<string, unknown>[] = [];
  const sgList: string[] = [];

  for (const r of rows) {
    sgList.push(r.sg_number);
    propRows.push({
      sg_number: r.sg_number,
      erf_number: r.erf_number,
      town_name: r.town,
      suburb: r.town,
      street_name: r.street,
      extent_sqm: r.land_sqm,
      property_type: r.category,
      // Owner is redacted as "POPI ACT" in the advertising rolls — don't
      // overwrite a real name from a prior Full GV load with the redaction.
      owner: r.owner && r.owner !== "POPI ACT" ? r.owner : undefined,
      roll_upload_id: uploadId,
      refreshed_at: new Date().toISOString(),
    });

    valRows.push({
      sg_number: r.sg_number,
      tariff: r.category || "__none__",
      valuation: r.is_marker ? null : r.valuation,
      area_sqm: r.land_sqm,
      sec_78: r.sec_78,
      effective_date: r.effective_date,
      comment: r.comment,
      note: r.note,
      upload_kind: "supplement",
      roll_upload_id: uploadId,
      is_marker: r.is_marker,
      refreshed_at: new Date().toISOString(),
    });
    if (r.is_marker) result.markers_stored++;
  }

  // Strip undefined owner so upsert doesn't clobber existing values.
  for (const p of propRows) {
    if (p.owner === undefined) delete p.owner;
  }

  for (const c of chunk(propRows, 500)) {
    const { error, count } = await supabase
      .from("muni_property")
      .upsert(c, { onConflict: "sg_number", count: "exact" });
    if (error) {
      result.errors.push(`muni_property upsert: ${error.message}`);
    } else {
      result.properties_upserted += count ?? c.length;
    }
  }

  const uniqSgs = Array.from(new Set(sgList));
  for (const c of chunk(uniqSgs, 500)) {
    const { count: purged } = await supabase
      .from("muni_valuation")
      .delete({ count: "exact" })
      .in("sg_number", c)
      .eq("upload_kind", "arcgis");
    result.arcgis_valuations_purged += purged ?? 0;

    // Also purge previous supplement rows for these SGs — a new supplement
    // overrides everything about the erf's valuation.
    const { error: delErr } = await supabase
      .from("muni_valuation")
      .delete()
      .in("sg_number", c)
      .in("upload_kind", ["supplement"]);
    if (delErr) result.errors.push(`muni_valuation supplement purge: ${delErr.message}`);
  }

  const seen = new Set<string>();
  const insertRows = valRows.filter((v) => {
    const k = `${v.sg_number}|${v.tariff}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (const c of chunk(insertRows, 500)) {
    const { error, count } = await supabase
      .from("muni_valuation")
      .insert(c, { count: "exact" });
    if (error) {
      result.errors.push(`muni_valuation insert: ${error.message}`);
    } else {
      result.valuations_inserted += count ?? c.length;
    }
  }

  return result;
}
