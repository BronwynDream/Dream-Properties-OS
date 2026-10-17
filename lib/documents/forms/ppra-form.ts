import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DocContext } from "../resolve";
import { HOUSE_QUESTIONS } from "@/lib/ppraDisclosure";
import { PPRA_FORM_PDF_BASE64 } from "./ppra-master";

// The PPRA Section 67 disclosure, printed onto Bronwyn's copy of the
// prescribed form (2026-10-17). Her master is the PPRA's own PDF — PPRA logo,
// Arial, the YES / NO / N/A table — so instead of re-typesetting it we stamp
// the property description, an X per statement and the additional
// information onto that exact file. Everything else on the form (signatures,
// "Initial here") stays blank for completing by hand, as on her master.
//
// Positions are in points from the top-left of the A4 page, measured off the
// form (pdftotext -bbox); the X columns are where her vacant-land copy marks
// them.

const PAGE_H = 841.92;

/** Top of each statement's row, in the order of HOUSE_QUESTIONS. */
const ROWS: { page: number; top: number }[] = [
  { page: 1, top: 267 }, // roof
  { page: 1, top: 297 }, // electrical
  { page: 1, top: 340 }, // plumbing
  { page: 1, top: 391 }, // heating and air conditioning
  { page: 1, top: 439 }, // septic / sanitary
  { page: 1, top: 524 }, // basement / foundations
  { page: 1, top: 598 }, // structural
  { page: 1, top: 638 }, // boundary
  { page: 1, top: 690 }, // remodelling
  { page: 2, top: 112 }, // additions with consent
  { page: 2, top: 220 }, // heritage
];
const COLUMN_X = { yes: 322, no: 382, na: 445 };
const DESCRIPTION = { page: 0, x: 216, top: 209, width: 300 };
// The additional-information box: eleven ruled rows, 25.25 pt apart, x 91–483; one line per row.
const ADDITIONAL = { page: 2, x: 96, top: 290, width: 382, line: 25.25, maxLines: 11 };

function answerOf(mark: unknown): "yes" | "no" | "na" | null {
  if (typeof mark !== "string") return null;
  if (/YES \[X\]/.test(mark)) return "yes";
  if (/NO \[X\]/.test(mark)) return "no";
  if (/N\/A \[X\]/.test(mark)) return "na";
  return null;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function text(page: PDFPage, s: string, x: number, top: number, font: PDFFont, size: number) {
  page.drawText(s, { x, y: PAGE_H - top - size * 0.86, size, font, color: rgb(0, 0, 0) });
}

export async function renderPpraForm(ctx: DocContext, reference: string): Promise<Buffer> {
  const pdf = await PDFDocument.load(Buffer.from(PPRA_FORM_PDF_BASE64, "base64"));
  pdf.setSubject(reference);
  pdf.setKeywords([reference]);
  pdf.setProducer("Dream OS");
  const pages = pdf.getPages();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const desc = String(ctx.property_description ?? "").trim();
  if (desc) {
    let size = 10;
    while (size > 7 && regular.widthOfTextAtSize(desc, size) > DESCRIPTION.width) size -= 0.5;
    text(pages[DESCRIPTION.page], desc, DESCRIPTION.x, DESCRIPTION.top, regular, size);
  }

  HOUSE_QUESTIONS.forEach((q, i) => {
    const a = answerOf(ctx[`ans_${q.key}`]);
    const row = ROWS[i];
    if (!a || !row) return;
    text(pages[row.page], "X", COLUMN_X[a], row.top, bold, 12);
  });

  const extra = String(ctx.ppra_additional_info ?? "").trim();
  if (extra) {
    const lines = wrap(extra, regular, 10, ADDITIONAL.width);
    lines.slice(0, ADDITIONAL.maxLines).forEach((l, k) => text(pages[ADDITIONAL.page], l, ADDITIONAL.x, ADDITIONAL.top + k * ADDITIONAL.line, regular, 10));
    if (lines.length > ADDITIONAL.maxLines) {
      // More than the form's box holds: continue on an annexure page.
      const page = pdf.addPage([595.32, PAGE_H]);
      text(page, "ADDITIONAL INFORMATION (continued)", 72, 60, bold, 11);
      lines.slice(ADDITIONAL.maxLines).forEach((l, k) => text(page, l, 72, 90 + k * 14, regular, 10));
    }
  }

  return Buffer.from(await pdf.save());
}
