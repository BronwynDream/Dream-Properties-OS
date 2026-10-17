import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import type { DocContext, ResolvedDocument, ResolvedSection } from "./resolve";
import type { AgencyIdentity } from "@/lib/agency";
import { matchNumbered, matchLabelRow, isAllCaps, tidy } from "./layout";
import { parseRich, plain } from "./rich";
import { LETTERHEADS, type LetterheadPart } from "./letterhead";
import { GOTHIC_BOOK_TTF, GOTHIC_BOOK_OBLIQUE_TTF, GOTHIC_DEMI_TTF, GOTHIC_DEMI_OBLIQUE_TTF } from "./fonts";
import { renderPpraForm } from "./forms/ppra-form";

// Server-side PDF of a resolved document: the frozen record the parties sign.
//
// 2026-10-17: every document is laid out as Bronwyn's Word master for it,
// measure for measure. She rejected the first version ("it needs to be her
// layout — font, format, logos, all of it"), so nothing here is ours. Each
// template has a PROFILE read off its master (.docx section properties and a
// render of it): margins, body top on page 1 and after, line spacing (Word's
// "1.5 lines" for the agreements, single for mandates and addenda), the gap
// between paragraphs, the clause indent, page numbers, and which of her
// letterheads it carries. Century Gothic is licensed, so URW Gothic (its free
// metric twin) stands in.
//
// The PPRA disclosure is the regulator's own form: it is printed onto
// Bronwyn's copy of that PDF (forms/ppra-form.ts), not typeset here.
//
// Wordings may carry **bold** / *italic* (rich.ts) where the master
// emphasises words inside a sentence.

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
const ONE_HALF = 18.15; // Century Gothic 10 pt at Word's "1.5 lines"
const SINGLE = 12.1; // … at single spacing

type Profile = {
  letterhead: keyof typeof LETTERHEADS;
  left: number; right: number; // margins, pt (twips / 20)
  top: number; // body top on pages 2+
  firstTop: number; // body top on page 1 (under the taller first-page header)
  line: number; // line pitch
  gap: number; // the empty line between paragraphs
  indent: number; // clause text after "5.1<tab>"
  headingGap: number; // between a clause heading and its first paragraph
  pageNumbers: boolean;
  sigGap: number; // between the lines of a signing block
  title: { size: number; underline: boolean; centred: boolean };
  cover?: number[]; // sale agreements: tops of the seven cover-page lines
  numberAt?: number; // appendix: the number sits this far in from the margin
  bottom?: number; // body bottom margin, where the footer allows more than BOTTOM
};

const SALE: Profile = {
  letterhead: "properties", left: 851 / 20, right: 885 / 20, top: 72, firstTop: 105,
  line: ONE_HALF, gap: ONE_HALF, indent: 10 * MM, headingGap: 0, pageNumbers: true, sigGap: ONE_HALF,
  title: { size: 16, underline: false, centred: true },
};
const MANDATE: Profile = {
  letterhead: "mandate", left: 850 / 20, right: 850 / 20, top: 84, firstTop: 104,
  line: SINGLE, gap: SINGLE, indent: 10 * MM, headingGap: 0, pageNumbers: false, sigGap: 2 * SINGLE,
  title: { size: 10, underline: true, centred: true },
};
const ADDENDUM: Profile = {
  letterhead: "properties", left: 850 / 20, right: 850 / 20, top: 72, firstTop: 104,
  line: SINGLE, gap: SINGLE, indent: 36, headingGap: 0, pageNumbers: true, sigGap: ONE_HALF,
  title: { size: 16, underline: true, centred: true },
};

