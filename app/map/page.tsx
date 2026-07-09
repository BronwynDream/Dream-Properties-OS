import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import { getBudgetSummary, type BudgetSummary } from "@/lib/lightstone/gateway";
import MapView, {
  type MapProperty,
  type MergedPin,
  type ExternalRef,
  type SourceKey,
} from "./MapView";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Normalise mandate types coming from the DB into the CSS class family.
function normaliseMandate(t: string | null | undefined): string {
  if (!t) return "none";
  const s = t.toLowerCase();
  if (s.includes("exclusive")) return "exclusive";
  if (s.includes("joint")) return "joint";
  if (s.includes("sole")) return "sole";
  if (s.includes("open")) return "open";
  return "none";
}

export default async function MapPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("app_user")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin";

  const { data: propsData } = await supabase
    .from("property")
    .select(
      "id, primary_address, title_deed_no, lng, lat, geo_manual, extent_sqm, suburb:suburb_id(name)",
    );
  const properties = (propsData ?? []) as any[];

  const propertyIds = properties.map((p) => p.id);

  const { data: listingsData } = propertyIds.length
    ? await supabase
        .from("listing")
        .select(
          "property_id, id, status, asking_price, headline, listed_date, mandate:mandate(type, evidence, expiry_date)",
        )
        .in("property_id", propertyIds)
    : { data: [] };
  const listings = (listingsData ?? []) as any[];

  const { data: transfersData } = propertyIds.length
    ? await supabase
        .from("transfer")
        .select("property_id, id, name, status, transfer_date, registered_date")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  const transfers = (transfersData ?? []) as any[];

  // External listings: everything active from every source. Staff read; the
  // RLS on external_listing already allows both admin and agent.
  const { data: externalData } = await supabase
    .from("external_listing")
    .select(
      "id, source, source_ref, url, headline, address_raw, suburb, price, image_url, agency_name, lat, lng, matched_property_id, dedup_group_id",
    )
    .eq("active", true);
  const externals = (externalData ?? []) as any[];

  // Roll properties up into one row apiece (latest listing wins for mandate + price).
  const rows: MapProperty[] = properties.map((p) => {
    const propListings = listings.filter((l) => l.property_id === p.id);
    const propTransfers = transfers.filter((t) => t.property_id === p.id);
    const listing = propListings[0] ?? null;
    const mandateRow = Array.isArray(listing?.mandate)
      ? listing?.mandate[0]
      : listing?.mandate;
    const latestTransfer = propTransfers[0] ?? null;

    return {
      id: p.id,
      address: p.primary_address ?? "Unknown address",
      suburb: p.suburb?.name ?? null,
      lng: p.lng != null ? Number(p.lng) : null,
      lat: p.lat != null ? Number(p.lat) : null,
      geoManual: p.geo_manual === true,
      extentSqm: p.extent_sqm != null ? Number(p.extent_sqm) : null,
      titleDeed: p.title_deed_no ?? null,
      askingPrice: listing?.asking_price != null ? Number(listing.asking_price) : null,
      listingStatus: listing?.status ?? null,
      listingHeadline: listing?.headline ?? null,
      mandateType: normaliseMandate(mandateRow?.type),
      mandateRaw: mandateRow?.type ?? null,
      transferStatus: latestTransfer?.status ?? null,
      transferDate: latestTransfer?.transfer_date ?? null,
      transferCount: propTransfers.length,
    };
  });

  // -------------------------------------------------------------------------
  // Build merged pins: one pin per physical listing, however many sources it
  // shows up on. Rules:
  //   1. Each of our properties (with coords) seeds a merged pin.
  //   2. An external listing with matched_property_id attaches to that pin.
  //   3. Otherwise externals share a pin when they share dedup_group_id.
  //   4. Unmatched, ungrouped externals with coords each get their own pin.
  //   5. Externals without any coordinate anchor are skipped (no place to
  //      render them; the scraper's geocode step will catch them next run).
  // -------------------------------------------------------------------------
  const mergedByPropId = new Map<string, MergedPin>();
  const mergedByGroup = new Map<string, MergedPin>();
  const singletonPins: MergedPin[] = [];

  for (const r of rows) {
    if (r.lng == null || r.lat == null) continue;
    mergedByPropId.set(r.id, {
      key: `prop-${r.id}`,
      lng: r.lng,
      lat: r.lat,
      matchedPropertyId: r.id,
      our: r,
      externals: [],
      sources: ["dream_os"],
      representative: {
        address: r.address,
        price: r.askingPrice,
        suburb: r.suburb,
        mandateType: r.mandateType,
      },
    });
  }

  for (const e of externals) {
    const ref: ExternalRef = {
      id: e.id,
      source: e.source,
      sourceRef: e.source_ref,
      url: e.url ?? null,
      headline: e.headline ?? null,
      price: e.price != null ? Number(e.price) : null,
      addressRaw: e.address_raw ?? null,
      suburb: e.suburb ?? null,
      imageUrl: e.image_url ?? null,
      agencyName: e.agency_name ?? null,
      lat: e.lat != null ? Number(e.lat) : null,
      lng: e.lng != null ? Number(e.lng) : null,
    };

    // Case 1 — matched to one of our properties.
    if (e.matched_property_id && mergedByPropId.has(e.matched_property_id)) {
      const pin = mergedByPropId.get(e.matched_property_id)!;
      pin.externals.push(ref);
      if (!pin.sources.includes(e.source as SourceKey)) {
        pin.sources.push(e.source as SourceKey);
      }
      continue;
    }

    // Case 2 — shares a dedup group with other externals.
    if (e.dedup_group_id) {
      let pin = mergedByGroup.get(e.dedup_group_id);
      if (!pin) {
        if (ref.lat == null || ref.lng == null) {
          // No coords yet — parked. The dedup group might contain another row
          // with coords; if it doesn't, geocode will fill it in on the next
          // scraper pass and this pin appears then.
          continue;
        }
        pin = {
          key: `grp-${e.dedup_group_id}`,
          lng: ref.lng,
          lat: ref.lat,
          matchedPropertyId: null,
          our: null,
          externals: [],
          sources: [],
          representative: {
            address: ref.addressRaw ?? ref.headline ?? "Market listing",
            price: ref.price,
            suburb: ref.suburb,
            mandateType: "market",
          },
        };
        mergedByGroup.set(e.dedup_group_id, pin);
      }
      pin.externals.push(ref);
      if (!pin.sources.includes(e.source as SourceKey)) {
        pin.sources.push(e.source as SourceKey);
      }
      continue;
    }

    // Case 3 — singleton competitor pin.
    if (ref.lat == null || ref.lng == null) continue;
    singletonPins.push({
      key: `ext-${e.id}`,
      lng: ref.lng,
      lat: ref.lat,
      matchedPropertyId: null,
      our: null,
      externals: [ref],
      sources: [e.source as SourceKey],
      representative: {
        address: ref.addressRaw ?? ref.headline ?? "Market listing",
        price: ref.price,
        suburb: ref.suburb,
        mandateType: "market",
      },
    });
  }

  const mergedPins: MergedPin[] = [
    ...Array.from(mergedByPropId.values()),
    ...Array.from(mergedByGroup.values()),
    ...singletonPins,
  ];

  const totalCount = rows.length;
  const geoCount = rows.filter((r) => r.lng != null && r.lat != null).length;
  const missingCount = totalCount - geoCount;

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

  // Directors get a compact Lightstone spend meter in the rail. Read via the
  // gateway helper (service-role) — the same read RLS would allow admin anyway,
  // but this keeps the count consistent with what the gateway sees.
  let budget: BudgetSummary | null = null;
  if (isAdmin) {
    try {
      budget = await getBudgetSummary();
    } catch {
      budget = null;
    }
  }

  return (
    <>
      <TopBar />
      <MapView
        properties={rows}
        mergedPins={mergedPins}
        isAdmin={isAdmin}
        mapboxToken={mapboxToken}
        stats={{ total: totalCount, geocoded: geoCount, missing: missingCount }}
        budget={budget}
      />
    </>
  );
}
