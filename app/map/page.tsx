import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/app/components/TopBar";
import MapView, { MapProperty } from "./MapView";

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
      "id, primary_address, title_deed_no, lng, lat, extent_sqm, suburb:suburb_id(name)",
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

  // Roll up into one row per property (latest listing wins for mandate + price).
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

  const totalCount = rows.length;
  const geoCount = rows.filter((r) => r.lng != null && r.lat != null).length;
  const missingCount = totalCount - geoCount;

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

  return (
    <>
      <TopBar />
      <MapView
        properties={rows}
        isAdmin={isAdmin}
        mapboxToken={mapboxToken}
        stats={{ total: totalCount, geocoded: geoCount, missing: missingCount }}
      />
    </>
  );
}
