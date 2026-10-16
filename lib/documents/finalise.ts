import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getDreamAgency } from "@/lib/agency";
import { loadTemplate, resolveDocument, type DocContext } from "./resolve";
import { deriveContext } from "./derive";
import { renderDocumentPdf } from "./pdf";
import { refreshPpraTokens } from "./ppra";
import { dreamLogoBuffer } from "./logo";

// Finalisation and the signed-copy register (plan 019 Arc A5).
//
// finaliseDraft: freeze the draft. Resolve it exactly as the editor does,
// render the PDF, put it in the documents bucket, file it as a `document`
// (status final) linked to the property / transfer / mandate, and stamp the
// draft. From here the draft is read-only; the PDF is what gets signed.
//
// fileSignedCopy: the seller has signed. The agent uploads the scan or phone
// photo; it is filed as a second `document` (status executed) superseding
// the print, linked the same way, and stamped on the draft.
//
// Both take the caller's user-scoped client for the *read* (so RLS decides
// whether this agent may touch this draft) and switch to the service client
// only for the writes that `document` / `document_link` RLS reserves for
// admins — the register is written on the agent's behalf, with their user id
// on every row.

export type DraftForFinalise = {
  id: string;
  title: string | null;
  status: "draft" | "final" | "superseded";
  version: number;
  property_id: string | null;
  transfer_id: string | null;
  listing_id: string | null;
  mandate_id: string | null;
  rendered_document_id: string | null;
  signed_document_id: string | null;
  field_values: DocContext;
  clause_selections: Record<string, string>;
  clause_overrides: Record<string, string>;
  omitted_clauses: string[];
  template: { code: string; label: string; doc_type_id: string | null } | { code: string; label: string; doc_type_id: string | null }[] | null;
};

export const DRAFT_SELECT =
  "id, title, status, version, property_id, transfer_id, listing_id, mandate_id, rendered_document_id, signed_document_id, field_values, clause_selections, clause_overrides, omitted_clauses, template:template_id(code, label, doc_type_id)";

type Result = { ok: true; documentId: string } | { ok: false; error: string };

function one<T>(v: T | T[] | null): T | null {
  return v == null ? null : Array.isArray(v) ? v[0] ?? null : v;
}

function safeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "document";
}

async function linkDocument(service: SupabaseClient, documentId: string, draft: DraftForFinalise, role: string) {
  const links: { document_id: string; entity_type: string; entity_id: string; role: string }[] = [];
  if (draft.property_id) links.push({ document_id: documentId, entity_type: "property", entity_id: draft.property_id, role });
  if (draft.transfer_id) links.push({ document_id: documentId, entity_type: "transfer", entity_id: draft.transfer_id, role });
  if (draft.listing_id) links.push({ document_id: documentId, entity_type: "listing", entity_id: draft.listing_id, role });
  if (draft.mandate_id) links.push({ document_id: documentId, entity_type: "mandate", entity_id: draft.mandate_id, role });
  if (links.length === 0) return;
  const { error } = await service.from("document_link").insert(links);
  if (error) throw new Error(`Filed the PDF but could not link it: ${error.message}`);
}

export async function finaliseDraft(userClient: SupabaseClient, userId: string, draftId: string): Promise<Result> {
  const { data, error: readErr } = await userClient.from("document_draft").select(DRAFT_SELECT).eq("id", draftId).maybeSingle();
  const draft = data as unknown as DraftForFinalise | null;
  if (readErr || !draft) return { ok: false, error: readErr?.message ?? "Draft not found." };
  if (draft.status !== "draft") return { ok: false, error: "This document is already final." };
  const tpl = one(draft.template);
  if (!tpl) return { ok: false, error: "The draft's template is missing." };

  const model = await loadTemplate(userClient, tpl.code);
  if (!model) return { ok: false, error: `Template ${tpl.code} could not be loaded.` };

  const fields = await refreshPpraTokens(userClient, { template_code: tpl.code, transfer_id: draft.transfer_id, property_id: draft.property_id, field_values: draft.field_values ?? {} });
  const ctx = deriveContext(fields);
  const doc = resolveDocument(model, ctx, {
    clause_selections: draft.clause_selections ?? {},
    clause_overrides: draft.clause_overrides ?? {},
    omitted_clauses: draft.omitted_clauses ?? [],
  });

  const agency = await getDreamAgency();
  const logo = dreamLogoBuffer();
  const reference = `Dream OS · ${draft.id.slice(0, 8)} · v${draft.version}`;
  let pdf: Buffer;
  try {
    pdf = await renderDocumentPdf({ doc, agency, logo, reference });
  } catch (e) {
    return { ok: false, error: `Could not render the PDF: ${e instanceof Error ? e.message : String(e)}` };
  }

  const service = createServiceClient();
  const folder = draft.property_id ?? "unfiled";
  const storagePath = `generated/${folder}/${draft.id}-v${draft.version}.pdf`;
  const { error: upErr } = await service.storage.from("documents").upload(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upErr) return { ok: false, error: `Could not store the PDF: ${upErr.message}` };

  const title = draft.title ?? tpl.label;
  const { data: docRow, error: docErr } = await service
    .from("document")
    .insert({
      doc_type_id: tpl.doc_type_id,
      title,
      storage_bucket: "documents",
      storage_path: storagePath,
      mime_type: "application/pdf",
      byte_size: pdf.byteLength,
      status: "final",
      version: draft.version,
      is_pii: false,
      uploaded_by: userId,
    })
    .select("id")
    .single();
  if (docErr || !docRow) return { ok: false, error: `Could not file the PDF: ${docErr?.message ?? "unknown"}` };

  try {
    await linkDocument(service, docRow.id, draft, "generated");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const { error: stampErr } = await service
    .from("document_draft")
    .update({ status: "final", rendered_document_id: docRow.id, finalised_at: new Date().toISOString(), finalised_by: userId })
    .eq("id", draft.id);
  if (stampErr) return { ok: false, error: `PDF filed but the draft could not be marked final: ${stampErr.message}` };

  // A mandate's record points at its paper.
  if (draft.mandate_id) {
    await service.from("mandate").update({ document_id: docRow.id }).eq("id", draft.mandate_id);
  }

  return { ok: true, documentId: docRow.id };
}

const SIGNED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
};

