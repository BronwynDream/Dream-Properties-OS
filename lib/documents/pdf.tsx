import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import type { ResolvedDocument, ResolvedSection } from "./resolve";
import type { AgencyIdentity } from "@/lib/agency";
import { matchNumbered, matchLabelRow, isAllCaps, tidy } from "./layout";
import { LETTERHEADS, type LetterheadPart } from "./letterhead";
import { GOTHIC_BOOK_TTF, GOTHIC_BOOK_OBLIQUE_TTF, GOTHIC_DEMI_TTF, GOTHIC_DEMI_OBLIQUE_TTF } from "./fonts";

// Server-side PDF of a resolved document: the frozen record the seller signs.
//
// 2026-10-17: rebuilt to Bronwyn's Word masters, measure for measure. She
// rejected the first version ("it needs to be her layout — font, format,
// logos, all of it"), so nothing here is ours: the page, letterhead, footer,
// type size, line spacing, indents and the cover / contract-information /
// signature layouts are read off "Dream Properties Agreement of Sale Freehold
// House Template 2026.docx" (A4, margins 15 / 15.6 / 10 mm, Century Gothic
// 10 pt, 1.5 line spacing, an empty line between paragraphs, 10 mm hanging
// indent for clause numbers, labels at 50.8 mm on the contract page).
// Century Gothic is licensed, so URW Gothic (its free metric twin) stands in.
//
// The letterhead and footer are her own images out of the .docx, so the
// logo, strapline, "Initial here" box and directors line are hers exactly.

Font.register({
  family: "Gothic",
  fonts: [
    { src: GOTHIC_BOOK_TTF },
    { src: GOTHIC_BOOK_OBLIQUE_TTF, fontStyle: "italic" },
    { src: GOTHIC_DEMI_TTF, fontWeight: "bold" },
    { src: GOTHIC_DEMI_OBLIQUE_TTF, fontWeight: "bold", fontStyle: "italic" },
  ],
});
// Word does not hyphenate these documents; neither do we.
Font.registerHyphenationCallback((word) => [word]);

const PAGE_W = 595.28; // A4 pt
const MM = 72 / 25.4;

// Page geometry per master, from its section properties and a render of it.
type Geometry = {
  letterhead: keyof typeof LETTERHEADS;
  left: number; right: number; // margins, pt (twips / 20)
  top: number; // body top on pages 2+
  firstTop: number; // body top on page 1 (taller first-page header)
  cover?: number[]; // sale agreements: tops of the seven cover-page lines
};
const PROPERTIES: Geometry = { letterhead: "properties", left: 851 / 20, right: 885 / 20, top: 72, firstTop: 105 };
const GEOMETRY: Record<string, Geometry> = {
  agreement_sale_house: { ...PROPERTIES, cover: [174, 254, 290, 329, 377, 418, 445] },
  agreement_sale_land: { ...PROPERTIES, cover: [222, 302, 386, 425, 473, 545, 572] },
  // The sectional master is set on Bronwyn's newer DREAM KNYSNA letterhead,
  // with a narrower right margin and a deeper header.
  agreement_sale_sectional: { letterhead: "knysna", left: 850 / 20, right: 576 / 20, top: 90, firstTop: 125, cover: [234, 313, 361, 400, 448, 520, 547] },
};
const BOTTOM = 135; // body stops above the page number and footer (all masters)
const LINE = 18.15; // Century Gothic 10 pt at Word's "1.5 lines"
const GAP = LINE; // Bronwyn separates paragraphs with one empty line
const INDENT = 10 * MM; // clause text after "5.1<tab>"
const INDENT_3 = 17.5 * MM; // clause text after "7.2.1<tab>"
const LABEL_W = 50.8 * MM; // contract-information value column


