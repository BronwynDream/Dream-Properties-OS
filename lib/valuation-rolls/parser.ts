// Shared PDF-reading + column-bucketing helpers for the Valuation Roll
// parsers (Full GV and Supplement). Both PDFs are compiled by CDV MUNVAL
// (Pty) Ltd in the same tabular style: fixed-width columns with rock-stable
// x-positions across every page, header row repeated per page.
//
// Approach:
//   1. Load PDF via pdfjs-dist (Mozilla's Firefox-embedded engine).
//   2. For each page, extract every text run with its (x, y) position.
//   3. Group runs into rows by y-coordinate (tolerance ±2pt).
//   4. Given a set of column start-positions (defined per PDF type), bucket
//      the row's text runs into columns by x-position.
//   5. Emit typed row records.
//
// Why not `pdftotext -layout`? The whitespace-based layout output collapses
// adjacent columns (e.g. "HILL STREET914" where 914 is a separate column).
// pdfjs gives us real coordinates so we can separate them correctly.

import type { PdfItem } from "./types";

// Dynamic import so this module can be required from Next.js server routes
// without pdfjs-dist trying to load in an environment that can't run it.
// pdfjs-dist v6 is ESM-only and pulls in a Worker; we opt out of the
// worker to keep the runtime simple (fine for server-side parsing).
export async function loadPdf(bytes: Uint8Array) {
  // pdfjs v6 is ESM-only and requires either a real worker script or an
  // explicit worker Port. On the server we don't want to spawn a worker
  // thread — pass the worker module as-is via createRequire so the same
  // JS handles both main + worker execution paths.
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!GlobalWorkerOptions.workerSrc) {
    // Point at the shipped worker script inside node_modules so pdfjs's
    // "fake worker" bootstrap can locate it. The path is stable across
    // v6.x releases.
    const { fileURLToPath } = await import("node:url");
    const workerUrl = await import.meta.resolve?.(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
    );
    if (workerUrl) {
      GlobalWorkerOptions.workerSrc = workerUrl.startsWith("file://")
        ? fileURLToPath(workerUrl)
        : workerUrl;
    }
  }
  return await getDocument({
    data: bytes,
    // Don't hit the network for standard fonts / cmaps — inlined ones are
    // enough for text extraction (we don't render glyphs).
    disableFontFace: true,
  }).promise;
}

// Read one page's items into a normalised array.
export async function pageItems(
  doc: Awaited<ReturnType<typeof loadPdf>>,
  pageNum: number,
): Promise<PdfItem[]> {
  const page = await doc.getPage(pageNum);
  const content = await page.getTextContent();
  const items: PdfItem[] = [];
  for (const raw of content.items as { str: string; width: number; transform: number[] }[]) {
    // pdfjs's transform = [scaleX, skewY, skewX, scaleY, x, y]
    // We only need x, y, width; strings that are whitespace-only carry no
    // semantic value and would create spurious "columns".
    const s = raw.str;
    if (s.length === 0) continue;
    items.push({
      s,
      x: raw.transform[4],
      y: raw.transform[5],
      w: raw.width,
    });
  }
  return items;
}

// Group items into rows by y-coordinate. pdfjs y grows upward, so sort
// descending. Tolerance ±2pt handles baseline jitter between adjacent
// characters that a PDF may split into separate runs.
export function groupIntoRows(items: PdfItem[], yTolerance = 2): PdfItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfItem[][] = [];
  let currentY: number | null = null;
  for (const it of sorted) {
    if (currentY == null || Math.abs(currentY - it.y) > yTolerance) {
      rows.push([]);
      currentY = it.y;
    }
    rows[rows.length - 1].push(it);
  }
  return rows;
}

// Column definition: a label plus the x-position at which the column starts.
// The next column's `start` becomes this column's end (exclusive). The final
// column runs to Infinity.
export type ColumnSpec = { key: string; start: number };

// Bucket a row's items into columns. Items whose x-position falls within
// [col.start, next.start) go into that column. A whitespace-only item is
// swallowed (they usually appear between columns as separators).
export function bucketRow(row: PdfItem[], cols: ColumnSpec[]): Record<string, string> {
  const buckets: Record<string, string[]> = {};
  for (const c of cols) buckets[c.key] = [];
  for (const it of row) {
    if (/^\s*$/.test(it.s)) continue;
    // Find the column whose start is <= it.x and whose next-start > it.x.
    // Walk forwards (cols are ordered by start).
    let ci = -1;
    for (let i = 0; i < cols.length; i++) {
      if (it.x >= cols[i].start) ci = i;
      else break;
    }
    if (ci < 0) continue; // item to the left of the first column — skip
    buckets[cols[ci].key].push(it.s);
  }
  const out: Record<string, string> = {};
  for (const c of cols) {
    out[c.key] = buckets[c.key].join(" ").replace(/\s+/g, " ").trim();
  }
  return out;
}

// Parse a Rand-value string like "R9 145 000" / "R914 000" / "R0" into a
// number. Returns null for unparseable input.
export function parseRand(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/^R\s*/i, "").replace(/[\s,]/g, "");
  if (cleaned === "" || cleaned === "0") return cleaned === "0" ? 0 : null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Parse "YYYY/MM/DD" (as printed in the supplement's Eff date column) → ISO.
export function parseDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Parse an integer, tolerating thousands-separator spaces.
export function parseInt10(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/\s+/g, "");
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}
