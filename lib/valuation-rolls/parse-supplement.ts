// Parser for Knysna Muni's Supplementary Valuation Roll PDFs.
//
// Format (verified against KNYSNA-SUPPLEMENTARY-VALUATION-ROLL-4-FOR-
// ADVERTISING-POPI-ACT.pdf, 9 pages, 1.2MB, 433 data rows):
//   Cover page (p1) + index page (p2), then data pages (p3+). Each data
//   page repeats the header row. Owner column is redacted with the literal
//   string "POPI ACT" in the advertising version.
//
// Columns (x-position from pdfjs → key):
//    24  SG number (26-char SG21 code)
//   130  Erf
//   153  Ptn
//   171  Unit
//   193  Scheme name (usually blank)
//   280  Sub Deeds (numeric code — muni sub-deed classification)
//   299  Town
//   350  Category
//   469  Sec 78         ("78(1)c" / "78(1)d" / "78(1)g" / "78(1)b")
//   500  Eff date       (YYYY/MM/DD)
//   542  Owner          (redacted: "POPI ACT" in this variant)
//   575  Address
//   606  Land size
//   641  Value
//   694  Comment
//   765  Note

import { loadPdf, pageItems, groupIntoRows, bucketRow, parseRand, parseInt10, parseDate, type ColumnSpec } from "./parser";
import type { SupplementRow, ParseResult } from "./types";

const COLUMNS: ColumnSpec[] = [
  { key: "sg",         start: 15  },
  { key: "erf",        start: 125 },
  { key: "ptn",        start: 150 },
  { key: "unit",       start: 168 },
  { key: "scheme",     start: 188 },
  { key: "sub_deeds",  start: 275 },
  { key: "town",       start: 295 },
  { key: "category",   start: 345 },
  { key: "sec_78",     start: 465 },
  { key: "eff_date",   start: 495 },
  { key: "owner",      start: 538 },
  { key: "address",    start: 570 },
  { key: "land",       start: 602 },
  { key: "value",      start: 637 },
  { key: "comment",    start: 690 },
  { key: "note",       start: 760 },
];

// Header tokens on the data-page header row.
const HEADER_TOKENS = new Set(["SG number", "Erf", "Owner", "Address", "Value", "Comment"]);

function isHeaderRow(row: string[]): boolean {
  const set = new Set(row);
  let hits = 0;
  for (const t of HEADER_TOKENS) if (set.has(t)) hits++;
  return hits >= 3;
}

function looksLikeSg21(s: string): boolean {
  return /^C\d{20,}$/.test(s.trim());
}

export async function parseSupplement(bytes: Uint8Array): Promise<ParseResult<SupplementRow>> {
  const doc = await loadPdf(bytes);
  const rows: SupplementRow[] = [];
  const warnings: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const items = await pageItems(doc, p);
    const grouped = groupIntoRows(items);

    for (const row of grouped) {
      const strs = row.map((it) => it.s);

      // Skip cover pages (title / dates / index) and repeated page headers.
      if (isHeaderRow(strs)) continue;
      if (
        strs.some((s) =>
          /KNYSNA (LOCAL )?MUNICIPALITY|SUPPLEMENTARY VALUATION ROLL|INDEX: TOWN|CDV MUNVAL/i.test(s),
        )
      ) continue;

      const cols = bucketRow(row, COLUMNS);
      if (!looksLikeSg21(cols.sg)) continue;

      const isMarkerRow =
        /^R\s*0$/i.test(cols.value) &&
        /(VALUED WITH|CONSOLIDATED|SUBDIVIDED|MERGED|CATEGORY CHANGED)/i.test(
          (cols.note ?? "") + " " + (cols.comment ?? ""),
        );

      rows.push({
        sg_number: cols.sg.trim(),
        erf_number: cols.erf.trim(),
        portion: parseInt10(cols.ptn) ?? 0,
        unit: parseInt10(cols.unit) ?? 0,
        sectional_scheme: cols.scheme || null,
        sub_deeds: cols.sub_deeds || null,
        town: cols.town || "",
        category: cols.category || "",
        sec_78: cols.sec_78 || null,
        effective_date: parseDate(cols.eff_date),
        owner: cols.owner || null,
        street: cols.address || null,
        land_sqm: parseInt10(cols.land),
        valuation: isMarkerRow ? null : parseRand(cols.value),
        comment: cols.comment || null,
        note: cols.note || null,
        is_marker: isMarkerRow,
      });
    }
  }

  return { rows, warnings, pageCount: doc.numPages };
}
