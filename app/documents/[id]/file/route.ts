import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signedDownloadUrl } from "@/lib/documents/finalise";

// GET /documents/[id]/file?which=print|signed → redirects to a short-lived
// signed URL for the filed PDF / signed copy (plan 019 A5). Going through
// the draft (not the document id) keeps the editor's links stable and lets
// draft RLS decide who may fetch.

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const which = new URL(req.url).searchParams.get("which") === "signed" ? "signed" : "print";
  const { data: draft } = await supabase
    .from("document_draft")
    .select("rendered_document_id, signed_document_id")
    .eq("id", params.id)
    .maybeSingle();
  const documentId = which === "signed" ? draft?.signed_document_id : draft?.rendered_document_id;
  if (!documentId) return new NextResponse("No file on record for this document yet.", { status: 404 });

  const url = await signedDownloadUrl(supabase, documentId);
  if (!url) return new NextResponse("The file could not be fetched from storage.", { status: 404 });
  return NextResponse.redirect(url, 302);
}
