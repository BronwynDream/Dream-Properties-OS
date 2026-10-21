import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// The FICA desk's data layer (2026-10-21, migration 0090).
//
// The compliance user is not staff: RLS gives her nothing. Everything she sees
// comes through here, read with the service key AFTER deskUser() has checked
// her role, and only from the columns listed below. Never add a select of
// commission, offer, agreement, mandate, transfer.name (it carries the buyer
// and seller names in one string), or any price other than the listing's
// public asking price. Simon, 2026-10-21: "This role cannot have access to any
// commission information or any agreement of sale information, and should
// only access the second page of any sale agreement."

export type DeskRole = "admin" | "compliance";
export type DeskUser = { id: string; role: DeskRole; name: string | null };

export async function deskUser(): Promise<DeskUser | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const svc = createServiceClient();
  const { data } = await svc.from("app_user").select("role, active, full_name").eq("id", user.id).maybeSingle();
  if (!data?.active) return null;
  const role = String(data.role);
  if (role !== "admin" && role !== "compliance") return null;
  return { id: user.id, role: role as DeskRole, name: (data.full_name as string | null) ?? null };
}

// ---------------------------------------------------------------------------
// What the desk may show

/** Document types the desk may open in full. */
export const VIEWABLE_CATEGORIES = ["fica", "company", "compliance"] as const;
/** Document types the desk may upload (and assign to a person). */
export const UPLOAD_CATEGORIES = ["fica", "company", "compliance"] as const;
/** Agreements whose page 2 (the parties) the desk may see — and nothing else of them. */
export const PAGE_TWO_CODES = ["agreement_of_sale", "land_freehold_agreement"] as const;

export const isViewable = (category: string | null | undefined) => !!category && (VIEWABLE_CATEGORIES as readonly string[]).includes(category);
export const isPageTwo = (code: string | null | undefined) => !!code && (PAGE_TWO_CODES as readonly string[]).includes(code);

// Party fields the desk reads and may edit. Nothing else on party.
export const PARTY_COLUMNS =
  "id, party_type, display_name, first_names, surname, entity_name, registration_no, id_number, passport_no, date_of_birth, matrimonial_regime, tax_residency, is_vat_registered, vat_number, email, phone, physical_address, postal_address";

export const EDITABLE_PARTY_FIELDS = [
  "first_names",
  "surname",
  "entity_name",
  "registration_no",
  "id_number",
  "passport_no",
  "date_of_birth",
  "matrimonial_regime",
  "tax_residency",
  "is_vat_registered",
  "vat_number",
  "email",
  "phone",
  "physical_address",
  "postal_address",
] as const;

export const STATUS_LABEL: Record<string, string> = {
  preparing: "Preparing",
  mandate: "Mandate",
  listed: "Listed",
  under_offer: "Under offer",
  sale_agreed: "Sale agreed",
  in_conveyancing: "In conveyancing",
  registered: "Registered",
  cancelled: "Cancelled",
  lapsed: "Lapsed",
  sold_external: "Sold elsewhere",
};
export const LIVE_STATUSES = ["preparing", "mandate", "listed", "under_offer", "sale_agreed", "in_conveyancing"];
const CERT_STATUSES = ["sale_agreed", "in_conveyancing"];

export const MARITAL_LABEL: Record<string, string> = {
  single: "Single",
  married_in_community: "Married in community of property",
  married_anc_no_accrual: "Married ANC, no accrual",
  married_anc_with_accrual: "Married ANC, with accrual",
  foreign_marriage: "Foreign marriage",
  divorced: "Divorced",
  widowed: "Widowed",
  unknown: "Not recorded",
};

// ---------------------------------------------------------------------------
// Shapes

export type DeskDoc = {
  id: string;
  title: string;
  code: string | null;
  label: string | null;
  category: string | null;
  uploadedAt: string | null;
};
export type DeskFica = { id: string; role: string; status: string; risk: string; verifiedAt: string | null; notes: string | null; sourceOfFunds: string | null; updatedAt: string | null };
export type DeskParty = {
  id: string;
  side: "seller" | "purchaser";
  isPrimary: boolean;
  partyType: string;
  name: string;
  fields: Record<string, unknown>;
  fica: DeskFica | null;
  docs: DeskDoc[];
  gaps: string[];
};
export type DeskDeal = {
  transferId: string;
  propertyId: string;
  address: string;
  erven: string[];
  suburb: string | null;
  status: string;
  statusChangedAt: string | null;
  askingPrice: number | null;
  agentName: string | null;
  parties: DeskParty[];
  unassigned: DeskDoc[];
  agreements: DeskDoc[]; // page-2-only
  certDocs: DeskDoc[];
  certGaps: string[];
  gapCount: number;
};

