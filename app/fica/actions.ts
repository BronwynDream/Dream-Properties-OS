"use server";

import { createHmac, timingSafeEqual } from "crypto";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { deskUser, EDITABLE_PARTY_FIELDS, UPLOAD_CATEGORIES } from "@/lib/ficaDesk";

// FICA desk writes (2026-10-21). Every action re-checks the caller is the
// compliance user or a director, then writes with the service key — but only
// to the fields and rows listed here.

type Res = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids = (...v: (string | null | undefined)[]) => v.every((x) => x == null || UUID.test(x));

const MARITAL = ["single", "married_in_community", "married_anc_no_accrual", "married_anc_with_accrual", "foreign_marriage", "divorced", "widowed", "unknown"];
const FICA_STATUS = ["outstanding", "received", "verified", "expired"];
const FICA_RISK = ["low", "medium", "high"];
const TAX_RESIDENCY = ["resident", "non_resident", "unknown"];
const SIDES = ["seller", "purchaser"];

// An upload ticket ties the storage path startUpload handed out to this user
// and this deal, so finishUpload can't be pointed at someone else's file
// (security review 2026-10-21).
function ticket(path: string, userId: string, transferId: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHmac("sha256", `fica-upload:${key}`).update(`${path}|${userId}|${transferId}`).digest("hex");
}
function ticketOk(sig: string, path: string, userId: string, transferId: string) {
  const want = Buffer.from(ticket(path, userId, transferId));
  const got = Buffer.from(sig || "");
  return got.length === want.length && timingSafeEqual(got, want);
}

async function onDeal(transferId: string, partyId: string, side?: string) {
  const svc = createServiceClient();
  if (side && !SIDES.includes(side)) return null;
  let q = svc.from("transfer_party").select("side, transfer:transfer_id(property_id)").eq("transfer_id", transferId).eq("party_id", partyId);
  if (side) q = q.eq("side", side);
  const { data } = await q.limit(1).maybeSingle();
  const row = data as unknown as { side: string; transfer: { property_id: string } | null } | null;
  return row ? { svc, side: row.side, propertyId: row.transfer?.property_id ?? null } : null;
}

export async function savePartyDetails(input: { transferId: string; partyId: string; fields: Record<string, unknown> }): Promise<Res> {
  if (!ids(input.transferId, input.partyId)) return { ok: false, error: "Bad reference." };
  const me = await deskUser();
  if (!me) return { ok: false, error: "Only compliance and directors can change these details." };
  const ctx = await onDeal(input.transferId, input.partyId);
  if (!ctx) return { ok: false, error: "That person isn't on this deal." };
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE_PARTY_FIELDS) {
    if (!(k in input.fields)) continue;
    let v = input.fields[k];
    if (k === "is_vat_registered") v = v === true || v === "true" || v === "on";
    else if (typeof v === "string") v = v.trim() === "" ? null : v.trim().slice(0, 500);
    else if (v != null) return { ok: false, error: `Unexpected value for ${k}.` };
    if (k === "tax_residency") {
      if (v == null) v = "unknown";
      if (!TAX_RESIDENCY.includes(String(v))) return { ok: false, error: "Choose a tax residency from the list." };
    }
    if (k === "matrimonial_regime") {
      if (v == null) v = "unknown";
      if (!MARITAL.includes(String(v))) return { ok: false, error: "Choose a marital status from the list." };
    }
    if (k === "date_of_birth" && v != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return { ok: false, error: "Date of birth must be a date." };
    if (k === "id_number" && v != null && !/^[0-9 ]{6,20}$/.test(String(v))) return { ok: false, error: "An SA ID number is 13 digits." };
    patch[k] = v;
  }
  if (!Object.keys(patch).length) return { ok: true };
  // Keep the display name in step with a corrected name.
  const { data: cur } = await ctx.svc.from("party").select("party_type, first_names, surname, entity_name").eq("id", input.partyId).single();
  if (cur) {
    const m = { ...cur, ...patch } as Record<string, unknown>;
    const name = cur.party_type === "individual" ? [m.first_names, m.surname].filter(Boolean).join(" ") : String(m.entity_name ?? "");
    if (("first_names" in patch || "surname" in patch || "entity_name" in patch) && name.trim()) patch.display_name = name.trim();
  }
  const { error } = await ctx.svc.from("party").update(patch).eq("id", input.partyId);
  if (error) return { ok: false, error: `Couldn't save: ${error.message}` };
  revalidatePath(`/fica/${input.transferId}`);
  return { ok: true };
}

