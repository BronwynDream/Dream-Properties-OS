"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DocContext } from "@/lib/documents/resolve";
import { buildDealContext } from "@/lib/documents/context-deal";
import { finaliseDraft, fileSignedCopy } from "@/lib/documents/finalise";

// Draft actions (plan 019 Arc A4).
//
// saveDraft: snapshot the current structured state into
// document_draft_version, then write the new state and bump version. The
// snapshot happens first so a failed update never loses history.
//
// createDraft: start a document from a template for a property / deal,
// with the record-supplied context already on it, then open the editor.
// Mandates keep their own flow (they also create the mandate row).

export type DraftState = {
  field_values: DocContext;
  clause_selections: Record<string, string>;
  clause_overrides: Record<string, string>;
  omitted_clauses: string[];
};

export async function saveDraft(
  draftId: string,
  next: DraftState,
  note?: string,
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const { data: current, error: readErr } = await supabase
    .from("document_draft")
    .select("id, version, status, field_values, clause_selections, clause_overrides, omitted_clauses, property_id")
    .eq("id", draftId)
    .maybeSingle();
  if (readErr || !current) return { ok: false, error: readErr?.message ?? "Draft not found." };
  if (current.status !== "draft") return { ok: false, error: "This document is final and can no longer be edited." };

  const { error: snapErr } = await supabase.from("document_draft_version").insert({
    draft_id: draftId,
    version: current.version,
    field_values: current.field_values,
    clause_selections: current.clause_selections,
    clause_overrides: current.clause_overrides,
    omitted_clauses: current.omitted_clauses,
    note: note ?? null,
    saved_by: user.id,
  });
  if (snapErr) return { ok: false, error: `Could not keep the previous version: ${snapErr.message}` };

  const nextVersion = (current.version as number) + 1;
  const { error: updErr } = await supabase
    .from("document_draft")
    .update({
      field_values: next.field_values,
      clause_selections: next.clause_selections,
      clause_overrides: next.clause_overrides,
      omitted_clauses: next.omitted_clauses,
      version: nextVersion,
    })
    .eq("id", draftId);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath(`/documents/${draftId}`);
  revalidatePath("/documents");
  if (current.property_id) revalidatePath(`/properties/${current.property_id}`);
  return { ok: true, version: nextVersion };
}

export async function createDraft(input: {
  templateCode: string;
  propertyId: string;
  transferId: string | null;
  listingId: string | null;
}): Promise<{ ok: false; error: string } | never> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const { data: tpl } = await supabase
    .from("doc_template")
    .select("id, label, active")
    .eq("code", input.templateCode)
    .maybeSingle();
  if (!tpl || !tpl.active) return { ok: false, error: `Template ${input.templateCode} is not available.` };

  const { ctx, label } = await buildDealContext(supabase, input.propertyId, input.transferId);

  const { data: draft, error } = await supabase
    .from("document_draft")
    .insert({
      template_id: tpl.id,
      status: "draft",
      property_id: input.propertyId,
      transfer_id: input.transferId,
      listing_id: input.listingId,
      title: `${tpl.label} — ${label}`,
      field_values: ctx,
      clause_selections: {},
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !draft) return { ok: false, error: error?.message ?? "Could not create the document." };

  revalidatePath(`/properties/${input.propertyId}`);
  revalidatePath("/documents");
  redirect(`/documents/${draft.id}`);
}

// A5: freeze the draft as a PDF and file it (lib/documents/finalise.ts).
export async function finaliseDraftAction(draftId: string): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };
  const res = await finaliseDraft(supabase, user.id, draftId);
  if (res.ok) {
    revalidatePath(`/documents/${draftId}`);
    revalidatePath("/documents");
    const { data: d } = await supabase.from("document_draft").select("property_id").eq("id", draftId).maybeSingle();
    if (d?.property_id) revalidatePath(`/properties/${d.property_id}`);
  }
  return res;
}

// A5: the signed copy comes in as a form upload (file input → FormData).
export async function fileSignedCopyAction(draftId: string, form: FormData): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the signed copy first." };
  const bytes = Buffer.from(await file.arrayBuffer());
  const res = await fileSignedCopy(supabase, user.id, draftId, { bytes, mime: file.type, name: file.name });
  if (res.ok) {
    revalidatePath(`/documents/${draftId}`);
    revalidatePath("/documents");
    const { data: d } = await supabase.from("document_draft").select("property_id").eq("id", draftId).maybeSingle();
    if (d?.property_id) revalidatePath(`/properties/${d.property_id}`);
  }
  return res;
}
