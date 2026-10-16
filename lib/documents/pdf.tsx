import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ResolvedDocument } from "./resolve";
import type { AgencyIdentity } from "@/lib/agency";

// Server-side PDF of a resolved document (plan 019 Arc A5).
//
// This is the frozen record: what the agent printed and the seller signed.
// It is rendered from the same ResolvedDocument the editor shows, with the
// agency letterhead and the PPRA footer, so screen and paper never drift.
//
// Fonts are the PDF built-ins (Helvetica, Times) on purpose: no network
// fetch at render time, identical output on Vercel and locally, and a
// classic serif title that sits with Dream's wordmark. When the new look is
// chosen, the letterhead here is the one place to change.

const PAGE_W = 595.28; // A4 pt
const MARGIN = 56;

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 64, paddingHorizontal: MARGIN, fontFamily: "Helvetica", fontSize: 10.5, lineHeight: 1.45, color: "#1F1B16" },
  letterhead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: "#D8CFBE", paddingBottom: 10, marginBottom: 22 },
  logo: { width: 96, height: 48, objectFit: "contain" },
  identity: { alignItems: "flex-end" },
  agencyName: { fontFamily: "Helvetica-Bold", fontSize: 11.5 },
  agencyLine: { fontSize: 8.5, color: "#6B6153", marginTop: 2 },
  ffc: { fontFamily: "Courier", fontSize: 8, color: "#6B6153", marginTop: 4 },
  title: { fontFamily: "Times-Bold", fontSize: 14, letterSpacing: 0.3, marginBottom: 12 },
  heading: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginTop: 10, marginBottom: 4 },
  para: { marginBottom: 7 }, // left-aligned: justify stretches lines that end in a hard break (blanks, "dated ___")
  row: { marginBottom: 6, fontFamily: "Courier", fontSize: 9.5 },
  footer: { position: "absolute", left: MARGIN, right: MARGIN, bottom: 24, borderTopWidth: 0.5, borderTopColor: "#D8CFBE", paddingTop: 6, fontSize: 7.5, color: "#8C8172" },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
});

// "Seller:  ________" style fill-in lines; numbered sub-clauses with a
// blank inside prose stay in the body face.
const FILL_LINE_RE = /^[^\n]{0,40}:?\s*_{6,}\s*$/;

function isAllCaps(p: string): boolean {
  const letters = p.replace(/[^A-Za-z]/g, "");
  return letters.length > 3 && letters === letters.toUpperCase();
}
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
          let paras = sec.body.split(/\n\s*\n/).map((p) => p.replace(/\s+$/, ""));
          if (sec.heading && paras.length > 1 && norm(paras[0]) === norm(sec.heading)) paras = paras.slice(1);
          const render = (p: string, j: number) => {
            const isTitle = i === 0 && j === 0 && !sec.heading && isAllCaps(p) && p.length < 90;
            const isRow = FILL_LINE_RE.test(p);
            if (isTitle) return <Text key={j} style={s.title}>{p}</Text>;
            if (isRow) return <Text key={j} style={s.row}>{p.replace(/\t+/g, "   ")}</Text>;
            return <Text key={j} style={s.para}>{p.replace(/\t+/g, "  ")}</Text>;
          };
          // Keep a heading with its first paragraph so a page never ends on
          // a bare clause number.
          const [first, ...rest] = paras;
          return (
            <View key={sec.slotId} wrap>
              <View wrap={false}>
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
