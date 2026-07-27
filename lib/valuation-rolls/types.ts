// Shared types for the Valuation Roll ingest pipeline.
//
// FullGvRow — one line off Knysna Muni's 5-yearly General Valuation Roll PDF.
// SupplementRow — one line off a Supplementary Roll PDF (deltas between GVs).
//
// Both flow through the same lib/valuation-rolls/apply.ts writer, which
// upserts into muni_property + muni_valuation (schema per migration 0050).

export type FullGvRow = {
  erf_number: string;              // "1453"
  portion: number;                 // usually 0
  unit: number;                    // sectional-title unit; 0 for freehold
  sectional_scheme: string | null;
  town: string;                    // "KNYSNA" | "BELVIDERE" | "SEDGEFIELD" | ...
  category: string;                // "RESIDENTIAL" | "RESIDENTIAL VACANT" | "BUSINESS" | "PLACE OF WORSHIP" | ...
  street_no: string | null;        // as-printed ("2", "6 & 7", "CNR", "")
  street: string | null;           // "PANORAMA ROAD"
  owner: string | null;            // "J W H TRUST" — POPI-sensitive, admin-only in reads
  land_sqm: number | null;         // extent in m²
  valuation: number | null;        // in Rand. null when the row is a marker (see below)
  comment: string | null;          // "DWELLING" | "VACANT" | "CHURCH" | "VALUED WITH ERF 10" ...
  is_marker: boolean;              // true when valuation was R0 with a "VALUED WITH …" note
};

export type SupplementRow = {
  sg_number: string;               // "C0390001000000030000000000" (26 chars)
  erf_number: string;
  portion: number;
  unit: number;
  sectional_scheme: string | null;
  sub_deeds: string | null;        // muni sub-deed code ("8000", "300", "305", ...) — semantics TBD
  town: string;
  category: string;
  sec_78: string | null;           // "78(1)c" | "78(1)d" | "78(1)g" | "78(1)b"
  effective_date: string | null;   // ISO YYYY-MM-DD
  owner: string | null;            // literally "POPI ACT" in the redacted-for-advertising rolls
  street: string | null;
  land_sqm: number | null;
  valuation: number | null;
  comment: string | null;          // change-reason code (REVALUED / ADDITIONS / CATEGORY CHANGED / …)
  note: string | null;             // free-text ("VALUED WITH ERF 10", "OCC RECEIVED", …)
  is_marker: boolean;
};

export type ParseResult<Row> = {
  rows: Row[];
  warnings: string[];              // e.g. "page 27 row 4: could not parse value 'RXXX'"
  pageCount: number;
};

// Shared item shape after pdfjs extraction. One text run per item.
export type PdfItem = {
  s: string;   // text
  x: number;   // x-coord (pdfjs "user space" — grows rightward)
  y: number;   // y-coord (grows upward — flip if you're thinking in screen coords)
  w: number;   // width of the text run
};