const INDIVIDUAL = new Set(["individual"]);
const MARRIED = new Set(["married_in_community", "married_anc_no_accrual", "married_anc_with_accrual", "foreign_marriage"]);

function has(docs: DeskDoc[], ...codes: string[]) {
  return docs.some((d) => d.code && codes.includes(d.code));
}
const blank = (v: unknown) => v == null || String(v).trim() === "";

export function partyGaps(p: { partyType: string; fields: Record<string, unknown>; fica: DeskFica | null; docs: DeskDoc[] }, validityDays: number): string[] {
  const f = p.fields;
  const g: string[] = [];
  if (INDIVIDUAL.has(p.partyType)) {
    if (blank(f.id_number) && blank(f.passport_no)) g.push("ID or passport number missing");
    if (!has(p.docs, "id_document", "passport")) g.push("Copy of ID or passport missing");
    if (blank(f.physical_address)) g.push("Residential address missing");
    if (!has(p.docs, "proof_of_address")) g.push("Proof of address missing");
    const m = String(f.matrimonial_regime ?? "unknown");
    if (m === "unknown") g.push("Marital status not recorded");
    else if (MARRIED.has(m) && !has(p.docs, "marriage_certificate")) g.push("Marriage certificate missing");
  } else if (["company", "close_corporation", "trust", "partnership"].includes(p.partyType)) {
    if (blank(f.registration_no)) g.push(p.partyType === "trust" ? "Trust number missing" : "Registration number missing");
    if (p.partyType === "trust") {
      if (!has(p.docs, "trust_deed")) g.push("Trust deed missing");
    } else if (p.partyType !== "partnership" && !has(p.docs, "cipc_form")) g.push("CIPC registration missing");
    if (!has(p.docs, "company_resolution")) g.push("Resolution to sign missing");
    if (blank(f.physical_address)) g.push("Registered address missing");
    if (!has(p.docs, "proof_of_address")) g.push("Proof of address missing");
  }
  const fica = p.fica;
  if (!fica) g.push("FICA not started");
  else if (fica.status === "outstanding") g.push("FICA outstanding");
  else if (fica.status === "received") g.push("FICA documents in, not yet verified");
  else if (fica.status === "expired") g.push("FICA expired");
  else if (fica.status === "verified" && fica.verifiedAt && (Date.now() - Date.parse(fica.verifiedAt)) / 86_400_000 > validityDays) {
    g.push("FICA verification out of date");
  }
  return g;
}

// ---------------------------------------------------------------------------
// Loading

type DocRow = { id: string; title: string | null; uploaded_at: string | null; doc_type: { code: string | null; label: string | null; category: string | null } | null };
const DOC_SELECT = "id, title, uploaded_at, doc_type:doc_type_id(code, label, category)";
const toDoc = (d: DocRow): DeskDoc => ({
  id: d.id,
  title: d.title ?? d.doc_type?.label ?? "Document",
  code: d.doc_type?.code ?? null,
  label: d.doc_type?.label ?? null,
  category: d.doc_type?.category ?? null,
  uploadedAt: d.uploaded_at,
});

