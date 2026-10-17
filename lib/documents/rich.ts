// Emphasis inside a clause wording (2026-10-17).
//
// Bronwyn's masters bold words inside sentences — "Erf ___ KNYSNA, WESTERN
// CAPE PROVINCE", "ZAR ___ RAND)". The library keeps them as **bold** and
// *italic* (migration 0082, scripts/mark-library-formatting.py); the PDF and
// the on-screen document both read them through here.

export type Run = { text: string; bold: boolean; italic: boolean };

/** "a **deposit of R5 000** payable" → runs. Unbalanced markers are left as text. */
export function parseRich(s: string): Run[] {
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  let buf = "";
  const flush = () => {
    if (buf) runs.push({ text: buf, bold, italic });
    buf = "";
  };
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("**", i)) {
      flush();
      bold = !bold;
      i++;
    } else if (s[i] === "*") {
      flush();
      italic = !italic;
    } else buf += s[i];
  }
  flush();
  return runs;
}

/** The words alone, markers removed. */
export function plain(s: string): string {
  return s.replace(/\*\*/g, "").replace(/\*/g, "");
}