export async function fileSignedCopy(
  userClient: SupabaseClient,
  userId: string,
  draftId: string,
  file: { bytes: Buffer; mime: string; name: string },
): Promise<Result> {
  const ext = SIGNED_TYPES[file.mime];
  if (!ext) return { ok: false, error: "Upload the signed copy as a PDF or a photo (JPEG, PNG, HEIC)." };
  if (file.bytes.byteLength > 25 * 1024 * 1024) return { ok: false, error: "That file is over 25 MB." };

  const { data, error: readErr } = await userClient.from("document_draft").select(DRAFT_SELECT).eq("id", draftId).maybeSingle();
  const draft = data as unknown as DraftForFinalise | null;
  if (readErr || !draft) return { ok: false, error: readErr?.message ?? "Draft not found." };
  if (draft.status !== "final") return { ok: false, error: "Finalise the document before filing the signed copy." };
  const tpl = one(draft.template);

  const service = createServiceClient();
  const folder = draft.property_id ?? "unfiled";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const storagePath = `signed/${folder}/${draft.id}-signed-${stamp}.${ext}`;
  const { error: upErr } = await service.storage.from("documents").upload(storagePath, file.bytes, { contentType: file.mime });
  if (upErr) return { ok: false, error: `Could not store the signed copy: ${upErr.message}` };

  const baseTitle = draft.title ?? tpl?.label ?? safeName(file.name);
  const { data: docRow, error: docErr } = await service
    .from("document")
    .insert({
      doc_type_id: tpl?.doc_type_id ?? null,
      title: `${baseTitle} — signed`,
      storage_bucket: "documents",
      storage_path: storagePath,
      mime_type: file.mime,
      byte_size: file.bytes.byteLength,
      status: "executed",
      version: draft.version,
      supersedes_id: draft.rendered_document_id,
      is_pii: false,
      uploaded_by: userId,
    })
    .select("id")
    .single();
  if (docErr || !docRow) return { ok: false, error: `Could not file the signed copy: ${docErr?.message ?? "unknown"}` };

  try {
    await linkDocument(service, docRow.id, draft, "signed");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // The print is superseded by the signed copy.
  if (draft.rendered_document_id) {
    await service.from("document").update({ status: "superseded" }).eq("id", draft.rendered_document_id);
  }
  const { error: stampErr } = await service
    .from("document_draft")
    .update({ signed_document_id: docRow.id, signed_at: new Date().toISOString(), signed_by: userId })
    .eq("id", draft.id);
  if (stampErr) return { ok: false, error: `Signed copy filed but the draft could not be stamped: ${stampErr.message}` };

  if (draft.mandate_id) {
    await service.from("mandate").update({ document_id: docRow.id }).eq("id", draft.mandate_id);
  }

  return { ok: true, documentId: docRow.id };
}

/** Short-lived download link for a filed document the caller may read. */
export async function signedDownloadUrl(userClient: SupabaseClient, documentId: string): Promise<string | null> {
  const { data: doc } = await userClient.from("document").select("storage_bucket, storage_path").eq("id", documentId).maybeSingle();
  if (!doc) return null;
  const { data } = await userClient.storage.from(doc.storage_bucket).createSignedUrl(doc.storage_path, 300);
  return data?.signedUrl ?? null;
}