const s = StyleSheet.create({
  page: {
    paddingBottom: BOTTOM,
    fontFamily: "Gothic",
    fontSize: 10,
    lineHeight: LINE / 10,
    color: "#000000",
  },
  bold: { fontWeight: "bold" },
  para: { textAlign: "justify" },
  ragged: { textAlign: "left" },
  num: { flexDirection: "row" },
  numLabel: { width: INDENT },
  numText: { flex: 1, textAlign: "justify" },
  indented: { paddingLeft: INDENT },
  // Cover page
  coverTitle: { fontSize: 16, lineHeight: 1.4, fontWeight: "bold", textAlign: "center" },
  center: { textAlign: "center" },
  // Contract information
  contractTitle: { fontSize: 14, lineHeight: 1.3, fontWeight: "bold", textDecoration: "underline", textAlign: "center" },
  kv: { flexDirection: "row" },
  kvLabel: { width: LABEL_W, fontWeight: "bold" },
  kvValue: { flex: 1, textAlign: "justify" },
  // Signatures
  witness: { flexDirection: "row", alignItems: "flex-end" },
  witnessLine: { width: 92, borderBottomWidth: 0.75, borderBottomColor: "#000000", marginBottom: 4, marginLeft: 18 },
  signCaption: { marginLeft: 208, width: 252, borderTopWidth: 0.75, borderTopColor: "#000000", fontWeight: "bold", textAlign: "center" },
  pageNo: { position: "absolute", left: 0, right: 0, bottom: 842 - 714.6 - 14, textAlign: "center", fontFamily: "Times-Roman", fontSize: 12, lineHeight: 1 },
});

const PROPERTIES_COVER = [174, 254, 290, 329, 377, 418, 445];
const HEADING_RE = /^\d+(?:\.\d+)*\.?$/;

