import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ResolvedDocument } from "./resolve";
import type { AgencyIdentity } from "@/lib/agency";
import { matchNumbered, matchLabelRow, isAllCaps, tidy } from "./layout";

// Server-side PDF of a resolved document (plan 019 Arc A5).
//
// This is the frozen record: what the agent printed and the seller signed.
// It is rendered from the same ResolvedDocument the editor shows, with the
// agency letterhead and the PPRA footer, so screen and paper never drift.
//
// Fonts are the PDF built-ins (Helvetica) on purpose: no network fetch at
// render time, identical output on Vercel and locally. Colours follow the
// Blueprint look (2026-10-16): Dream blue title, slate ink, cool hairlines.
// Layout conventions read from the clause bodies: "2.1<tab>text" is a
// numbered sub-clause with a hanging indent, "Label:<tab>value" is a
// contract-information row, a short all-caps line is a sub-heading.

const PAGE_W = 595.28; // A4 pt
const MARGIN = 56;

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 64, paddingHorizontal: MARGIN, fontFamily: "Helvetica", fontSize: 10.5, lineHeight: 1.45, color: "#1B2236" },
  letterhead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: "#DEE3EF", paddingBottom: 10, marginBottom: 22 },
  logo: { width: 96, height: 48, objectFit: "contain" },
  identity: { alignItems: "flex-end" },
  agencyName: { fontFamily: "Helvetica-Bold", fontSize: 11.5 },
  agencyLine: { fontSize: 8.5, color: "#5F6883", marginTop: 2 },
  ffc: { fontFamily: "Courier", fontSize: 8, color: "#5F6883", marginTop: 4 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 14, letterSpacing: 0.6, marginBottom: 12, color: "#122E87" },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginTop: 10, marginBottom: 4 },
  para: { marginBottom: 7 }, // left-aligned: justify stretches lines that end in a hard break (blanks, "dated ___")
  row: { marginBottom: 6, fontFamily: "Courier", fontSize: 9.5 },
  subhead: { fontFamily: "Helvetica-Bold", marginBottom: 6, marginTop: 4 },
  // "Full Names:<tab>value" — the contract-information table.
  kv: { flexDirection: "row", marginBottom: 4 },
  kvLabel: { width: 160, paddingRight: 8, fontSize: 9.5, color: "#5F6883" },
  kvValue: { flex: 1 },
  // "2.1<tab>text" — numbered sub-clause with a hanging indent.
  num: { flexDirection: "row", marginBottom: 7 },
  numLabel: { width: 34 },
  numText: { flex: 1 },
  footer: { position: "absolute", left: MARGIN, right: MARGIN, bottom: 24, borderTopWidth: 0.5, borderTopColor: "#DEE3EF", paddingTop: 6, fontSize: 7.5, color: "#6B7490" },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
});

// "Seller:  ________" style fill-in lines; numbered sub-clauses with a
// blank inside prose stay in the body face.
const FILL_LINE_RE = /^[^\n]{0,40}:?\s*_{6,}\s*$/;
/** A section this short never splits across a page. */
const KEEP_TOGETHER_CHARS = 700;

function norm(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function renderDocumentPdf(args: {
  doc: ResolvedDocument;
  agency: AgencyIdentity;
  logo: Buffer | null;
  reference: string; // printed in the footer: "Dream OS · <draft id short> · v<n>"
}): Promise<Buffer> {
  const { doc, agency, logo, reference } = args;
  const sections = doc.sections.filter((x) => x.included);

  const pdf = (
    <Document title={doc.templateLabel} author={agency.name} producer="Dream OS">
      <Page size="A4" style={s.page}>
        <View style={s.letterhead} fixed>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image, not DOM */}
          {logo ? <Image src={{ data: logo, format: "png" }} style={s.logo} /> : <Text style={s.agencyName}>{agency.name}</Text>}
          <View style={s.identity}>
            <Text style={s.agencyName}>{agency.name}</Text>
            {agency.address ? <Text style={s.agencyLine}>{agency.address}</Text> : null}
            {(agency.phone || agency.email) ? <Text style={s.agencyLine}>{[agency.phone, agency.email].filter(Boolean).join("  ·  ")}</Text> : null}
            {agency.ffcNo ? <Text style={s.ffc}>PPRA FFC #{agency.ffcNo}</Text> : null}
          </View>
        </View>

        {sections.map((sec, i) => {
          // A heading-only clause ("15. CERTIFICATES OF COMPLIANCE") is
          // printed with the clause that follows it, never on its own.
          if (!sec.body.trim() && sec.heading) return null;
          const prev = sections[i - 1];
          const carried = prev && !prev.body.trim() && prev.heading ? prev : null;
          let paras = sec.body.split(/\n\s*\n/).map((p) => p.replace(/\s+$/, ""));
          if (sec.heading && paras.length > 1 && norm(paras[0]) === norm(sec.heading)) paras = paras.slice(1);
          const render = (p: string, j: number) => {
            const isTitle = i === 0 && j === 0 && !sec.heading && isAllCaps(p) && p.length < 90;
            if (isTitle) return <Text key={j} style={s.title}>{p}</Text>;
            if (FILL_LINE_RE.test(p)) return <Text key={j} style={s.row}>{p.replace(/\t+/g, "   ")}</Text>;
            const num = matchNumbered(p);
            if (num) {
              const text = num[1];
              return (
                <View key={j} style={s.num}>
                  <Text style={s.numLabel}>{num[0]}</Text>
                  <Text style={[s.numText, isAllCaps(text) && text.length < 80 ? { fontFamily: "Helvetica-Bold" } : {}]}>{text}</Text>
                </View>
              );
            }
            const kv = matchLabelRow(p);
            if (kv) {
              return (
                <View key={j} style={s.kv} wrap={false}>
                  <Text style={s.kvLabel}>{kv[0]}</Text>
                  <Text style={s.kvValue}>{kv[1]}</Text>
                </View>
              );
            }
            if (isAllCaps(p) && p.length < 80) return <Text key={j} style={s.subhead}>{p}</Text>;
            return <Text key={j} style={s.para}>{tidy(p)}</Text>;
          };
          // Keep a heading with its first paragraph so a page never ends on
          // a bare clause number.
          const [first, ...rest] = paras;
          return (
            <View key={sec.slotId} wrap={sec.body.length > KEEP_TOGETHER_CHARS}>
              <View wrap={false}>
                {carried ? (
                  <Text style={s.heading}>{carried.numbering ? `${carried.numbering}. ` : ""}{carried.heading}</Text>
                ) : null}
                {sec.heading ? (
                  <Text style={s.heading}>{sec.numbering ? `${sec.numbering}. ` : ""}{sec.heading}</Text>
                ) : null}
                {first != null ? render(first, 0) : null}
              </View>
              {rest.map((p, j) => render(p, j + 1))}
            </View>
          );
        })}

        <View style={s.footer} fixed>
          <Text>{agency.ppraLine}</Text>
          <View style={s.footerRow}>
            <Text>{reference}</Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </View>
      </Page>
    </Document>
  );

  return renderToBuffer(pdf);
}

export const PDF_PAGE_WIDTH = PAGE_W;
