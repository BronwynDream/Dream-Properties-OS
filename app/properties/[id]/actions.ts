"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { questionsFor, type PpraFormType } from "@/lib/ppraDisclosure";

async function requireAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "unauthorised" };
  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile?.active === false) {
    return { ok: false as const, error: "admin only" };
  }
  return { ok: true as const, supabase, userId: user.id };
}

// Attach an erf number to a property. Written to be called from the ErfLookup
// flow (satellite-click → point→erf lookup → this action) but works for any
// caller with an admin session.
//
// The insert fires trg_erf_snap_property (migration 0039), which snaps the
// property's lat/lng to the cadastre centroid and stores prcl_key. So one
// call = correct pin position + correct erf assigned.
export async function attachErfToProperty(
  propertyId: string,
  erfNumber: string,
  sgNumber?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile?.active === false) {
    return { ok: false, error: "admin only" };
  }

  const trimmed = (erfNumber ?? "").trim();
  if (!trimmed) return { ok: false, error: "erf number required" };
  if (!propertyId) return { ok: false, error: "propertyId required" };
  const sg = sgNumber ? sgNumber.trim() : null;

  const { error } = await supabase.from("erf").insert({
    property_id: propertyId,
    erf_number: trimmed,
    sg_number: sg,
  });
  if (error) {
    // Unique-constraint violation on (property_id, erf_number, portion) OR
    // the 0041 partial index on the null-portion pair just means the erf is
    // already attached — treat as success but still try to backfill the
    // sg_number if the existing row has none.
    if (error.code === "23505") {
      if (sg) {
        await supabase
          .from("erf")
          .update({ sg_number: sg })
          .eq("property_id", propertyId)
          .eq("erf_number", trimmed)
          .is("sg_number", null);
      }
      return { ok: true };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/map");
  return { ok: true };
}

// Assign an agent to a listing. Admin-only. agentUserId=null clears the
// assignment. Enables the per-agent dashboard scoping (listings show up on
// /dashboard for the assigned agent) and the /mandates scoping.
export async function assignListingAgent(
  listingId: string,
  agentUserId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };
  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" || profile?.active === false) {
    return { ok: false, error: "admin only" };
  }
  if (!listingId) return { ok: false, error: "listingId required" };

  // Guard: if agentUserId is set, verify it points to an active agent so we
  // don't accidentally assign to a director or a deactivated account.
  if (agentUserId) {
    const { data: assignee } = await supabase
      .from("app_user")
      .select("id, role, active")
      .eq("id", agentUserId)
      .single();
    if (!assignee) return { ok: false, error: "unknown user" };
    if (assignee.active === false) return { ok: false, error: "user is inactive" };
    // Allow both 'agent' and 'admin' as valid assignees — Bronwyn / Camilla
    // sometimes co-list a property themselves.
    if (assignee.role !== "agent" && assignee.role !== "admin") {
      return { ok: false, error: `${assignee.role} cannot be assigned` };
    }
  }

  // Look up the property_id before the update so revalidation hits the right
  // Property Record page even for edge-case callers not going through the
  // page-level component.
  const { data: listingRow } = await supabase
    .from("listing")
    .select("property_id")
    .eq("id", listingId)
    .single();

  const { error } = await supabase
    .from("listing")
    .update({ agent_user_id: agentUserId })
    .eq("id", listingId);
  if (error) return { ok: false, error: error.message };

  if (listingRow?.property_id) {
    revalidatePath(`/properties/${listingRow.property_id}`);
  }
  revalidatePath("/dashboard");
  revalidatePath("/mandates");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PPRA Disclosure — Section 67 mandatory form.
//
// Two-step create-or-update: ensurePpraDisclosure is safe to call from the
// UI whenever the form is opened; it creates the header + seeds one answer
// row per canonical question if they don't exist yet. Idempotent.
// Downstream updates use updatePpraAnswer or updatePpraHeader.
// ---------------------------------------------------------------------------

export async function ensurePpraDisclosure(input: {
  transferId: string;
  formType: PpraFormType;
  propertyId: string;
}): Promise<{ ok: true; disclosureId: string } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  if (!input.transferId) return { ok: false, error: "transferId required" };

  const { data: existing } = await supabase
    .from("ppra_disclosure")
    .select("id")
    .eq("transfer_id", input.transferId)
    .eq("form_type", input.formType)
    .maybeSingle();
  let disclosureId = existing?.id as string | undefined;

  if (!disclosureId) {
    const { data: created, error: insErr } = await supabase
      .from("ppra_disclosure")
      .insert({ transfer_id: input.transferId, form_type: input.formType })
      .select("id")
      .single();
    if (insErr || !created) return { ok: false, error: insErr?.message ?? "insert failed" };
    disclosureId = created.id;
  }

  // Backfill any missing canonical rows. New questions added to the
  // library (e.g. plot form rev) show up on old disclosures on next open.
  const canonical = questionsFor(input.formType);
  const { data: existingRows } = await supabase
    .from("ppra_disclosure_answer_row")
    .select("question_key")
    .eq("disclosure_id", disclosureId);
  const have = new Set((existingRows ?? []).map((r: { question_key: string }) => r.question_key));
  const toInsert = canonical
    .filter((q) => !have.has(q.key))
    .map((q) => ({
      disclosure_id: disclosureId!,
      question_key: q.key,
      question_label: q.label,
    }));
  if (toInsert.length > 0) {
    const { error: rowErr } = await supabase.from("ppra_disclosure_answer_row").insert(toInsert);
    if (rowErr) return { ok: false, error: rowErr.message };
  }

  revalidatePath(`/properties/${input.propertyId}`);
  revalidatePath("/compliance");
  return { ok: true, disclosureId: disclosureId! };
}

