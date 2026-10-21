import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { deskUser, documentAccess } from "@/lib/ficaDesk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/fica/doc/<documentId> — opens a document for the FICA desk.
//   * FICA, company and certificate documents: a 2-minute signed link.
//   * An agreement of sale: page 2 ONLY (the parties), cut out of the PDF
//     here on the server as an image. The rest of the agreement never leaves
//     the server.
//     Simon, 2026-10-21: "should only access the second page of any sale
//     agreement".
//   * Anything else: refused.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deny = (msg: string, status = 403) =>
  new NextResponse(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const me = await deskUser();
  if (!me) return deny("Not available.", 401);
  if (!UUID.test(params.id)) return deny("Not found.", 404);
  const svc = createServiceClient();
  const acc = await documentAccess(svc, params.id);
  if (!acc) return deny("This document isn't available on the FICA desk.");

  if (acc.mode === "full") {
    const { data, error } = await svc.storage.from(acc.bucket).createSignedUrl(acc.path, 120);
    if (error || !data) return deny("Couldn't open the file.", 500);
    return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "cache-control": "no-store" } });
  }

  // page 2 only
  const isPdf = (acc.mime ?? "").includes("pdf") || acc.path.toLowerCase().endsWith(".pdf");
  if (!isPdf) return deny("Only PDF agreements can show page 2. Ask the agent for a PDF copy.", 415);
  const { data: blob, error } = await svc.storage.from(acc.bucket).download(acc.path);
  if (error || !blob) return deny("Couldn't open the file.", 500);
  try {
    // Page 2 is RENDERED to an image and placed in a fresh PDF. Copying the
    // page with pdf-lib was tested and rejected: form fields shared across
    // pages drag the other pages' objects (and their contents) into the copy.
    // An image of page 2 carries nothing else: no text layer, fields,
    // attachments, metadata or other pages.
    const mupdf = await import("mupdf");
    const src = mupdf.Document.openDocument(new Uint8Array(await blob.arrayBuffer()), "application/pdf");
    if (src.countPages() < 2) return deny("This agreement has no page 2.", 404);
    const page = src.loadPage(1);
    const [x0, y0, x1, y1] = page.getBounds();
    const png = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true).asPNG();
    const { PDFDocument } = await import("pdf-lib");
    const out = await PDFDocument.create();
    const img = await out.embedPng(png);
    const w = x1 - x0, h = y1 - y0;
    out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    out.setTitle("Agreement of sale: page 2 (parties)");
    out.setProducer("Dream OS FICA desk");
    const bytes = await out.save();
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="page-2-parties.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return deny("Couldn't read that PDF.", 500);
  }
}
