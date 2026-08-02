"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Save a prepared mandate against a listing. Phase 1 stores the mandate row
// (type + dates + terms captured on the form); the printable output stays
// browser-side for now (agent prints from the render page). When we add
// html→PDF, this action will also upload the file to the `documents` bucket
// and insert `document` + `document_link` rows referencing the mandate.
//
// Notes column captures the ad-hoc financial terms (asking price + commission
// %) as a structured line — those aren't yet columns on the mandate table
// and adding a migration for phase 1 would front-load schema churn. A later
// pass can normalise them into typed columns.

export async function saveMandate(input: {
  listingId: string;
  type: "sole" | "joint";
  signedDate: string;
  expiryDate: string;
  askingPrice: number | null;
  commissionPct: number;
  commissionInclVat: boolean;
  jointAgencyName: string | null;
  propertyId: string;
}): Promise<
  | { ok: true; mandateId: string }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const notesParts: string[] = [];
  if (input.askingPrice != null) {
    notesParts.push(`Asking price: R ${input.askingPrice.toLocaleString("en-ZA")}`);
  }
  notesParts.push(
    `Commission: ${input.commissionPct}% ${input.commissionInclVat ? "incl VAT" : "excl VAT"}`,
  );
  if (input.type === "joint" && input.jointAgencyName) {
    notesParts.push(`Joint with: ${input.jointAgencyName}`);
  }

  const { data: newMandate, error } = await supabase
    .from("mandate")
    .insert({
      listing_id: input.listingId,
      type: input.type,
      // Evidence stays 'signed_pdf' as the assumed target format — the agent
      // will hand the printed doc to the seller to sign, then upload the
      // signed PDF later. Adjust downstream if the workflow branches.
      evidence: "signed_pdf",
      signed_date: input.signedDate,
      expiry_date: input.expiryDate,
      notes: notesParts.join(" · "),
    })
    .select("id")
    .single();

  if (error || !newMandate) {
    return { ok: false, error: error?.message ?? "Could not save mandate." };
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
  return { ok: true, mandateId: newMandate.id };
}