export async function setFica(input: { transferId: string; partyId: string; side: string; status: string; risk?: string; notes?: string; sourceOfFunds?: string }): Promise<Res> {
  if (!ids(input.transferId, input.partyId)) return { ok: false, error: "Bad reference." };
  const me = await deskUser();
  if (!me) return { ok: false, error: "Only compliance and directors can change FICA status." };
  if (!FICA_STATUS.includes(input.status)) return { ok: false, error: "Unknown FICA status." };
  if (input.risk && !FICA_RISK.includes(input.risk)) return { ok: false, error: "Unknown risk level." };
  const ctx = await onDeal(input.transferId, input.partyId, input.side);
  if (!ctx) return { ok: false, error: "That person isn't on this deal." };
  const row: Record<string, unknown> = {
    transfer_id: input.transferId,
    party_id: input.partyId,
    role: ctx.side,
    status: input.status,
    notes: input.notes?.trim() ? input.notes.trim().slice(0, 2000) : null,
    source_of_funds: input.sourceOfFunds?.trim() ? input.sourceOfFunds.trim().slice(0, 500) : null,
    verified_by: input.status === "verified" ? me.id : null,
    verified_at: input.status === "verified" ? new Date().toISOString() : null,
  };
  // Re-saving notes on an already-verified record keeps who verified it and when.
  const { data: prev } = await ctx.svc.from("fica").select("status, verified_by, verified_at").eq("transfer_id", input.transferId).eq("party_id", input.partyId).eq("role", ctx.side).maybeSingle();
  if (input.status === "verified" && prev?.status === "verified" && prev.verified_at) {
    row.verified_by = prev.verified_by;
    row.verified_at = prev.verified_at;
  }
  if (input.risk) row.risk = input.risk;
  const { error } = await ctx.svc.from("fica").upsert(row, { onConflict: "transfer_id,party_id,role" });
  if (error) return { ok: false, error: `Couldn't save: ${error.message}` };
  revalidatePath(`/fica/${input.transferId}`);
  revalidatePath("/fica");
  return { ok: true };
}

const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, "_").replace(/\.{2,}/g, ".").replace(/\s+/g, " ").slice(0, 120);

async function uploadType(svc: ReturnType<typeof createServiceClient>, docTypeId: string) {
  const { data } = await svc.from("document_type").select("id, category, is_pii_default").eq("id", docTypeId).maybeSingle();
  if (!data || !(UPLOAD_CATEGORIES as readonly string[]).includes(String(data.category))) return null;
  return data as { id: string; category: string; is_pii_default: boolean };
}

/** Step 1: a one-off upload address in the documents bucket. */
export async function startUpload(input: { transferId: string; partyId: string | null; side?: string | null; fileName: string; docTypeId: string }): Promise<{ ok: true; path: string; token: string; ticket: string } | { ok: false; error: string }> {
  if (!ids(input.transferId, input.partyId, input.docTypeId)) return { ok: false, error: "Bad reference." };
  const me = await deskUser();
  if (!me) return { ok: false, error: "Only compliance and directors can upload here." };
  const svc = createServiceClient();
  const { data: t } = await svc.from("transfer").select("property_id").eq("id", input.transferId).maybeSingle();
  if (!t) return { ok: false, error: "That deal no longer exists." };
  if (input.partyId && !(await onDeal(input.transferId, input.partyId, input.side ?? undefined))) return { ok: false, error: "That person isn't on this deal." };
  if (!(await uploadType(svc, input.docTypeId))) return { ok: false, error: "Choose a FICA, company or certificate document type." };
  const path = `uploads/${t.property_id}/${crypto.randomUUID()}-${safeName(input.fileName || "document")}`;
  const { data, error } = await svc.storage.from("documents").createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: `Couldn't start the upload: ${error?.message ?? "unknown"}` };
  return { ok: true, path, token: data.token, ticket: ticket(path, me.id, input.transferId) };
}

