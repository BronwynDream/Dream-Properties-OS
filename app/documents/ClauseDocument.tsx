import type { ResolvedDocument, ResolvedSection } from "@/lib/documents/resolve";
import { BLANK } from "@/lib/documents/resolve";
import { matchNumbered, matchLabelRow, isAllCaps, tidy } from "@/lib/documents/layout";
import { parseRich, plain } from "@/lib/documents/rich";

// Generic renderer for any clause-library document (plan 019 Arc A2).
// Replaces the per-template React components: the skeleton is now the
// slot order in the database, and this component just lays the resolved
// sections out inside <DocumentPage>.
//
// Rendering rules, all driven by the text itself so Bronwyn's masters need
// no markup:
//   - blank line           → new paragraph
//   - ALL-CAPS short line  → heading-weight (titles, "ANNEXURE 'A'")
//   - "2.1<tab>text"       → numbered sub-clause, hanging indent
//   - "Label:<tab>value"   → contract-information row, two columns
//   - short fill-in line   → signature row, pre-wrap so the underscores survive
//   - {{token}} left blank → BLANK underscores; highlighted on screen when
//                            `showGaps` is on, plain in print
//   - **bold** / *italic*  → the master's emphasis inside a sentence (rich.ts)
//
// Optional slot headings (sale agreements) print as "12. HEADING" above the
// body when the slot carries them.

export default function ClauseDocument({
  doc,
  showGaps = false,
}: {
  doc: ResolvedDocument;
  showGaps?: boolean;
}) {
  return (
    <div className="clause-doc">
      {doc.sections.filter((s) => s.included).map((s) => (
        <Section key={s.slotId} s={s} showGaps={showGaps} />
      ))}
      <style>{`
        .clause-doc p { margin: 0 0 10pt; line-height: 1.45; }
        .clause-doc .cd-title { font-weight: 700; font-size: 13pt; letter-spacing: 0.02em; margin: 0 0 12pt; }
        .clause-doc .cd-heading { font-weight: 700; margin: 14pt 0 6pt; }
        .clause-doc .cd-row { white-space: pre-wrap; font-family: inherit; margin: 0 0 8pt; }
        .clause-doc .cd-sub { font-weight: 700; margin: 6pt 0 6pt; }
        .clause-doc .cd-kv { display: grid; grid-template-columns: 11.5em minmax(0, 1fr); gap: 8pt; margin: 0 0 4pt; }
        .clause-doc .cd-kv > span:first-child { color: #5F6883; font-size: 0.92em; }
        .clause-doc .cd-num { display: grid; grid-template-columns: 3em minmax(0, 1fr); margin: 0 0 10pt; line-height: 1.45; }
        .clause-doc .cd-gap { background: #E2E8F6; border-bottom: 1.5px solid #122E87; }
        @media print { .clause-doc .cd-gap { background: none; border-bottom: none; } }
      `}</style>
    </div>
  );
}

function Section({ s, showGaps }: { s: ResolvedSection; showGaps: boolean }) {
  const gap = (p: string) => rich(p, showGaps);
  let paras = s.body.split(/\n\s*\n/).map((p) => p.replace(/\s+$/, ""));
  // Some seeded bodies open with the clause heading itself (the masters
  // put it on its own line). Don't print it twice.
  if (s.heading && paras.length > 1 && norm(paras[0]) === norm(s.heading)) paras = paras.slice(1);
  return (
    <section data-clause={s.clauseKey}>
      {s.heading && (
        <p className="cd-heading">
          {s.numbering ? `${s.numbering}. ` : ""}
          {s.heading}
        </p>
      )}
      {paras.map((p, i) => {
        const pp = plain(p);
        const isTitle = i === 0 && !s.heading && isAllCaps(pp) && pp.length < 90;
        if (isTitle) return <p key={i} className="cd-title">{gap(p)}</p>;
        // Same conventions as the PDF (lib/documents/pdf.tsx): numbered
        // sub-clause, label/value row, short all-caps sub-heading.
        const num = matchNumbered(p);
        if (num) {
          const text = num[1];
          return (
            <div key={i} className="cd-num">
              <span>{num[0]}</span>
              <span style={isAllCaps(plain(text)) && plain(text).length < 80 ? { fontWeight: 700 } : undefined}>{gap(text)}</span>
            </div>
          );
        }
        const kv = matchLabelRow(p);
        if (kv) {
          return (
            <div key={i} className="cd-kv">
              <span>{kv[0]}</span>
              <span>{gap(kv[1])}</span>
            </div>
          );
        }
        const isRow = /_{6,}/.test(pp) && pp.length < 160 && !/[a-z]{4,}.*[a-z]{4,}.*[a-z]{4,}/.test(pp);
        if (isRow) return <p key={i} className="cd-row">{gap(p)}</p>;
        if (isAllCaps(pp) && pp.length < 80) return <p key={i} className="cd-sub">{gap(p)}</p>;
        return <p key={i}>{gap(tidy(p))}</p>;
      })}
    </section>
  );
}

function norm(t: string): string {
  return plain(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}


/** Emphasis as <strong>/<em>; blanks highlighted when asked. */
function rich(p: string, showGaps: boolean): React.ReactNode {
  const runs = parseRich(p);
  return runs.map((r, k) => {
    const inner = showGaps ? highlightGaps(r.text) : r.text;
    if (r.bold && r.italic) return <strong key={k}><em>{inner}</em></strong>;
    if (r.bold) return <strong key={k}>{inner}</strong>;
    if (r.italic) return <em key={k}>{inner}</em>;
    return <span key={k}>{inner}</span>;
  });
}

function highlightGaps(p: string): React.ReactNode {
  const parts = p.split(BLANK);
  if (parts.length === 1) return p;
  const out: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    out.push(part);
    if (i < parts.length - 1) out.push(<span key={i} className="cd-gap">{BLANK}</span>);
  });
  return out;
}
