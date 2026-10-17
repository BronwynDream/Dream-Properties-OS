// Website → Dream OS listing sync (2026-10-17).
//
// The website (dreamknysna.co.za) is Dream's master list of what's on the
// books. The Dream feed (app/api/sources/dream/refresh) already saves every
// website listing as an external_listing row, now with its index card and
// its agents in raw. This turns each of those into a Dream OS property +
// listing with its agents, so an agent who logs in sees their stock.
//
// Rules (Simon, 2026-10-17):
//   * Every website listing gets a property record, address or not. No
//     street address → named "<listing title>, <area>" and flagged
//     address_to_confirm; the agent fills it in.
//   * Two agents on a listing → both are on it; the first is lead.
//   * Where a website listing is already in Dream OS: the website's price
//     wins, Dream OS's status wins (a sale in progress stays in progress,
//     and is reported as "still advertised").
//   * A listing that disappears from the website is reported, not closed.
//
// Matching, in order: listing.website_slug → the dream row's
// matched_property_id (hand-linked in migration 0085, or by the dedup
// matcher) → create. Idempotent: a second run only updates prices,
// agents and "seen" times.

import type { SupabaseClient } from "@supabase/supabase-js";
import { estateForArea, suburbForArea, type WebsiteAgent, type WebsiteCard } from "./website";

export type SyncAction =
  | "created"            // new property + listing
  | "listing_added"      // existing property, new listing
  | "attached"           // existing listing linked to its website page
  | "updated"            // price / agents changed
  | "unchanged";

export type SyncRow = {
  slug: string;
  title: string | null;
  address: string;
  addressToConfirm: boolean;
  action: SyncAction;
  propertyId: string | null;
  listingId: string | null;
  agents: string[];
  price: number | null;
  status: string;
  notes: string[];
};

export type SyncReport = {
  dry: boolean;
  rows: SyncRow[];
  counts: Record<SyncAction, number>;
  agentsCreated: string[];
  goneFromWebsite: { listingId: string; slug: string; address: string }[];
  errors: string[];
};

type DreamRow = {
  id: string;
  source_ref: string;
  url: string | null;
  headline: string | null;
  address_raw: string | null;
  suburb: string | null;
  price: number | null;
  property_type: string | null;
  lat: number | null;
  lng: number | null;
  geocode_source: string | null;
  matched_property_id: string | null;
  erf_size_sqm: number | null;
  raw: { card?: WebsiteCard; agents?: WebsiteAgent[] } | null;
};

const OS_TYPE: Record<string, string> = {
  house: "house",
  apartment: "apartment",
  penthouse: "apartment",
  townhouse: "townhouse",
  vacant_land: "vacant_land",
  farm: "farm",
  commercial: "commercial",
};

const CLOSED_TRANSFER = new Set(["registered", "sold_external"]);
const PENDING_TRANSFER = new Set(["under_offer", "sale_agreed", "in_conveyancing"]);