const PROFILES: Record<string, Profile> = {
  agreement_sale_house: { ...SALE, cover: [174, 254, 290, 329, 377, 418, 445] },
  agreement_sale_land: { ...SALE, cover: [222, 302, 386, 425, 473, 545, 572] },
  // The sectional master is set on Bronwyn's DREAM KNYSNA letterhead, with a
  // narrower right margin and a deeper header.
  agreement_sale_sectional: { ...SALE, letterhead: "knysna", left: 850 / 20, right: 576 / 20, top: 90, firstTop: 125, cover: [234, 313, 361, 400, 448, 520, 547] },
  mandate_exclusive: MANDATE,
  mandate_joint: MANDATE,
  mandate_open: { ...MANDATE, letterhead: "open", bottom: 110 },
  movables_agreement: { ...SALE, left: 850 / 20, right: 850 / 20, firstTop: 107, indent: 34.6, headingGap: ONE_HALF },
  addendum_sale: ADDENDUM,
  addendum_movables: { ...ADDENDUM, sigGap: 0, title: { size: 11.5, underline: true, centred: true } },
  condition_report_appendix: {
    ...SALE, letterhead: "appendix", left: 72, right: 55.6, top: 68, firstTop: 68, indent: 36, numberAt: 18, pageNumbers: false,
    title: { size: 10, underline: false, centred: false },
  },
};

const BOTTOM = 135; // body stops above the page number and footer (all masters)
const INDENT_3 = 17.5 * MM; // clause text after "7.2.1<tab>"
const LABEL_W = 50.8 * MM; // contract-information value column

const s = StyleSheet.create({
  page: { paddingBottom: BOTTOM, fontFamily: "Gothic", fontSize: 10, color: "#000000" },
  bold: { fontWeight: "bold" },
  para: { textAlign: "justify" },
  ragged: { textAlign: "left" },
  row: { flexDirection: "row" },
  numText: { flex: 1, textAlign: "justify" },
  center: { textAlign: "center" },
  contractTitle: { fontSize: 14, lineHeight: 1.3, fontWeight: "bold", textDecoration: "underline", textAlign: "center" },
  kvLabel: { width: LABEL_W, fontWeight: "bold" },
  kvValue: { flex: 1, textAlign: "justify" },
  witness: { flexDirection: "row", alignItems: "flex-end" },
  witnessLine: { width: 92, borderBottomWidth: 0.75, borderBottomColor: "#000000", marginBottom: 4, marginLeft: 18 },
  signCaption: { marginLeft: 208.8, width: 253, borderTopWidth: 0.75, borderTopColor: "#000000", fontWeight: "bold", textAlign: "left" },
  rule: { borderBottomWidth: 0.75, borderBottomColor: "#000000" },
  pageNo: { position: "absolute", left: 0, right: 0, bottom: 842 - 714.6 - 14, textAlign: "center", fontFamily: "Times-Roman", fontSize: 12, lineHeight: 1 },
});

const PROPERTIES_COVER = [174, 254, 290, 329, 377, 418, 445];
/** Red guidance lines in the masters, for the agent — not part of the signed document. */
const GUIDANCE = /^(EXAMPLES|COMPULSORY):?$/i;

