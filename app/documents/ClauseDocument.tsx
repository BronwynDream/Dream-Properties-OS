import type { ResolvedDocument, ResolvedSection } from "@/lib/documents/resolve";
import { BLANK } from "@/lib/documents/resolve";

// Generic renderer for any clause-library document (plan 019 Arc A2).
// Replaces the per-template React components: the skeleton is now the
// slot order in the database, and this component just lays the resolved
// sections out inside <DocumentPage>.
//
// Rendering rules, all driven by the text itself so Bronwyn's masters need
// no markup:
//   - blank line           → new paragraph
//   - ALL-CAPS short line  → heading-weight (titles, "ANNEXURE 'A'")
//   - line containing tabs → signature/definition row, rendered pre-wrap so
//                            the underscores and columns survive
//   - {{token}} left blank → BLANK underscores; highlighted on screen when
//                            `showGaps` is on, plain in print
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
        .clause-doc .cd-gap { background: #fff3c4; border-bottom: 1.5px solid #c8a032; }
        @media print { .clause-doc .cd-gap { background: none; border-bottom: none; } }
      `}</style>
    </div>
  );
}

function Section({ s, showGaps }: { s: ResolvedSection; showGaps: boolean }) {
  const paras = s.body.split(/\n\s*\n/).map((p) => p.replace(/\s+$/, ""));
  return (
    <section data-clause={s.clauseKey}>
      {s.heading && (
        <p className="cd-heading">
          {s.numbering ? `${s.numbering}. ` : ""}
          {s.heading}
        </p>
      )}
      {paras.map((p, i) => {
        const isRow = p.includes("\t") || /_{6,}/.test(p) && p.length < 160 && !/[a-z]{4,}.*[a-z]{4,}.*[a-z]{4,}/.test(p);
        const isTitle = i === 0 && !s.heading && isAllCaps(p) && p.length < 90;
        const cls = isTitle ? "cd-title" : isRow ? "cd-row" : undefined;
        return (
          <p key={i} className={cls}>
            {showGaps ? highlightGaps(p) : p}
          </p>
        );
      })}
    </section>
  );
}

function isAllCaps(p: string): boolean {
  const letters = p.replace(/[^A-Za-z]/g, "");
  return letters.length > 3 && letters === letters.toUpperCase();
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