export async function updatePpraAnswer(input: {
  disclosureId: string;
  questionKey: string;
  answer: "yes" | "no" | "na" | "unanswered";
  explanation?: string | null;
  propertyId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  if (!input.disclosureId || !input.questionKey) {
    return { ok: false, error: "disclosureId + questionKey required" };
  }
  const explanation = (input.explanation ?? "").trim() || null;
  const { error } = await supabase
    .from("ppra_disclosure_answer_row")
    .update({ answer: input.answer, explanation })
    .eq("disclosure_id", input.disclosureId)
    .eq("question_key", input.questionKey);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/properties/${input.propertyId}`);
  revalidatePath("/compliance");
  return { ok: true };
}

export async function updatePpraHeader(input: {
  disclosureId: string;
  signed_at?: string | null;
  signed_by_party_id?: string | null;
  purchaser_ack_at?: string | null;
  additional_info?: string | null;
  propertyId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  const patch: Record<string, unknown> = {};
  if (input.signed_at !== undefined) {
    const v = (input.signed_at ?? "").trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: "signed_at must be YYYY-MM-DD" };
    patch.signed_at = v || null;
  }
  if (input.purchaser_ack_at !== undefined) {
    const v = (input.purchaser_ack_at ?? "").trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: "purchaser_ack_at must be YYYY-MM-DD" };
    patch.purchaser_ack_at = v || null;
  }
  if (input.signed_by_party_id !== undefined) patch.signed_by_party_id = input.signed_by_party_id || null;
  if (input.additional_info !== undefined) patch.additional_info = input.additional_info || null;
  if (Object.keys(patch).length === 0) return { ok: false, error: "nothing to update" };
  const { error } = await supabase.from("ppra_disclosure").update(patch).eq("id", input.disclosureId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/properties/${input.propertyId}`);
  revalidatePath("/compliance");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Certificates of Compliance — electrical / entomologist / gas / electric_fence.
// Uses the existing compliance_cert table (0003_deal.sql). complianceTypeId
// is looked up from the compliance_type seed row by code.
// ---------------------------------------------------------------------------

export async function upsertComplianceCert(input: {
  propertyId: string;
  transferId: string | null;
  code: "electrical" | "entomologist" | "gas" | "electric_fence";
  issuedDate?: string | null;
  expiryDate?: string | null;
  issuer?: string | null;
  notes?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { supabase } = gate;
  if (!input.propertyId) return { ok: false, error: "propertyId required" };

  const { data: type } = await supabase
    .from("compliance_type")
    .select("id, validity_months")
    .eq("code", input.code)
    .single();
  if (!type) return { ok: false, error: `unknown compliance type: ${input.code}` };

  const trimDate = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    if (!s) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`date must be YYYY-MM-DD, got ${s}`);
    return s;
  };
  let issued: string | null, expiry: string | null;
  try {
    issued = trimDate(input.issuedDate);
    expiry = trimDate(input.expiryDate);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  // Auto-derive expiry from issue + validity_months if seller enters only
  // an issue date. Reduces error-prone manual arithmetic on 2y / 6mo / 5y
  // rules of thumb.
  if (issued && !expiry && type.validity_months) {
    const d = new Date(issued + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + type.validity_months);
    expiry = d.toISOString().slice(0, 10);
  }

  const patch = {
    property_id: input.propertyId,
    transfer_id: input.transferId,
    compliance_type_id: type.id,
    issued_date: issued,
    expiry_date: expiry,
    issuer: (input.issuer ?? "").trim() || null,
    notes: (input.notes ?? "").trim() || null,
  };

  // Look up an existing row by (property, transfer, type) — unique combination
  // in practice. Update if present, else insert.
  const { data: existing } = await supabase
    .from("compliance_cert")
    .select("id")
    .eq("property_id", input.propertyId)
    .eq("compliance_type_id", type.id)
    .eq("transfer_id", input.transferId as unknown as string)
    .maybeSingle();

  const { error } = existing?.id
    ? await supabase.from("compliance_cert").update(patch).eq("id", existing.id)
    : await supabase.from("compliance_cert").insert(patch);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/properties/${input.propertyId}`);
  revalidatePath("/compliance");
  return { ok: true };
}
