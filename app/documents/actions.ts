"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildPartyRow, type SellerInput } from "@/lib/parties";
import { claimListing, listingMembers, takeOnContext } from "@/lib/takeon";

// Taking on a mandate from the Documents page (2026-10-19).
//
// Simon: "when you click a mandate, it should ask you for the details, and
// then it should open a property record automatically whilst it generates
// the mandate." Agreed with one guard: the property is often already in
// Dream OS (website import, an old sale, the municipal roll), so we look
// before we create — a second record for the same erf is the duplicate
// problem the dupe finder exists to clean up.
//
// takeOnForMandate() does, in order:
//   1. Find or create the property (existing record → erf already attached
//      by SG number → same address → new record built from the erf).
//   2. Find the open listing (draft / live / under offer) or open a
//      preparing transfer + draft listing — the mandate editor needs both.
//   3. Put the seller on that transfer, unless one is already there.
//   4. Make the agent doing this the lead agent on the listing.
// The client then opens the mandate editor on the result.
//
// Written with the service client: property / listing / transfer / party
// writes are admin-only under RLS (0005), but taking on a mandate is every
// agent's job. The caller is checked as active staff first.

export type TakeOnProperty =
  | { kind: "existing"; propertyId: string }
  | {
      kind: "erf";
      erfNumber: string;
      sgNumber: string | null;
      address: string;
      suburb: string | null;
      extentSqm: number | null;
      titleDeedNo: string | null;
    }
  | { kind: "new"; address: string };

/** The erf's parcel on the map: key + centroid (cadastral_parcel, Knysna). */
export async function locateErf(erfNumber: string): Promise<{ prclKey: string; lng: number; lat: number } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const n = erfNumber.trim().replace(/[^0-9]/g, "");
  if (!user || !n) return null;
  const db = createServiceClient();

  const { data } = await db.rpc("erf_centroid_lookup", { p_erf_number: n });
  const row = (Array.isArray(data) ? data[0] : data) as { prcl_key: string; lng: number; lat: number } | null;
  if (row && Number.isFinite(Number(row.lng)) && Number.isFinite(Number(row.lat))) {
    return { prclKey: row.prcl_key, lng: Number(row.lng), lat: Number(row.lat) };
  }

  // erf_centroid_lookup only matches tag_value = 'erf N' with maj_region
  // exactly 'KNYSNA' and found nothing for 15 Eagles Way (erf 4497) on
  // 2026-10-19. The erf snap (0039) compares digits only and uses
  // ilike '%KNYSNA%'; do the same here.
  const { data: parcels } = await db
    .from("cadastral_parcel")
    .select("prcl_key, centroid")
    .in("tag_value", [n, `erf ${n}`, `Erf ${n}`, `ERF ${n}`])
    .ilike("maj_region", "%KNYSNA%")
    .limit(5);
  for (const p of (parcels ?? []) as { prcl_key: string; centroid: unknown }[]) {
    const c = readPoint(p.centroid);
    if (c) return { prclKey: p.prcl_key, ...c };
  }
  return null;
}

/** A PostGIS point as PostgREST returns it: GeoJSON, or (E)WKB hex. */
function readPoint(v: unknown): { lng: number; lat: number } | null {
  if (!v) return null;
  if (typeof v === "object" && Array.isArray((v as { coordinates?: unknown }).coordinates)) {
    const [lng, lat] = (v as { coordinates: number[] }).coordinates;
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
  }
  if (typeof v === "string" && /^[0-9a-f]+$/i.test(v) && v.length >= 42) {
    const buf = Buffer.from(v, "hex");
    const le = buf[0] === 1;
    const type = le ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
    const off = type & 0x20000000 ? 9 : 5; // EWKB carries a 4-byte SRID
    const lng = le ? buf.readDoubleLE(off) : buf.readDoubleBE(off);
    const lat = le ? buf.readDoubleLE(off + 8) : buf.readDoubleBE(off + 8);
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
  }
  return null;
}

