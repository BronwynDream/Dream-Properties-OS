"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { DocContext } from "@/lib/documents/resolve";

// Save a prepared mandate (plan 019 Arc A2).
//
// Two rows, one action:
//   1. `mandate` — the record the pipeline, expiry watchlist and map read.
//      Financial terms go into the typed columns migration 0065 added
//      (asking_price, commission_pct, term_months); the Phase-1 notes
//      string is kept for anything the columns don't carry.
//   2. `document_draft` — what the agent actually generated: template,
//      every field value, and which clause variant filled every slot. This
//      is the first time a generated document is kept. A4 adds versioned
//      edits on top of it; A5 renders it to PDF and files it.
//
// Commission is always exclusive of VAT at Dream ("plus VAT thereon",
// decided 2026-09-28), so commission_incl_vat is written false.

export async function saveMandate(input: {
  listingId: string;
  propertyId: string;
  templateId: string;
  type: "exclusive" | "joint" | "open";
  signedDate: string;
  expiryDate: string | null;
  termMonths: number;
  askingPrice: number | null;
  commissionPct: number;
  jointAgencyName: string | null;
  title: string;
  fieldValues: DocContext;
  clauseSelections: Record<string, string>;
}): Promise<{ ok: true; mandateId: string; draftId: string | null } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const notesParts: string[] = [];
  if (input.type === "joint" && input.jointAgencyName) notesParts.push(`Joint with: ${input.jointAgencyName}`);

  const { data: newMandate, error } = await supabase
    .from("mandate")
    .insert({
      listing_id: input.listingId,
      type: input.type,
      // The agent prints this for the seller to sign, then uploads the
      // signed copy (A5). Evidence form is the target, not the current state.
      evidence: "signed_pdf",
      signed_date: input.signedDate,
      expiry_date: input.expiryDate,
      asking_price: input.askingPrice,
      commission_pct: input.commissionPct,
      commission_incl_vat: false,
      term_months: Math.round(input.termMonths),
      notes: notesParts.length ? notesParts.join(" · ") : null,
    })
    .select("id")
    .single();

  if (error || !newMandate) {
    return { ok: false, error: error?.message ?? "Could not save mandate." };
  }

  // The draft is best-effort: a failure here must not lose the mandate row.
  let draftId: string | null = null;
  const { data: draft, error: draftErr } = await supabase
    .from("document_draft")
    .insert({
      template_id: input.templateId,
      status: "draft",
      property_id: input.propertyId,
      listing_id: input.listingId,
      mandate_id: newMandate.id,
      title: input.title,
      field_values: input.fieldValues,
      clause_selections: input.clauseSelections,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (draftErr) {
    // eslint-disable-next-line no-console
    console.warn(`[saveMandate] document_draft insert failed: ${draftErr.message}`);
  } else {
    draftId = draft?.id ?? null;
  }

  // Bump listing status to 'live' when it was still 'draft' — a mandate
  // exists now, marketing can start. Skip when already live/under_offer.
  await supabase
    .from("listing")
    .update({ status: "live" })
    .eq("id", input.listingId)
    .eq("status", "draft");

  revalidatePath(`/properties/${input.propertyId}`);
  revalidatePath("/mandates");
  revalidatePath("/dashboard");
  return { ok: true, mandateId: newMandate.id, draftId };
}