export async function syncWebsiteToOs(db: SupabaseClient, opts: { dry: boolean }): Promise<SyncReport> {
  const dry = opts.dry;
  const report: SyncReport = {
    dry,
    rows: [],
    counts: { created: 0, listing_added: 0, attached: 0, updated: 0, unchanged: 0 },
    agentsCreated: [],
    goneFromWebsite: [],
    errors: [],
  };
  const now = new Date().toISOString();

  // ---- what we have ---------------------------------------------------------
  const [{ data: dreamRows, error: dErr }, { data: agentRows }, { data: suburbs }, { data: estates }, { data: types }] =
    await Promise.all([
      db
        .from("external_listing")
        .select("id, source_ref, url, headline, address_raw, suburb, price, property_type, lat, lng, geocode_source, matched_property_id, erf_size_sqm, raw")
        .eq("source", "dream_website")
        .eq("active", true),
      db.from("agent").select("id, email, full_name, app_user_id"),
      db.from("suburb").select("id, name"),
      db.from("estate").select("id, name"),
      db.from("property_type").select("id, code"),
    ]);
  if (dErr) {
    report.errors.push(`dream rows: ${dErr.message}`);
    return report;
  }
  const rows = (dreamRows ?? []) as DreamRow[];

  const agentByEmail = new Map<string, { id: string; full_name: string; app_user_id: string | null }>();
  for (const a of agentRows ?? []) agentByEmail.set(String(a.email).toLowerCase(), a);
  const suburbId = (name: string | null) =>
    name ? (suburbs ?? []).find((s) => s.name.toLowerCase() === name.toLowerCase())?.id ?? null : null;
  const estateId = (name: string | null) =>
    name ? (estates ?? []).find((e) => e.name.toLowerCase() === name.toLowerCase())?.id ?? null : null;
  const typeId = (code: string | null) => (code ? (types ?? []).find((t) => t.code === code)?.id ?? null : null);

  // ---- agents the website names that the roster doesn't have yet --------------
  for (const r of rows) {
    for (const a of r.raw?.agents ?? []) {
      const key = a.email.toLowerCase();
      if (agentByEmail.has(key)) continue;
      report.agentsCreated.push(`${a.name} <${key}>`);
      if (dry) {
        agentByEmail.set(key, { id: `new:${key}`, full_name: a.name, app_user_id: null });
        continue;
      }
      const { data, error } = await db
        .from("agent")
        .insert({ full_name: a.name, email: key, phone: a.phone })
        .select("id, full_name, app_user_id")
        .single();
      if (error || !data) report.errors.push(`agent ${key}: ${error?.message}`);
      else agentByEmail.set(key, data);
    }
  }

  // ---- listings already tied to website pages -----------------------------------
  const { data: linked } = await db
    .from("listing")
    .select("id, property_id, status, asking_price, website_slug, property:property_id(primary_address)")
    .not("website_slug", "is", null);
  const listingBySlug = new Map<string, { id: string; property_id: string; status: string; asking_price: number | null }>();
  for (const l of linked ?? []) listingBySlug.set(l.website_slug as string, l as never);

  const seenSlugs = new Set(rows.map((r) => r.source_ref));
  for (const l of linked ?? []) {
    if (!seenSlugs.has(l.website_slug as string)) {
      const p = (Array.isArray(l.property) ? l.property[0] : l.property) as { primary_address?: string } | null;
      report.goneFromWebsite.push({ listingId: l.id, slug: l.website_slug as string, address: p?.primary_address ?? "" });
    }
  }

  // ---- each website listing --------------------------------------------------------
  for (const r of rows.sort((a, b) => a.source_ref.localeCompare(b.source_ref))) {
    const card = r.raw?.card ?? null;
    const slug = r.source_ref;
    const title = card?.title ?? r.headline;
    const area = card?.area ?? r.suburb;
    const suburbName = suburbForArea(area);
    const price = card?.price ?? r.price ?? null;
    const websiteAgents = (r.raw?.agents ?? []).map((a) => agentByEmail.get(a.email.toLowerCase())).filter(Boolean) as {
      id: string;
      full_name: string;
      app_user_id: string | null;
    }[];
    const lead = websiteAgents[0] ?? null;

    const captionAddress = card?.captionAddress ?? null;
    const address = captionAddress
      ? suburbName && !captionAddress.toLowerCase().includes(suburbName.toLowerCase())
        ? `${captionAddress}, ${suburbName}`
        : captionAddress
      : `${title ?? slug}${suburbName ? `, ${suburbName}` : ""}`;

    const row: SyncRow = {
      slug,
      title,
      address,
      addressToConfirm: !captionAddress,
      action: "unchanged",
      propertyId: null,
      listingId: null,
      agents: websiteAgents.map((a) => a.full_name),
      price,
      status: card?.underOffer ? "under_offer" : "live",
      notes: [],
    };

    try {
      let listing = listingBySlug.get(slug) ?? null;
      let propertyId = listing?.property_id ?? r.matched_property_id ?? null;

      // Existing property: its transfer state decides the status, and its
      // latest open listing (if any) is adopted rather than duplicated.
      let transferStatus: string | null = null;
      if (propertyId) {
        const { data: prop } = await db.from("property").select("id, primary_address").eq("id", propertyId).maybeSingle();
        if (!prop) propertyId = null;
        else {
          row.address = prop.primary_address;
          row.addressToConfirm = false;
          const { data: tr } = await db
            .from("transfer")
            .select("status, created_at")
            .eq("property_id", propertyId)
            .order("created_at", { ascending: false })
            .limit(1);
          transferStatus = tr?.[0]?.status ?? null;
          if (!listing) {
            const { data: ls } = await db
              .from("listing")
              .select("id, property_id, status, asking_price, website_slug")
              .eq("property_id", propertyId)
              .is("website_slug", null)
              .order("created_at", { ascending: false })
              .limit(1);
            if (ls?.[0]) listing = ls[0] as never;
          }
        }
      }

      if (transferStatus && CLOSED_TRANSFER.has(transferStatus)) {
        row.status = "sold";
        row.notes.push("Sold in Dream OS but still advertised on the website");
      } else if (transferStatus && PENDING_TRANSFER.has(transferStatus)) {
        row.status = "under_offer";
        if (!card?.underOffer) row.notes.push("Sale in progress in Dream OS; website doesn't show it under offer");
      }

      // ---- property ----------------------------------------------------------------
      if (!propertyId) {
        row.action = "created";
        if (!dry) {
          const exact = r.geocode_source !== "centroid" && r.lat != null && r.lng != null;
          const { data: np, error: pErr } = await db
            .from("property")
            .insert({
              primary_address: address,
              address_to_confirm: !captionAddress,
              suburb_id: suburbId(suburbName),
              estate_id: estateId(estateForArea(area)),
              property_type_id: typeId(OS_TYPE[r.property_type ?? ""] ?? (card && !card.bedrooms ? "vacant_land" : null)),
              extent_sqm: card?.erfSqm ?? r.erf_size_sqm ?? null,
              lat: exact ? r.lat : null,
              lng: exact ? r.lng : null,
              notes: `Created from the Dream website listing "${title ?? slug}" (${r.url ?? slug}) on ${now.slice(0, 10)}.`,
            })
            .select("id")
            .single();
          if (pErr || !np) throw new Error(`property: ${pErr?.message}`);
          propertyId = np.id as string;
          await db.from("external_listing").update({ matched_property_id: propertyId }).eq("id", r.id);
        }
      }
      row.propertyId = propertyId;

      // ---- listing -----------------------------------------------------------------
      if (!listing) {
        if (row.action !== "created") row.action = "listing_added";
        if (!dry) {
          const { data: nl, error: lErr } = await db
            .from("listing")
            .insert({
              property_id: propertyId,
              status: row.status,
              asking_price: price,
              headline: title,
              agent_user_id: lead?.app_user_id ?? null,
              website_slug: slug,
              website_url: r.url,
              website_seen_at: now,
            })
            .select("id")
            .single();
          if (lErr || !nl) throw new Error(`listing: ${lErr?.message}`);
          row.listingId = nl.id as string;
          if (price != null) await db.from("listing_price_history").insert({ listing_id: nl.id, price });
        }
      } else {
        row.listingId = listing.id;
        // Dream OS's status wins — except a draft, which nobody has decided.
        row.status = listing.status === "draft" ? row.status : listing.status;
        const patch: Record<string, unknown> = { website_url: r.url, website_seen_at: now };
        if (!listingBySlug.has(slug)) {
          patch.website_slug = slug;
          row.action = "attached";
        }
        if (listing.status === "draft") patch.status = row.status;
        if (price != null && Number(listing.asking_price ?? 0) !== price) {
          patch.asking_price = price;
          row.notes.push(
            `Price ${listing.asking_price != null ? `R ${Number(listing.asking_price).toLocaleString("en-ZA")} → ` : ""}R ${price.toLocaleString("en-ZA")} (website)`,
          );
          if (row.action === "unchanged") row.action = "updated";
        }
        if (!dry) {
          const { error: uErr } = await db.from("listing").update(patch).eq("id", listing.id);
          if (uErr) throw new Error(`listing update: ${uErr.message}`);
          if (patch.asking_price != null) {
            await db.from("listing_price_history").insert({ listing_id: listing.id, price });
          }
        }
      }

      // ---- agents ------------------------------------------------------------------
      if (row.listingId && websiteAgents.length) {
        const { data: current } = await db.from("listing_agent").select("agent_id, position").eq("listing_id", row.listingId);
        const want = websiteAgents.map((a, i) => `${a.id}:${i + 1}`).join(",");
        const have = (current ?? [])
          .sort((a, b) => a.position - b.position)
          .map((c) => `${c.agent_id}:${c.position}`)
          .join(",");
        if (want !== have) {
          if (row.action === "unchanged") row.action = "updated";
          if (!dry) {
            await db.from("listing_agent").delete().eq("listing_id", row.listingId);
            const { error: aErr } = await db
              .from("listing_agent")
              .insert(websiteAgents.map((a, i) => ({ listing_id: row.listingId, agent_id: a.id, position: i + 1 })));
            if (aErr) throw new Error(`agents: ${aErr.message}`);
            if (lead?.app_user_id) {
              await db.from("listing").update({ agent_user_id: lead.app_user_id }).eq("id", row.listingId).is("agent_user_id", null);
            }
          }
        }
      } else if (!websiteAgents.length) {
        row.notes.push("No agent named on the website page");
      }
    } catch (e) {
      report.errors.push(`${slug}: ${(e as Error).message}`);
      row.notes.push(`Error: ${(e as Error).message}`);
    }

    report.counts[row.action]++;
    report.rows.push(row);
  }

  return report;
}