/** A Dream OS property that already has this erf attached, if any. */
export async function propertyForErf(
  sgNumber: string | null,
  erfNumber: string | null,
): Promise<{ id: string; address: string; suburb: string | null } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  let pid: string | null = null;
  if (sgNumber) {
    const { data } = await supabase.from("erf").select("property_id").eq("sg_number", sgNumber).limit(1).maybeSingle();
    pid = data?.property_id ?? null;
  }
  if (!pid && erfNumber) {
    // Erf numbers repeat across towns; only trust a number match when it's unique.
    const { data } = await supabase.from("erf").select("property_id").eq("erf_number", erfNumber).limit(2);
    if (data && data.length === 1) pid = data[0].property_id;
  }
  if (!pid) return null;
  const { data: p } = await supabase.from("property").select("id, primary_address, suburb:suburb_id(name)").eq("id", pid).maybeSingle();
  if (!p) return null;
  const sub = (Array.isArray(p.suburb) ? p.suburb[0] : p.suburb) as { name: string } | null;
  return { id: p.id, address: p.primary_address, suburb: sub?.name ?? null };
}

type Result = { ok: true; propertyId: string; listingId: string } | { ok: false; error: string };

const OPEN = ["draft", "live", "under_offer"];

/** What the record already knows, so the form can skip the seller step —
 *  and whether the property is someone else's live listing (then the
 *  take-on is refused, so say so before the agent fills anything in). */
export async function mandateContext(
  propertyId: string,
): Promise<
  { ok: true; listingId: string | null; sellerNames: string[]; listedBy: string[] | null } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthorised" };

  const { data: listing } = await supabase
    .from("listing")
    .select("id, transfer_id")
    .eq("property_id", propertyId)
    .in("status", OPEN)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!listing) return { ok: true, listingId: null, sellerNames: [], listedBy: null };

  const { data: me } = await supabase.from("app_user").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    const m = await listingMembers(createServiceClient(), listing.id, user.id);
    if (!m.isMember) return { ok: true, listingId: listing.id, sellerNames: [], listedBy: m.names };
  }
  if (!listing.transfer_id) return { ok: true, listingId: listing.id, sellerNames: [], listedBy: null };

  // Read with the caller's own access: RLS (0086) shows sellers only on their deals.
  const { data: rows } = await supabase
    .from("transfer_party")
    .select("is_primary, party:party_id(display_name)")
    .eq("transfer_id", listing.transfer_id)
    .eq("side", "seller")
    .order("is_primary", { ascending: false });
  const names = ((rows ?? []) as unknown as { party: { display_name: string } | { display_name: string }[] | null }[])
    .map((r) => (Array.isArray(r.party) ? r.party[0] : r.party)?.display_name)
    .filter(Boolean) as string[];
  return { ok: true, listingId: listing.id, sellerNames: names, listedBy: null };
}

