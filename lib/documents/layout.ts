// Paragraph layout conventions shared by the on-screen preview
// (app/documents/ClauseDocument.tsx) and the PDF (lib/documents/pdf.tsx),
// so screen and paper always agree.
//
// Bronwyn's masters separate a clause number or a label from its text with
// a TAB. When a migration is pasted into the Supabase SQL editor the tabs
// arrive as runs of spaces, so a tab OR two-plus spaces counts.

/** "2.1<tab>The purchase price…" → ["2.1", "The purchase price…"] */
export function matchNumbered(p: string): [string, string] | null {
  const m = p.match(/^(\d+(?:\.\d+)*\.?)(?:\t+| {2,}| (?=[A-Z“"‘'(]))([\s\S]+)$/);
  if (!m) return null;
  // A bare number followed by underscores is a witness/signature line.
  if (/^_+/.test(m[2].trim())) return null;
  return [m[1], tidy(m[2])];
}

/** "Full Names:<tab>Jane Doe" → ["Full Names:", "Jane Doe"] — a label of up
 *  to 40 characters, then a tab, or two-plus spaces after a colon. */
export function matchLabelRow(p: string): [string, string] | null {
  const m = p.match(/^([^\t\n]{1,40}?)\t+([\s\S]+)$/) ?? p.match(/^([^\t\n]{1,40}:)\s{2,}(\S[\s\S]*)$/);
  return m ? [m[1].trim(), tidy(m[2])] : null;
}

export function isAllCaps(p: string): boolean {
  const letters = p.replace(/[^A-Za-z]/g, "");
  return letters.length > 3 && letters === letters.toUpperCase();
}

/** Internal tabs and the space runs pasted tabs became → two spaces. */
export function tidy(s: string): string {
  return s.replace(/\t+/g, "  ").replace(/ {3,}/g, "  ");
}