function norm(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type Kind = "cover" | "contract" | "signatures" | "clauses";

function kindOf(sec: ResolvedSection, saleAgreement: boolean): Kind {
  const k = sec.clauseKey;
  if (saleAgreement && k.endsWith(".parties")) return "cover";
  if (/\.contract_info/.test(k)) return "contract";
  if (/signature|commission_acceptance/.test(k)) return "signatures";
  return "clauses";
}

/** Short list items ("14.1<tab>Fixed light fittings;") run on without a gap, as in the master. */
function runsOn(prev: string | undefined, cur: string): boolean {
  if (!prev) return false;
  const a = matchNumbered(prev);
  const b = matchNumbered(cur);
  if (!b || b[1].length > 140) return false;
  if (a && isAllCaps(a[1]) && a[1].length < 80) return false; // a sub-heading is followed by its body, handled below
  if (!a) return /:\s*$/.test(prev);
  return a[1].length <= 140 && /(;|:|\band|\bor)\s*$/i.test(a[1]);
}

export async function renderDocumentPdf(args: {
  doc: ResolvedDocument;
  agency: AgencyIdentity;
  logo: Buffer | null; // unused since 2026-10-17: the letterhead is Bronwyn's own image
  reference: string; // kept in the PDF's metadata; her footer has no room for it
}): Promise<Buffer> {
  const { doc, agency, reference } = args;
  const saleAgreement = doc.templateCode.startsWith("agreement_sale");
  const g = GEOMETRY[doc.templateCode] ?? PROPERTIES;
  const lh = LETTERHEADS[g.letterhead];
  const sections = doc.sections.filter((x) => x.included);

  const out: React.ReactNode[] = [];
  let first = true; // first block on the page flow gets no gap
  let key = 0;
  const push = (node: React.ReactElement) => out.push(React.cloneElement(node, { key: key++ }));
  const gapTop = () => (first ? 0 : GAP);
  const sigBlock: React.ReactNode[] = [];

  sections.forEach((sec, i) => {
    const kind = kindOf(sec, saleAgreement);
    let paras = sec.body.split(/\n\s*\n/).map((p) => p.replace(/\s+$/, "")).filter((p) => p.trim() !== "");
    if (sec.heading && paras.length > 0 && norm(paras[0]) === norm(sec.heading)) paras = paras.slice(1);

    // ---------------------------------------------------------------- cover
    if (kind === "cover") {
      // Tops measured off the master's page 1: title 174 pt, then the
      // centred "Entered into between / SELLER / and / PURCHASER" block.
      const tops = g.cover ?? PROPERTIES_COVER;
      const heights = [22.4, LINE, LINE, LINE, LINE, LINE, LINE];
      const gaps = tops.map((t, j) => (j === 0 ? t - g.firstTop : t - tops[j - 1] - heights[j - 1]));
      paras.forEach((p, j) => {
        const t = tidy(p).trim();
        const isTitle = j === 0 && isAllCaps(t);
        const isParty = j === 2 || j === 5;
        const style = isTitle
          ? s.coverTitle
          : [s.center, isParty ? { fontSize: 12, lineHeight: LINE / 12, fontWeight: "bold" as const } : {}, /^\(hereinafter/.test(t) ? s.bold : {}];
        push(<Text style={[style as never, { marginTop: gaps[j] ?? 18 }]}>{t}</Text>);
      });
      first = true;
      return;
    }

    // ----------------------------------------------------- contract details
    if (kind === "contract") {
      const startsPage = !sec.clauseKey.endsWith("_bond") && !sec.clauseKey.endsWith("_close");
      let prevLabel: string | null = null;
      paras.forEach((p, j) => {
        const t = p.trim();
        if (j === 0 && startsPage && /^CONTRACT INFORMATION/.test(t)) {
          push(<Text break={saleAgreement && i > 0} style={s.contractTitle}>{t}</Text>);
          first = false;
          prevLabel = "__title";
          return;
        }
        const kv = matchLabelRow(p);
        if (kv) {
          const [label, value] = kv;
          const caps = isAllCaps(label);
          const gap =
            j === 0
              ? sec.clauseKey.endsWith("_bond") ? 0 : GAP
              : prevLabel === "PROPERTY DETAILS:" || (caps && prevLabel !== null && !isAllCaps(prevLabel))
                ? GAP
                : 0;
          push(
            <View style={[s.kv, { marginTop: gap }]} wrap={value.length > 120}>
              <Text style={[s.kvLabel, caps ? { textDecoration: "underline" } : {}, /^Domicili/.test(label) ? { fontStyle: "italic" } : {}]}>{label}</Text>
              <Text style={[s.kvValue, label === "SELLING AGENTS:" ? s.bold : {}]} orphans={1}>{value}</Text>
            </View>,
          );
          prevLabel = label;
          return;
        }
        // "SELLER DETAILS:" / "PURCHASER DETAILS:" — a label with no value.
        if (isAllCaps(t) && t.length < 40 && t.endsWith(":")) {
          push(<Text style={[s.bold, { textDecoration: "underline", marginTop: prevLabel === "__title" ? 22 : GAP }]}>{t}</Text>);
          prevLabel = t;
          return;
        }
        // "THE SELLER agrees to sell…": bold, full width.
        push(<Text style={[s.para, s.bold, { marginTop: GAP }]}>{tidy(t)}</Text>);
        prevLabel = null;
      });
      first = false;
      return;
    }

    // ------------------------------------------------------------ signatures
    if (kind === "signatures") {
      // The signing block, with the commission acceptance that follows it,
      // stays on one page, as in the masters.
      const block = sigBlock;
      const add = (node: React.ReactElement) => block.push(React.cloneElement(node, { key: block.length }));
      paras.forEach((p, j) => {
        const t = tidy(p).trim();
        const gap = j === 0 ? GAP * (first ? 0 : 1) : /^AS WITNESSES/.test(t) ? 0 : GAP;
        const w = t.match(/^(\d)\s*_{3,}\s*$/);
        if (w) {
          add(
            <View style={[s.witness, { marginTop: gap }]} wrap={false}>
              <Text>{w[1]}</Text>
              <View style={s.witnessLine} />
            </View>,
          );
          return;
        }
        if (/^(SELLER|PURCHASER|AGENT|PROPERTY PRACTITIONER|.*duly authorised thereto$)/i.test(t) && /authori[sz]ed thereto$/i.test(t) && t.length < 80) {
          // The signature line sits level with witness 2; the caption under it.
          add(<Text style={s.signCaption}>{t}</Text>);
          return;
        }
        const heading = isAllCaps(t) && t.length < 60 && !/^(AS WITNESSES|SIGNED AT)/.test(t) && !t.includes("__");
        const fill = /^_{6,}/.test(t);
        add(<Text style={[heading ? s.bold : s.ragged, { marginTop: fill ? GAP * 2 : gap }]}>{t}</Text>);
      });
      const next = sections[i + 1];
      if (!next || kindOf(next, saleAgreement) !== "signatures") {
        push(<View wrap={false}>{[...block]}</View>);
        sigBlock.length = 0;
      }
      first = false;
      return;
    }

    // --------------------------------------------------------------- clauses
    const prevSec = sections[i - 1];
    const headingOnly = !!sec.heading && paras.length === 0;
    if (headingOnly) {
      // "15. CERTIFICATES OF COMPLIANCE": printed now, its parts follow.
      push(
        <View style={[s.num, { marginTop: gapTop() }]} minPresenceAhead={LINE * 3}>
          <Text style={[s.numLabel, s.bold]}>{sec.numbering ? `${sec.numbering}.` : ""}</Text>
          <Text style={[s.numText, s.bold]}>{sec.heading}</Text>
        </View>,
      );
      first = false;
      return;
    }
    const afterHeadingOnly = !!prevSec && !!prevSec.heading && !prevSec.body.trim();

    const renderPara = (p: string, j: number, gap: number) => {
      const num = matchNumbered(p);
      if (num && !HEADING_RE.test(num[1])) {
        const depth = num[0].replace(/\.$/, "").split(".").length;
        const text = num[1];
        const subhead = isAllCaps(text) && text.length < 80;
        return (
          // A number never sits alone at the foot of a page: short clauses move
          // whole, long ones split after at least their first two lines.
          <View key={j} style={[s.num, { marginTop: gap }]} wrap={!subhead && text.length > 250} minPresenceAhead={LINE * 2}>
            <Text style={{ width: depth >= 3 ? INDENT_3 : INDENT }}>{num[0]}</Text>
            <Text style={[s.numText, subhead ? s.bold : {}]}>{text}</Text>
          </View>
        );
      }
      if (/^(OR|AND\/OR)$/i.test(p.trim())) return <Text key={j} style={[s.bold, { marginTop: gap }]}>{p.trim()}</Text>;
      const hard = p.includes("\n");
      return (
        <Text key={j} style={[hard ? s.ragged : s.para, sec.heading || sec.numbering || isNumberedSection(sec) ? s.indented : {}, { marginTop: gap }]}>
          {tidy(p)}
        </Text>
      );
    };

    const gaps = paras.map((p, j) => {
      if (j === 0) return sec.heading ? 0 : afterHeadingOnly ? 0 : gapTop();
      const prev = paras[j - 1];
      const pn = matchNumbered(prev);
      if (pn && isAllCaps(pn[1]) && pn[1].length < 80) return 0; // "15.1 ELECTRICAL" + its body
      return runsOn(prev, p) ? 0 : GAP;
    });

    // Heading and paragraphs go straight onto the page as siblings, which
    // is where react-pdf's minPresenceAhead actually holds.
    if (sec.heading) {
      push(
        // Never leave a heading alone at the foot of a page.
        <View style={[s.num, { marginTop: afterHeadingOnly ? GAP : gapTop() }]} wrap={false} minPresenceAhead={LINE * 3}>
          <Text style={[s.numLabel, s.bold]}>{sec.numbering ? `${sec.numbering}.` : ""}</Text>
          <Text style={[s.numText, s.bold]}>{sec.heading}</Text>
        </View>,
      );
    }
    paras.forEach((p, j) => push(renderPara(p, j, gaps[j])));
    first = false;
  });

  const pdf = (
    <Document title={doc.templateLabel} author={agency.name} subject={reference} keywords={reference} producer="Dream OS">
      <Page size="A4" style={[s.page, { paddingTop: g.top, paddingLeft: g.left, paddingRight: g.right }]}>
        {/* Bronwyn's letterhead: her own header and footer, page 1 and the rest. */}
        <View fixed style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} render={({ pageNumber }) => strips(pageNumber === 1 ? [lh.headerFirst, lh.footerFirst] : [lh.header, lh.footer])} />
        {/* Page 1's header is taller: start its body lower, as Word does. */}
        <View style={{ height: g.firstTop - g.top }} />

        {out}

        <Text fixed style={s.pageNo} render={({ pageNumber }) => (pageNumber === 1 ? "" : String(pageNumber))} />
      </Page>
    </Document>
  );

  return renderToBuffer(pdf);
}

function strips(parts: LetterheadPart[]) {
  return parts.map((p, k) => (
    // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not DOM
    <Image key={k} src={p.src} style={{ position: "absolute", top: p.top, left: 0, width: PAGE_W, height: p.bottom - p.top }} />
  ));
}

/** Continuation slots ("5.5", "22.1") belong to a numbered clause: their loose paragraphs indent too. */
function isNumberedSection(sec: ResolvedSection): boolean {
  return /^\d+(\.\d+)+/.test(sec.body.trim());
}

export const PDF_PAGE_WIDTH = PAGE_W;