async function chunked<T>(ids: string[], size: number, fn: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

export async function loadDeals(
  svc: SupabaseClient,
  opts: { transferId?: string; includeClosed?: boolean; validityDays: number },
): Promise<DeskDeal[]> {
  let tq = svc
    .from("transfer")
    .select("id, property_id, status, status_changed_at, lead_agent_user_id")
    .order("status_changed_at", { ascending: false })
    .limit(1000);
  if (opts.transferId) tq = tq.eq("id", opts.transferId);
  else if (!opts.includeClosed) tq = tq.in("status", LIVE_STATUSES);
  const { data: transfers } = await tq;
  const ts = (transfers ?? []) as { id: string; property_id: string; status: string; status_changed_at: string | null; lead_agent_user_id: string | null }[];
  if (!ts.length) return [];
  const tIds = ts.map((t) => t.id);
  const pIds = [...new Set(ts.map((t) => t.property_id))];

  const [props, erven, listings, tps, certTypes, certs] = await Promise.all([
    chunked(pIds, 200, async (part) => ((await svc.from("property").select("id, primary_address, suburb:suburb_id(name)").in("id", part)).data ?? []) as unknown as { id: string; primary_address: string; suburb: { name: string } | null }[]),
    chunked(pIds, 200, async (part) => ((await svc.from("erf").select("property_id, erf_number, portion").in("property_id", part)).data ?? []) as { property_id: string; erf_number: string; portion: string | null }[]),
    chunked(pIds, 200, async (part) => ((await svc.from("listing").select("property_id, transfer_id, asking_price, agent_user_id, created_at").in("property_id", part).order("created_at", { ascending: false })).data ?? []) as { property_id: string; transfer_id: string | null; asking_price: number | null; agent_user_id: string | null }[]),
    chunked(tIds, 200, async (part) => ((await svc.from("transfer_party").select(`transfer_id, side, is_primary, party:party_id(${PARTY_COLUMNS})`).in("transfer_id", part)).data ?? []) as unknown as { transfer_id: string; side: "seller" | "purchaser"; is_primary: boolean; party: Record<string, unknown> | null }[]),
    svc.from("compliance_type").select("id, code, label").in("code", ["electrical", "entomologist"]),
    chunked(pIds, 200, async (part) => ((await svc.from("compliance_cert").select("property_id, transfer_id, compliance_type_id, expiry_date").in("property_id", part)).data ?? []) as { property_id: string; transfer_id: string | null; compliance_type_id: string; expiry_date: string | null }[]),
  ]);

  const partyIds = [...new Set(tps.map((r) => (r.party?.id as string) ?? "").filter(Boolean))];
  const [ficas, links] = await Promise.all([
    chunked(tIds, 200, async (part) => ((await svc.from("fica").select("id, transfer_id, party_id, role, status, risk, verified_at, notes, source_of_funds, updated_at").in("transfer_id", part)).data ?? []) as { id: string; transfer_id: string; party_id: string; role: string; status: string; risk: string; verified_at: string | null; notes: string | null; source_of_funds: string | null; updated_at: string | null }[]),
    (async () => {
      const rows: { document_id: string; entity_type: string; entity_id: string }[] = [];
      for (const [type, ids] of [["party", partyIds], ["transfer", tIds], ["property", pIds]] as const) {
        rows.push(...(await chunked([...ids], 200, async (part) => ((await svc.from("document_link").select("document_id, entity_type, entity_id").eq("entity_type", type).in("entity_id", part)).data ?? []) as { document_id: string; entity_type: string; entity_id: string }[])));
      }
      return rows;
    })(),
  ]);
  const docIds = [...new Set(links.map((l) => l.document_id))];
  const docs = await chunked(docIds, 200, async (part) => ((await svc.from("document").select(DOC_SELECT).in("id", part)).data ?? []) as unknown as DocRow[]);
  const docById = new Map(docs.map((d) => [d.id, toDoc(d)]));

  const agentIds = [...new Set([...ts.map((t) => t.lead_agent_user_id), ...listings.map((l) => l.agent_user_id)].filter(Boolean) as string[])];
  const { data: agents } = agentIds.length ? await svc.from("app_user").select("id, full_name").in("id", agentIds) : { data: [] };
  const agentName = new Map(((agents ?? []) as { id: string; full_name: string | null }[]).map((a) => [a.id, a.full_name]));

  const propById = new Map(props.map((p) => [p.id, p]));
  const ervenBy = new Map<string, string[]>();
  for (const e of erven) (ervenBy.get(e.property_id) ?? ervenBy.set(e.property_id, []).get(e.property_id)!).push(e.portion ? `${e.erf_number}/${e.portion}` : e.erf_number);
  const typeCode = new Map(((certTypes.data ?? []) as { id: string; code: string; label: string }[]).map((c) => [c.id, c]));

  const docsFor = (type: string, id: string) =>
    links.filter((l) => l.entity_type === type && l.entity_id === id).map((l) => docById.get(l.document_id)).filter(Boolean) as DeskDoc[];
  const partyLinked = new Set(links.filter((l) => l.entity_type === "party").map((l) => l.document_id));

  return ts.map((t) => {
    const prop = propById.get(t.property_id);
    const listing = listings.find((l) => l.transfer_id === t.id) ?? listings.find((l) => l.property_id === t.property_id) ?? null;
    const parties: DeskParty[] = tps
      .filter((r) => r.transfer_id === t.id && r.party)
      .map((r) => {
        const f = r.party as Record<string, unknown>;
        const fRow = ficas.filter((x) => x.transfer_id === t.id && x.party_id === f.id).sort((a, b) => (a.role === r.side ? -1 : b.role === r.side ? 1 : 0))[0];
        const fica: DeskFica | null = fRow
          ? { id: fRow.id, role: fRow.role, status: fRow.status, risk: fRow.risk, verifiedAt: fRow.verified_at, notes: fRow.notes, sourceOfFunds: fRow.source_of_funds, updatedAt: fRow.updated_at }
          : null;
        const pDocs = docsFor("party", f.id as string).filter((d) => isViewable(d.category));
        const partyType = String(f.party_type ?? "individual");
        const name = String(f.display_name ?? ([f.first_names, f.surname].filter(Boolean).join(" ") || f.entity_name || "Unnamed"));
        const p = { id: f.id as string, side: r.side, isPrimary: r.is_primary, partyType, name, fields: f, fica, docs: pDocs, gaps: [] as string[] };
        p.gaps = partyGaps(p, opts.validityDays);
        return p;
      })
      .sort((a, b) => (a.side === b.side ? Number(b.isPrimary) - Number(a.isPrimary) : a.side === "seller" ? -1 : 1));

    const dealDocs = [...docsFor("transfer", t.id), ...docsFor("property", t.property_id)];
    const seen = new Set<string>();
    const uniq = dealDocs.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
    const unassigned = uniq.filter((d) => (d.category === "fica" || d.category === "company") && !partyLinked.has(d.id));
    const agreements = uniq.filter((d) => isPageTwo(d.code));
    const certDocs = uniq.filter((d) => d.category === "compliance");

    const certGaps: string[] = [];
    if (CERT_STATUSES.includes(t.status)) {
      const today = new Date().toISOString().slice(0, 10);
      for (const [id, ct] of typeCode) {
        const cert = certs.find((c) => c.property_id === t.property_id && c.compliance_type_id === id && (c.transfer_id === t.id || c.transfer_id == null));
        if (!cert) certGaps.push(`${ct.label} outstanding`);
        else if (cert.expiry_date && cert.expiry_date < today) certGaps.push(`${ct.label} expired`);
      }
    }
    const gapCount = parties.reduce((a, p) => a + p.gaps.length, 0) + certGaps.length + (parties.length === 0 ? 1 : 0);

    return {
      transferId: t.id,
      propertyId: t.property_id,
      address: prop?.primary_address ?? "Unknown address",
      erven: ervenBy.get(t.property_id) ?? [],
      suburb: prop?.suburb?.name ?? null,
      status: t.status,
      statusChangedAt: t.status_changed_at,
      askingPrice: listing?.asking_price ?? null,
      agentName: agentName.get(listing?.agent_user_id ?? t.lead_agent_user_id ?? "") ?? null,
      parties,
      unassigned,
      agreements,
      certDocs,
      certGaps,
      gapCount,
    };
  });
}

/** May the desk touch this document, and how? Returns null when it may not. */
export async function documentAccess(svc: SupabaseClient, documentId: string): Promise<{ mode: "full" | "page2"; bucket: string; path: string; mime: string | null; title: string } | null> {
  const { data } = await svc
    .from("document")
    .select("id, title, storage_bucket, storage_path, mime_type, doc_type:doc_type_id(code, category)")
    .eq("id", documentId)
    .maybeSingle();
  const d = data as unknown as { title: string | null; storage_bucket: string | null; storage_path: string | null; mime_type: string | null; doc_type: { code: string | null; category: string | null } | null } | null;
  if (!d?.storage_path) return null;
  // Only papers that belong to a deal: linked to a transfer, to a property
  // that has one, or to a person who is on one (security review 2026-10-21).
  const { data: ls } = await svc.from("document_link").select("entity_type, entity_id").eq("document_id", documentId);
  const links = (ls ?? []) as { entity_type: string; entity_id: string }[];
  let onDeal = links.some((l) => l.entity_type === "transfer");
  if (!onDeal) {
    const props = links.filter((l) => l.entity_type === "property").map((l) => l.entity_id);
    const people = links.filter((l) => l.entity_type === "party").map((l) => l.entity_id);
    if (props.length) onDeal = !!(await svc.from("transfer").select("id").in("property_id", props).limit(1)).data?.length;
    if (!onDeal && people.length) onDeal = !!(await svc.from("transfer_party").select("id").in("party_id", people).limit(1)).data?.length;
  }
  if (!onDeal) return null;
  const base = { bucket: d.storage_bucket ?? "documents", path: d.storage_path, mime: d.mime_type, title: d.title ?? "Document" };
  if (isViewable(d.doc_type?.category)) return { mode: "full", ...base };
  if (isPageTwo(d.doc_type?.code)) return { mode: "page2", ...base };
  return null;
}