/** Step 2: record the uploaded file and file it on the deal (and the person). */
export async function finishUpload(input: { transferId: string; partyId: string | null; side?: string | null; path: string; ticket: string; name: string; size: number; mime: string | null; docTypeId: string }): Promise<Res> {
  if (!ids(input.transferId, input.partyId, input.docTypeId)) return { ok: false, error: "Bad reference." };
  const me = await deskUser();
  if (!me) return { ok: false, error: "Only compliance and directors can upload here." };
  const svc = createServiceClient();
  const { data: t } = await svc.from("transfer").select("property_id").eq("id", input.transferId).maybeSingle();
  if (!t) return { ok: false, error: "That deal no longer exists." };
  if (!input.path.startsWith(`uploads/${t.property_id}/`) || input.path.includes("..") || !ticketOk(input.ticket, input.path, me.id, input.transferId)) {
    return { ok: false, error: "That file wasn't uploaded for this deal." };
  }
  const { data: taken } = await svc.from("document").select("id").eq("storage_bucket", "documents").eq("storage_path", input.path).limit(1);
  if (taken?.length) return { ok: false, error: "That file is already filed." };
  const party = input.partyId ? await onDeal(input.transferId, input.partyId, input.side ?? undefined) : null;
  if (input.partyId && !party) return { ok: false, error: "That person isn't on this deal." };
  const dt = await uploadType(svc, input.docTypeId);
  if (!dt) return { ok: false, error: "Choose a FICA, company or certificate document type." };
  const { data: doc, error } = await svc
    .from("document")
    .insert({
      doc_type_id: dt.id,
      title: input.name.slice(0, 200),
      storage_bucket: "documents",
      storage_path: input.path,
      mime_type: input.mime,
      byte_size: input.size,
      status: "final",
      is_pii: !!dt.is_pii_default || dt.category === "fica",
      uploaded_by: me.id,
    })
    .select("id")
    .single();
  if (error || !doc) return { ok: false, error: `Couldn't file it: ${error?.message ?? "unknown"}` };
  const links = [
    { document_id: doc.id, entity_type: "transfer", entity_id: input.transferId },
    { document_id: doc.id, entity_type: "property", entity_id: t.property_id },
  ];
  if (input.partyId) links.push({ document_id: doc.id, entity_type: "party", entity_id: input.partyId });
  await svc.from("document_link").insert(links);
  if (party && dt.category !== "compliance") await markReceived(svc, input.transferId, input.partyId!, party.side);
  revalidatePath(`/fica/${input.transferId}`);
  return { ok: true };
}

async function markReceived(svc: ReturnType<typeof createServiceClient>, transferId: string, partyId: string, side: string) {
  const { data } = await svc.from("fica").select("id, status").eq("transfer_id", transferId).eq("party_id", partyId).eq("role", side).maybeSingle();
  if (!data) await svc.from("fica").insert({ transfer_id: transferId, party_id: partyId, role: side, status: "received" });
  else if (data.status === "outstanding") await svc.from("fica").update({ status: "received" }).eq("id", data.id);
}

/** Attach an unassigned FICA document on the deal to one of its people. */
export async function assignDocument(input: { transferId: string; partyId: string; side: string; documentId: string }): Promise<Res> {
  if (!ids(input.transferId, input.partyId, input.documentId)) return { ok: false, error: "Bad reference." };
  const me = await deskUser();
  if (!me) return { ok: false, error: "Only compliance and directors can do this." };
  const ctx = await onDeal(input.transferId, input.partyId, input.side);
  if (!ctx) return { ok: false, error: "That person isn't on this deal." };
  // A paper filed on an earlier deal on the same property (a previous
  // owner's ID) must not be attached to this deal's people.
  const { data: otherDeal } = await ctx.svc.from("document_link").select("entity_id").eq("document_id", input.documentId).eq("entity_type", "transfer").neq("entity_id", input.transferId).limit(1);
  if (otherDeal?.length) return { ok: false, error: "That document belongs to another deal on this property." };
  const { data: d } = await ctx.svc.from("document").select("id, doc_type:doc_type_id(category)").eq("id", input.documentId).maybeSingle();
  const cat = (d as unknown as { doc_type: { category: string | null } | null } | null)?.doc_type?.category;
  if (!d || (cat !== "fica" && cat !== "company")) return { ok: false, error: "Only FICA and company documents can be assigned to a person." };
  const { data: onIt } = await ctx.svc
    .from("document_link")
    .select("id")
    .eq("document_id", input.documentId)
    .or(`and(entity_type.eq.transfer,entity_id.eq.${input.transferId}),and(entity_type.eq.property,entity_id.eq.${ctx.propertyId})`)
    .limit(1);
  if (!onIt?.length) return { ok: false, error: "That document isn't on this deal." };
  const { error } = await ctx.svc.from("document_link").upsert({ document_id: input.documentId, entity_type: "party", entity_id: input.partyId }, { onConflict: "document_id,entity_type,entity_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  await markReceived(ctx.svc, input.transferId, input.partyId, ctx.side);
  revalidatePath(`/fica/${input.transferId}`);
  return { ok: true };
}