export async function takeOnForMandate(input: { property: TakeOnProperty; seller: SellerInput | null }): Promise<Result> {
  const started = await takeOnContext();
  if (!started.ok) return started;
  const ctx = started.ctx;
  const db = ctx.db;

  // 1. The property ---------------------------------------------------------
  const prop = await resolveProperty(db, input.property);
  if (!prop.ok) return prop;
  const propertyId = prop.id;

  // 2. The open listing and its transfer -------------------------------------
  const { data: open } = await db
    .from("listing")
    .select("id, transfer_id, agent_user_id")
    .eq("property_id", propertyId)
    .in("status", OPEN)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Someone else's listing or deal is not a way in (0086): attaching to it
  // would put this agent on that deal and show them its sellers and papers.
  if (!ctx.isAdmin) {
    if (open) {
      const m = await listingMembers(db, open.id, ctx.userId);
      if (!m.isMember) {
        const who = m.names.length ? `listed by ${m.names.join(" and ")}` : "already listed, with no agent assigned yet";
        return { ok: false, error: `This property is ${who}. Ask Bronwyn to add you to that listing.` };
      }
    } else {
      // No open listing, but a sale still going through (offer, conveyancing).
      const { data: busy } = await db
        .from("transfer")
        .select("id, lead_agent_user_id")
        .eq("property_id", propertyId)
        .not("status", "in", "(registered,cancelled,lapsed,sold_external)")
        .is("registered_date", null);
      const others = ((busy ?? []) as { id: string; lead_agent_user_id: string | null }[]).filter(
        (t) => t.lead_agent_user_id !== ctx.userId,
      );
      if (others.length) {
        return { ok: false, error: "This property has a sale in progress. Ask Bronwyn before taking it on." };
      }
    }
  }

  let listingId: string | null = open?.id ?? null;
  let transferId: string | null = open?.transfer_id ?? null;

  if (!transferId) {
    const { data: addr } = await db.from("property").select("primary_address").eq("id", propertyId).single();
    const { data: t, error } = await db
      .from("transfer")
      .insert({ property_id: propertyId, name: `${addr?.primary_address ?? "Property"} (preparing)`, status: "preparing" })
      .select("id")
      .single();
    if (error || !t) return { ok: false, error: `Could not open the deal: ${error?.message ?? "unknown error"}` };
    transferId = t.id;
    if (listingId) {
      await db.from("listing").update({ transfer_id: transferId }).eq("id", listingId);
    }
  }
  if (!listingId) {
    const { data: l, error } = await db
      .from("listing")
      .insert({ property_id: propertyId, transfer_id: transferId, status: "draft" })
      .select("id")
      .single();
    if (error || !l) return { ok: false, error: `Could not start the listing: ${error?.message ?? "unknown error"}` };
    listingId = l.id;
  }
  // Both are set by now; the narrowing is for the compiler.
  if (!listingId || !transferId) return { ok: false, error: "Could not start the listing." };

  // 3. The seller -----------------------------------------------------------
  const { count: sellerCount } = await db
    .from("transfer_party")
    .select("party_id", { count: "exact", head: true })
    .eq("transfer_id", transferId)
    .eq("side", "seller");
  if (input.seller) {
    const row = buildPartyRow(input.seller);
    if (!row) return { ok: false, error: "Add the seller's name (or the company / trust name)." };
    row.owner_user_id = ctx.userId;
    const { data: party, error } = await db.from("party").insert(row).select("id").single();
    if (error || !party) return { ok: false, error: `Could not save the seller: ${error?.message ?? "unknown error"}` };
    const { error: tpErr } = await db.from("transfer_party").insert({
      transfer_id: transferId,
      party_id: party.id,
      side: "seller",
      is_primary: !sellerCount,
    });
    if (tpErr) return { ok: false, error: `Could not link the seller: ${tpErr.message}` };
  } else if (!sellerCount) {
    return { ok: false, error: "Add the seller — the mandate is signed by them." };
  }

  // 4. The agent ------------------------------------------------------------
  await claimListing(ctx, listingId);

  revalidatePath("/properties");
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/documents");
  return { ok: true, propertyId, listingId };
}

type Db = ReturnType<typeof createServiceClient>;

async function resolveProperty(db: Db, p: TakeOnProperty): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (p.kind === "existing") {
    const { data } = await db.from("property").select("id").eq("id", p.propertyId).maybeSingle();
    return data ? { ok: true, id: data.id } : { ok: false, error: "That property no longer exists." };
  }

  const address = tidyAddress(p.address);
  if (address.length < 3) return { ok: false, error: "Type the property's street address." };

  // Already attached to a record by its SG number? That's the same erf.
  if (p.kind === "erf" && p.sgNumber) {
    const { data } = await db.from("erf").select("property_id").eq("sg_number", p.sgNumber).limit(1).maybeSingle();
    if (data?.property_id) return { ok: true, id: data.property_id };
  }
  // Same address written the same way? Reuse it.
  const esc = address.replace(/[%_\\]/g, (c) => `\\${c}`);
  const { data: same } = await db
    .from("property")
    .select("id")
    .or(`primary_address.ilike.${JSON.stringify(esc)},primary_address.ilike.${JSON.stringify(`${esc},%`)}`)
    .limit(1)
    .maybeSingle();
  if (same) return { ok: true, id: same.id };

  let suburbId: string | null = null;
  if (p.kind === "erf" && p.suburb) {
    const name = p.suburb.replace(/^\d+-/, "").trim();
    const { data } = await db.from("suburb").select("id").ilike("name", name).limit(1).maybeSingle();
    suburbId = data?.id ?? null;
  }

  const { data: created, error } = await db
    .from("property")
    .insert({
      primary_address: address,
      suburb_id: suburbId,
      extent_sqm: p.kind === "erf" ? p.extentSqm : null,
      title_deed_no: p.kind === "erf" ? p.titleDeedNo : null,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: `Could not create the property: ${error?.message ?? "unknown error"}` };

  if (p.kind === "erf" && p.erfNumber) {
    await db.from("erf").insert({ property_id: created.id, erf_number: p.erfNumber, sg_number: p.sgNumber });
  }
  return { ok: true, id: created.id };
}

/** "12 EAGLES WAY" → "12 Eagles Way"; leaves mixed-case input alone. */
function tidyAddress(a: string): string {
  const s = a.trim().replace(/\s+/g, " ");
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
