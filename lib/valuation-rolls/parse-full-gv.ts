// Parser for Knysna Muni's Full General Valuation Roll PDF.
//
// Format (verified against KNYSNA-FULL-GV.pdf, 485 pages, 2.9MB):
//   Rock-stable column x-positions across every page. Header row repeated
//   on each page. No cover / index pages — data begins page 1. No SG21
//   code in this document — rows keyed by (erf, portion, unit, town).
//
// Columns (x-position → key):
//   53   ERF
//   83   PTN
//   106  UNIT
//   131  SECTIONAL SCHEME
//   283  TOWN
//   348  CATEGORY
//   491  NO (street number)
//   532  STREET
//   694  OWNER          ← POPI-sensitive
//   898  LAND m²
//   948  VALUATION
//   1019 COMMENT
//
// Special row types:
//   - R0 with "VALUED WITH ERF X" or "CONSOLIDATED TO ERF X" markers →
//     is_marker=true, valuation=null (not real R0 values).
//   - Rows without an erf number (blank lines, wrapped continuations)
//     are skipped.

import { loadPdf, pageItems, groupIntoRows, bucketRow, parseRand, parseInt10, type ColumnSpec } from "./parser";
import type { FullGvRow, ParseResult } from "./types";

// Column starts sit a few points to the LEFT of the exact header x-position.
// Rendering jitter is ~1-2pt (e.g. "BELVIDERE" at x=282.81 vs. header text
// "DEEDS TOWN" at x=283). If a boundary sits exactly on a header, text
// slightly to its left gets misbucketed into the previous column.
const COLUMNS: ColumnSpec[] = [
  { key: "erf",       start: 45  },
  { key: "ptn",       start: 78  },
  { key: "unit",      start: 100 },
  { key: "scheme",    start: 128 },
  { key: "town",      start: 275 },
  { key: "category",  start: 342 },
  { key: "street_no", start: 485 },
  { key: "street",    start: 525 },
  { key: "owner",     start: 685 },
  { key: "land",      start: 890 },
  { key: "value",     start: 940 },
  { key: "comment",   start: 1010 },
];

// Header keywords we expect on every page. Used to skip the header row so
// we don't parse it as data.
const HEADER_TOKENS = new Set(["ERF", "PTN", "UNIT", "OWNER", "VALUATION", "COMMENT"]);

function isHeaderRow(row: string[]): boolean {
  const set = new Set(row);
  let hits = 0;
  for (const t of HEADER_TOKENS) if (set.has(t)) hits++;
  return hits >= 3;
}

function looksLikeErfNumber(s: string): boolean {
  return /^\d{1,6}$/.test(s.trim());
}

export async function parseFullGv(bytes: Uint8Array): Promise<ParseResult<FullGvRow>> {
  const doc = await loadPdf(bytes);
  const rows: FullGvRow[] = [];
  const warnings: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const items = await pageItems(doc, p);
    const grouped = groupIntoRows(items);

    for (const row of grouped) {
      const strs = row.map((it) => it.s);
      // Skip page-header row + any "KNYSNA LOCAL MUNICIPALITY" title rows.
      if (isHeaderRow(strs)) continue;
      if (strs.some((s) => /KNYSNA LOCAL MUNICIPALITY|GENERAL VALUATION ROLL|PAGE\s*\d+/i.test(s))) continue;

      const cols = bucketRow(row, COLUMNS);

      // Every real data row starts with a numeric erf value in the ERF column.
      if (!looksLikeErfNumber(cols.erf)) continue;

      const valuationStr = cols.value;
      const isMarkerRow = /^R\s*0$/i.test(valuationStr) && /VALUED\s+WITH|CONSOLIDATED\s+TO/i.test(cols.comment ?? "");

      const parsed: FullGvRow = {
        erf_number: cols.erf.trim(),
        portion: parseInt10(cols.ptn) ?? 0,
        unit: parseInt10(cols.unit) ?? 0,
        sectional_scheme: cols.scheme || null,
        town: cols.town || "",
        category: cols.category || "",
        street_no: cols.street_no || null,
        street: cols.street || null,
        owner: cols.owner || null,
        land_sqm: parseInt10(cols.land),
        // Marker rows get null valuation — the R0 is a bookkeeping flag,
        // not a real assessment. Downstream sum-per-erf logic will ignore
        // them via is_marker.
        valuation: isMarkerRow ? null : parseRand(valuationStr),
        comment: cols.comment || null,
        is_marker: isMarkerRow,
      };

      if (!parsed.town) {
        warnings.push(`p${p} erf ${parsed.erf_number}: no town`);
      }
      rows.push(parsed);
    }
  }

  return { rows, warnings, pageCount: doc.numPages };
}