function norm(t: string): string {
  return plain(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Text with **bold** / *italic* runs as nested react-pdf Text. */
function Rich({ text, style, brk }: { text: string; style?: Style | Style[]; brk?: boolean }) {
  const runs = parseRich(text);
  if (runs.length === 1 && !runs[0].bold && !runs[0].italic) return <Text break={brk} style={style}>{runs[0].text}</Text>;
  return (
    <Text break={brk} style={style}>
      {runs.map((r, k) =>
        r.bold || r.italic ? (
          <Text key={k} style={{ ...(r.bold ? { fontWeight: "bold" as const } : {}), ...(r.italic ? { fontStyle: "italic" as const } : {}) }}>{r.text}</Text>
        ) : (
          r.text
        ),
      )}
    </Text>
  );
}

type Kind = "cover" | "centred" | "title" | "contract" | "signatures" | "sigtable" | "definitions" | "annexure" | "clauses";

function kindOf(sec: ResolvedSection, code: string): Kind {
  const k = sec.clauseKey;
  if (code.startsWith("agreement_sale") && k.endsWith(".parties")) return "cover";
  if (code.startsWith("addendum") && k.endsWith(".parties")) return "centred";
  if (k.endsWith(".title")) return "title";
  if (/\.contract_info/.test(k)) return "contract";
  if (k === "mandate.signatures" || k === "mandate.joint_agency_signature") return "sigtable";
  if (/(^|\.)signatures?(\.|$)|^signature\.|commission_acceptance/.test(k)) return "signatures";
  if (k === "movables.definitions") return "definitions";
  if (k.endsWith(".annexure_a")) return "annexure";
  return "clauses";
}

/** Short list items ("14.1<tab>Fixed light fittings;") run on without a gap, as in the master. */
function runsOn(prev: string | undefined, cur: string): boolean {
  if (!prev) return false;
  const a = matchNumbered(plain(prev));
  const b = matchNumbered(plain(cur));
  if (!b || b[1].length > 140) return false;
  if (a && isAllCaps(a[1]) && a[1].length < 80) return false;
  if (!a) return /:\s*$/.test(plain(prev));
  return a[1].length <= 140 && /(;|:|\band|\bor)\s*$/i.test(a[1]);
}

export async function renderDocumentPdf(args: {
  doc: ResolvedDocument;
  agency: AgencyIdentity;
  logo: Buffer | null; // unused since 2026-10-17: the letterhead is Bronwyn's own image
  reference: string; // kept in the PDF's metadata; her footers have no room for it
  context?: DocContext; // the filled fields; the PPRA form is stamped from these
}): Promise<Buffer> {
  const { doc, agency, reference } = args;
  // The PPRA disclosure is the regulator's own form: print onto it.
  if (doc.templateCode === "ppra_disclosure") return renderPpraForm(args.context ?? {}, reference);

  const code = doc.templateCode;
  const g = PROFILES[code] ?? SALE;
  const lh = LETTERHEADS[g.letterhead];
  const LINE = g.line;
  const GAP = g.gap;
  const sections = doc.sections.filter((x) => x.included);

  const out: React.ReactNode[] = [];
  let first = true; // first block on the page flow gets no gap
  let key = 0;
  const push = (node: React.ReactElement) => out.push(React.cloneElement(node, { key: key++ }));
  let afterTitle = false; // the master leaves a deeper space under a title
  const gapTop = () => (first ? 0 : afterTitle ? 15 : GAP); // under a title: 15 pt, measured off the masters
  const sigBlock: React.ReactNode[] = [];
  const lineStyle: Style = { lineHeight: LINE / 10 };

  sections.forEach((sec, i) => {
    const kind = kindOf(sec, code);
    if (i > 0 && kindOf(sections[i - 1], code) !== "title") afterTitle = false;
    // A no-break space in the master ("TIHOA.\u00a0 This") would glue two words
    // into one and force a hyphenated break; Word treats it as a space here.
    const all = sec.body.replace(/\u00a0/g, " ").split(/\n\s*\n/).map((p) => p.replace(/\s+$/, "")).filter((p) => p.trim() !== "");
    let paras = all.filter((p) => !GUIDANCE.test(plain(p).trim()));
    if (sec.heading && paras.length > 0 && norm(paras[0]) === norm(sec.heading) && (kind === "clauses" || kind === "definitions")) paras = paras.slice(1);

    // ---------------------------------------------------------------- cover
    if (kind === "cover") {
      // Tops measured off the master's page 1: title, then the centred
      // "Entered into between / SELLER / and / PURCHASER" block.
      const tops = g.cover ?? PROPERTIES_COVER;
      const heights = [22.4, LINE, LINE, LINE, LINE, LINE, LINE];
      const gaps = tops.map((t, j) => (j === 0 ? t - g.firstTop : t - tops[j - 1] - heights[j - 1]));
      paras.forEach((p, j) => {
        const t = tidy(p).trim();
        const isTitle = j === 0 && isAllCaps(plain(t));
        const isParty = j === 2 || j === 5;
        const style: Style[] = isTitle
          ? [{ fontSize: 16, lineHeight: 1.4, fontWeight: "bold", textAlign: "center" }]
          : [s.center, lineStyle, isParty ? { fontSize: 12, lineHeight: LINE / 12, fontWeight: "bold" } : {}, /^\(hereinafter/.test(plain(t)) ? s.bold : {}];
        push(<Rich text={t} style={[...style, { marginTop: gaps[j] ?? 18 }]} />);
      });
      first = true;
      return;
    }

    // ------------------------------------------- addendum: the centred block
    if (kind === "centred") {
      paras.forEach((p, j) => {
        const t = tidy(p).trim();
        const pt = plain(t);
        if (j === 0) {
          push(<Rich text={t} style={[s.center, { fontSize: g.title.size, lineHeight: 1.2, fontWeight: "bold", textDecoration: g.title.underline ? "underline" : "none" }]} />);
          return;
        }
        const tight = /^\(hereinafter|^dated\b|^\("the movables/i.test(pt);
        const party = /^\(hereinafter/i.test(plain(paras[j + 1] ?? ""));
        push(<Rich text={t} style={[s.center, lineStyle, party ? s.bold : {}, { marginTop: j === 1 ? GAP * 1.6 : tight ? 0 : GAP }]} />);
      });
      first = false;
      return;
    }

    // ------------------------------------------------------------- titles
    if (kind === "title") {
      paras.forEach((p, j) => {
        push(
          <Rich
            text={tidy(p).trim()}
            style={[
              { fontSize: g.title.size, lineHeight: 1.45, fontWeight: "bold", textAlign: g.title.centred ? "center" : "left", textDecoration: g.title.underline ? "underline" : "none" },
              { marginTop: j === 0 ? 0 : g.title.size > 12 ? 6 : 0 },
            ]}
          />,
        );
      });
      first = false;
      afterTitle = true;
      return;
    }

    // ----------------------------------------------------- contract details
    if (kind === "contract") {
      const startsPage = !sec.clauseKey.endsWith("_bond") && !sec.clauseKey.endsWith("_close");
      let prevLabel: string | null = null;
      paras.forEach((p, j) => {
        const t = p.trim();
        if (j === 0 && startsPage && /^CONTRACT INFORMATION/.test(plain(t))) {
          push(<Text break={i > 0} style={s.contractTitle}>{plain(t)}</Text>);
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
            <View style={[s.row, lineStyle, { marginTop: gap }]} wrap={value.length > 120}>
              <Text style={[s.kvLabel, caps ? { textDecoration: "underline" } : {}, /^Domicili/.test(label) ? { fontStyle: "italic" } : {}]}>{label}</Text>
              <Text style={[s.kvValue, label === "SELLING AGENTS:" ? s.bold : {}]} orphans={1}>{plain(value)}</Text>
            </View>,
          );
          prevLabel = label;
          return;
        }
        // "SELLER DETAILS:" / "PURCHASER DETAILS:" — a label with no value.
        if (isAllCaps(t) && t.length < 40 && t.endsWith(":")) {
          push(<Text style={[s.bold, lineStyle, { textDecoration: "underline", marginTop: prevLabel === "__title" ? 22 : GAP }]}>{t}</Text>);
          prevLabel = t;
          return;
        }
        // "THE SELLER agrees to sell…": bold, full width.
        push(<Text style={[s.para, s.bold, lineStyle, { marginTop: GAP }]}>{tidy(plain(t))}</Text>);
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
      const sig: Style = { lineHeight: ONE_HALF / 10 };
      paras.forEach((p, j) => {
        const t = tidy(plain(p)).trim();
        const gap = j === 0 ? (first ? 0 : GAP) : /^AS WITNESSES/.test(t) ? 0 : g.sigGap;
        const w = t.match(/^(\d)\s*(_{3,})?\s*$/);
        if (w) {
          add(
            <View style={[s.witness, sig, { marginTop: gap }]} wrap={false}>
              <Text>{w[1]}</Text>
              <View style={s.witnessLine} />
            </View>,
          );
          return;
        }
        if (/authori[sz]ed thereto$/i.test(t) && t.length < 80 && !/^DREAM/.test(t)) {
          // The signature line sits level with witness 2; the caption under it.
          add(<Text style={[s.signCaption, sig]}>{t}</Text>);
          return;
        }
        const heading = isAllCaps(t) && t.length < 60 && !/^(AS WITNESSES|SIGNED AT)/.test(t) && !t.includes("__");
        const fill = /^_{6,}/.test(t);
        add(<Text style={[heading ? s.bold : s.ragged, sig, { marginTop: fill ? GAP * 2 : gap }]}>{t}</Text>);
      });
      const next = sections[i + 1];
      if (next && kindOf(next, code) === "annexure") {
        // "ANNEXURE 'A'" closes the signing page in the master; its list starts the next.
        const title = next.body.split(/\n\s*\n/)[0]?.trim();
        if (title) add(<Rich text={title} style={[s.center, s.bold, { fontSize: 12, lineHeight: 1.6, marginTop: 4 }]} />);
      }
      if (!next || kindOf(next, code) !== "signatures") {
        push(<View wrap={false}>{[...block]}</View>);
        sigBlock.length = 0;
      }
      first = false;
      return;
    }

    // ---------------------------------------------- mandate signature table
    if (kind === "sigtable") {
      // "Seller: (signature)<tab>____<tab>Date:<tab>____" in the master's
      // columns; "AGENT" / "PRINCIPAL / OWNER" sit under the row they name.
      const block: React.ReactNode[] = [];
      paras.forEach((p, j) => {
        const raw = plain(p);
        const cells = raw.split(/\t+/).map((c) => c.trim()).filter((c) => c !== "");
        const isRow = /_{6,}/.test(raw) && /Date:/i.test(raw);
        if (isRow) {
          const label = cells[0] && !/^_+$/.test(cells[0]) ? cells[0] : "";
          block.push(
            <View key={j} style={[s.row, { marginTop: j === 0 ? (first ? 0 : 2 * GAP) : g.sigGap, alignItems: "flex-end" }]} wrap={false}>
              <Text style={[s.bold, { width: 144 }]}>{label}</Text>
              <View style={[s.rule, { width: 150, marginBottom: 2 }]} />
              <Text style={{ marginLeft: 30, width: 72 }}>Date:</Text>
              <View style={[s.rule, { width: 82, marginBottom: 2 }]} />
            </View>,
          );
          return;
        }
        const indented = /^\s*\t/.test(p);
        block.push(<Text key={j} style={[s.bold, { marginLeft: indented ? 144 : 0 }]}>{raw.trim()}</Text>);
      });
      push(<View wrap={false}>{block}</View>);
      first = false;
      return;
    }

    // ------------------------------------------- movables: the definitions
    if (kind === "definitions") {
      push(
        <View style={[s.row, lineStyle, { marginTop: gapTop() }]} wrap={false} minPresenceAhead={LINE * 2.5}>
          <Text style={{ width: g.indent }}>{sec.numbering ? `${sec.numbering}.` : ""}</Text>
          <Text style={s.bold}>{sec.heading}</Text>
        </View>,
      );
      paras.forEach((p, j) => {
        const raw = p.replace(/^\s+/, "");
        const num = matchNumbered(plain(raw));
        if (!num) {
          push(<Rich text={tidy(raw)} style={[s.para, lineStyle, { paddingLeft: g.indent, marginTop: j === 0 ? 6 : GAP }]} />);
          return;
        }
        // 1.1<tab>"the assets"<tab><tab>the movable assets…
        const rest = raw.slice(raw.indexOf(num[0]) + num[0].length).replace(/^\s+/, "");
        const parts = rest.split(/\t+/);
        const term = parts[0] ?? "";
        const meaning = parts.slice(1).join(" ").trim();
        push(
          <View style={[s.row, lineStyle, { marginTop: GAP }]} wrap={false}>
            <Text style={{ width: g.indent - 2 }}>{num[0]}</Text>
            <Rich text={term.trim()} style={{ width: 171 - g.indent + 2 }} />
            <Rich text={meaning} style={s.numText} />
          </View>,
        );
      });
      first = false;
      return;
    }

    // ------------------------------------------------ movables: annexure A
    if (kind === "annexure") {
      const titled = !!prevSec0(sections, i) && kindOf(prevSec0(sections, i)!, code) === "signatures";
      paras.forEach((p, j) => {
        // Her list keeps its odd leading spaces; keep them too.
        const t = tidy(p).replace(/\s+$/, "").replace(/^ +/, (m) => "\u00a0".repeat(m.length));
        if (j === 0) {
          if (!titled) push(<Rich text={t.trim()} style={[s.center, s.bold, { fontSize: 12, lineHeight: 1.6 }]} />);
          return;
        }
        // The list itself starts a new page, as in the master.
        const heading = /:\s*$/.test(plain(t)) && plain(t).length < 40;
        push(<Rich text={t} brk={j === 1} style={[s.para, lineStyle, heading ? s.bold : {}, { marginTop: j === 1 ? 0 : GAP }]} />);
      });
      first = false;
      return;
    }

    // --------------------------------------------------------------- clauses
    const prevSec = sections[i - 1];
    const headingOnly = !!sec.heading && paras.length === 0;
    const numCol = g.numberAt ?? 0;
    if (headingOnly) {
      // "15. CERTIFICATES OF COMPLIANCE": printed now, its parts follow.
      push(
        <View style={[s.row, lineStyle, { marginTop: gapTop() }]} minPresenceAhead={LINE * 3}>
          <Text style={[s.bold, { width: g.indent }]}>{sec.numbering ? `${sec.numbering}.` : ""}</Text>
          <Text style={[s.numText, s.bold]}>{sec.heading}</Text>
        </View>,
      );
      first = false;
      return;
    }
    const afterHeadingOnly = !!prevSec && !!prevSec.heading && !prevSec.body.trim();
    const isFirstTitle = i === 0 && !sec.heading && paras.length > 0 && isAllCaps(plain(paras[0])) && plain(paras[0]).length < 100;

    const renderPara = (p: string, j: number, gap: number) => {
      const pp = plain(p);
      // A document's own title (the appendix): bold, flush left.
      if (isFirstTitle && j === 0) return <Rich key={j} text={tidy(p)} style={[s.bold, lineStyle, { marginTop: gap }]} />;
      const num = matchNumbered(p);
      if (num) {
        const depth = num[0].replace(/\.$/, "").split(".").length;
        const text = num[1];
        const subhead = isAllCaps(plain(text)) && plain(text).length < 80;
        const width = depth >= 3 ? INDENT_3 : g.indent - numCol;
        return (
          // A number never sits alone at the foot of a page: short clauses move
          // whole, long ones split after at least their first two lines.
          <View key={j} style={[s.row, lineStyle, { marginTop: gap, paddingLeft: numCol }]} wrap={!subhead && text.length > 250} minPresenceAhead={LINE * 2}>
            <Text style={{ width }}>{num[0]}</Text>
            <Rich text={text} style={[s.numText, subhead ? s.bold : {}]} />
          </View>
        );
      }
      if (/^(OR|AND\/OR)$/i.test(pp.trim())) return <Text key={j} style={[s.bold, lineStyle, { marginTop: gap }]}>{pp.trim()}</Text>;
      // A paragraph that is nothing but a blank, where the master rules lines to write on.
      if (/^_{6,}$/.test(pp.trim()) && g.numberAt != null) {
        return (
          <View key={j} style={{ marginTop: gap, paddingLeft: g.indent }} wrap={false}>
            <View style={[s.rule, { width: 406, height: LINE * 1.5 }]} />
            <View style={[s.rule, { width: 406, height: LINE * 1.5 }]} />
          </View>
        );
      }
      const hard = pp.includes("\n");
      const indented = sec.heading || sec.numbering || isNumberedSection(sec) || (g.numberAt != null && !isFirstTitle);
      return <Rich key={j} text={tidy(p)} style={[hard ? s.ragged : s.para, lineStyle, indented ? { paddingLeft: g.indent } : {}, { marginTop: gap }]} />;
    };

    const gaps = paras.map((p, j) => {
      if (j === 0) return sec.heading ? (sec.numbering ? g.headingGap : GAP) : afterHeadingOnly ? 0 : gapTop();
      const prev = paras[j - 1];
      const pn = matchNumbered(plain(prev));
      if (pn && isAllCaps(pn[1]) && pn[1].length < 80) return 0; // "15.1 ELECTRICAL" + its body
      // "…the sum of R____" / "(____ RAND)." — the amount in words runs on, as in the master.
      if (/^\(/.test(plain(p).trim()) && /R\s*_*\S*$/.test(plain(prev).trim())) return 0;
      return runsOn(prev, p) ? 0 : GAP;
    });

    // Never leave a heading alone at the foot of a page. react-pdf's
    // minPresenceAhead is unreliable, so a heading travels with its first
    // paragraph as one unbreakable block — unless that paragraph is so long
    // that moving it whole would leave half a page empty.
    if (sec.heading) {
      const head = sec.numbering ? (
        <View style={[s.row, lineStyle, { marginTop: afterHeadingOnly ? GAP : gapTop() }]} wrap={false} minPresenceAhead={LINE * 2.5}>
          <Text style={[s.bold, { width: g.indent }]}>{`${sec.numbering}.`}</Text>
          <Text style={[s.numText, s.bold]}>{sec.heading}</Text>
        </View>
      ) : (
        // An unnumbered heading is the document's own title (the appendix): flush left.
        <Text style={[s.bold, lineStyle, { marginTop: gapTop() }]} minPresenceAhead={LINE * 2.5}>{sec.heading}</Text>
      );
      if (paras.length > 0 && plain(paras[0]).length <= 300) {
        push(
          <View wrap={false}>
            {React.cloneElement(head, { key: "h" })}
            {React.cloneElement(renderPara(paras[0], 0, gaps[0]), { key: "p" })}
          </View>,
        );
        paras.slice(1).forEach((p, j) => push(renderPara(p, j + 1, gaps[j + 1])));
        first = false;
        return;
      }
      push(head);
    }
    paras.forEach((p, j) => push(renderPara(p, j, gaps[j])));
    first = false;
  });

  const pdf = (
    <Document title={doc.templateLabel} author={agency.name} subject={reference} keywords={reference} producer="Dream OS">
      <Page size="A4" style={[s.page, { paddingTop: g.top, paddingLeft: g.left, paddingRight: g.right, paddingBottom: g.bottom ?? BOTTOM }]}>
        {/* Bronwyn's letterhead: her own header and footer, page 1 and the rest. */}
        <View fixed style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} render={({ pageNumber }) => strips(pageNumber === 1 ? [lh.headerFirst, lh.footerFirst] : [lh.header, lh.footer])} />
        {/* Page 1's header is taller: start its body lower, as Word does. */}
        {g.firstTop !== g.top ? <View style={{ height: g.firstTop - g.top }} /> : null}

        {out}

        {g.pageNumbers ? <Text fixed style={s.pageNo} render={({ pageNumber }) => (pageNumber === 1 ? "" : String(pageNumber))} /> : null}
      </Page>
    </Document>
  );

  return renderToBuffer(pdf);
}

function strips(parts: LetterheadPart[]) {
  return parts.map((p, k) =>
    p ? (
      // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not DOM
      <Image key={k} src={p.src} style={{ position: "absolute", top: p.top, left: 0, width: PAGE_W, height: p.bottom - p.top }} />
    ) : null,
  );
}

function prevSec0(sections: ResolvedSection[], i: number): ResolvedSection | undefined {
  return sections[i - 1];
}

/** Continuation slots ("5.5", "22.1") belong to a numbered clause: their loose paragraphs indent too. */
function isNumberedSection(sec: ResolvedSection): boolean {
  return /^\d+(\.\d+)+/.test(plain(sec.body).trim());
}

export const PDF_PAGE_WIDTH = PAGE_W;
