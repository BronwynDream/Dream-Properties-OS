// The map's view of a listing (2026-10-17 redesign).
//
// The server merges every source into one MergedPin per physical listing
// (page.tsx). Here each pin becomes a MapListing: the handful of facts the
// map, the search bar, the hover card and the results list need, already
// normalised (one type vocabulary, one price, one bed count) so filtering is
// a plain predicate and every surface agrees.

import type { MergedPin, SourceKey } from "./MapView";

/** Mirrors lib/external-listings/geocode.ts — kept here so the client
 *  bundle doesn't pull in the server geocoder. */
export function isHiddenAddress(a: string | null | undefined): boolean {
  const s = (a ?? "").trim();
  if (!s) return false;
  return /contact\s+(the\s+)?(agent|broker|seller|owner|agency)|not\s+specified|address\s+(withheld|on\s+request|available\s+on\s+request)/i.test(s);
}

export type ListingKind = "ours" | "market";
export type OurState = "exclusive" | "joint" | "open" | "none" | "under_offer" | "sold";
export type TypeKey = "house" | "townhouse" | "apartment" | "land" | "farm" | "commercial";
export type FeatureKey = "garden" | "pool" | "garage" | "pets";

export const TYPE_LABEL: Record<TypeKey, string> = {
  house: "House",
  townhouse: "Townhouse / cluster",
  apartment: "Apartment / flat",
  land: "Vacant land",
  farm: "Farm / smallholding",
  commercial: "Commercial",
};
export const TYPE_ORDER: TypeKey[] = ["house", "townhouse", "apartment", "land", "farm", "commercial"];

export const FEATURE_LABEL: Record<FeatureKey, string> = {
  garden: "Garden",
  pool: "Pool",
  garage: "Garage",
  pets: "Pets allowed",
};

export type MapListing = {
  key: string;
  lng: number;
  lat: number;
  kind: ListingKind;
  /** Our mandate / deal state; null for other agencies' listings. */
  state: OurState | null;
  price: number | null;
  address: string;
  suburb: string | null;
  beds: number | null;
  baths: number | null;
  type: TypeKey | null;
  features: FeatureKey[];
  erfSqm: number | null;
  floorSqm: number | null;
  image: string | null;
  agency: string | null;
  sources: SourceKey[];
  prclKey: string | null;
  /** We know the suburb or estate, not the house: drawn as a hollow dot. */
  areaOnly: boolean;
  pin: MergedPin;
};

/** "Vacant Land / Plot", "3 Bedroom House", "Apartment" → one vocabulary. */
export function normaliseType(...texts: (string | null | undefined)[]): TypeKey | null {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (!t) return null;
  if (/vacant land|\bplot\b|\bstand\b|\bland\b/.test(t)) return "land";
  if (/farm|smallholding|agricultural/.test(t)) return "farm";
  if (/apartment|\bflat\b|penthouse|studio/.test(t)) return "apartment";
  if (/townhouse|cluster|duplex|simplex|semi-detached/.test(t)) return "townhouse";
  if (/commercial|industrial|retail|office|warehouse|business/.test(t)) return "commercial";
  if (/house|home|villa|cottage|residence/.test(t)) return "house";
  return null;
}

function ourState(pin: MergedPin): OurState {
  const our = pin.our!;
  if (our.transferStatus === "registered") return "sold";
  if (our.transferStatus === "under_offer" || our.listingStatus === "under_offer") return "under_offer";
  const m = our.mandateType;
  return m === "exclusive" || m === "joint" || m === "open" ? m : "none";
}

export function toListing(pin: MergedPin): MapListing {
  const ext = pin.externals; // sorted by source trust on the server
  const first = <T,>(f: (e: (typeof ext)[number]) => T | null | undefined): T | null => {
    for (const e of ext) {
      const v = f(e);
      if (v != null && v !== "") return v;
    }
    return null;
  };
  const features = new Set<FeatureKey>();
  for (const e of ext) for (const f of e.features ?? []) features.add(f as FeatureKey);
  const kind: ListingKind = pin.our ? "ours" : "market";
  const areaOnly = !pin.our && ext.length > 0 && ext.every((e) => e.geocodeSource === "centroid");
  const suburb = pin.representative.suburb ?? first((e) => e.suburb);
  // "Contact agent for street address" is not an address.
  const hidden = isHiddenAddress(pin.representative.address);
  return {
    key: pin.key,
    lng: pin.lng,
    lat: pin.lat,
    kind,
    state: pin.our ? ourState(pin) : null,
    price: pin.our?.askingPrice ?? pin.representative.price ?? first((e) => e.price),
    // The area-only note on the card says the rest.
    address: hidden ? suburb ?? "Knysna" : pin.representative.address,
    suburb,
    beds: first((e) => e.bedrooms),
    baths: first((e) => e.bathrooms),
    type: normaliseType(pin.our?.propertyType, first((e) => e.propertyType), first((e) => e.headline), pin.our?.listingHeadline),
    features: Array.from(features),
    erfSqm: first((e) => e.erfSqm) ?? pin.our?.extentSqm ?? null,
    floorSqm: first((e) => e.floorSqm),
    image: first((e) => e.imageUrl),
    agency: pin.our ? "Dream Knysna" : first((e) => e.agencyName),
    sources: pin.sources,
    // An area-only pin sits on the suburb's centre, which is somebody
    // else's erf — never highlight it.
    prclKey: areaOnly ? null : pin.our?.prclKey ?? first((e) => e.prclKey),
    areaOnly,
    pin,
  };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type Filters = {
  query: string; // free text: suburb, estate, street
  areas: string[]; // suburbs picked from the suggestions
  priceMin: number | null;
  priceMax: number | null;
  bedsMin: number | null;
  bathsMin: number | null;
  types: TypeKey[];
  features: FeatureKey[];
  showOurs: boolean;
  showMarket: boolean;
  sources: SourceKey[]; // which portals count as "market"
  ourStates: OurState[];
};

export const DEFAULT_FILTERS: Filters = {
  query: "",
  areas: [],
  priceMin: null,
  priceMax: null,
  bedsMin: null,
  bathsMin: null,
  types: [],
  features: [],
  showOurs: true,
  showMarket: true,
  sources: ["property24", "private_property"],
  ourStates: ["exclusive", "joint", "open", "none", "under_offer", "sold"],
};

export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.areas.length || f.query.trim()) n++;
  if (f.priceMin != null || f.priceMax != null) n++;
  if (f.bedsMin != null) n++;
  if (f.bathsMin != null) n++;
  if (f.types.length) n++;
  if (f.features.length) n++;
  return n;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase();

export function matches(l: MapListing, f: Filters): boolean {
  if (l.kind === "ours") {
    if (!f.showOurs) return false;
    if (l.state && !f.ourStates.includes(l.state)) return false;
  } else {
    if (!f.showMarket) return false;
    if (!l.sources.some((s) => f.sources.includes(s))) return false;
  }
  if (f.areas.length) {
    const hay = `${norm(l.suburb)} ${norm(l.address)}`;
    if (!f.areas.some((a) => hay.includes(a.toLowerCase()))) return false;
  }
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = `${norm(l.suburb)} ${norm(l.address)} ${norm(l.pin.externals[0]?.headline)}`;
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (f.priceMin != null && (l.price == null || l.price < f.priceMin)) return false;
  if (f.priceMax != null && (l.price == null || l.price > f.priceMax)) return false;
  if (f.bedsMin != null && (l.beds == null || l.beds < f.bedsMin)) return false;
  if (f.bathsMin != null && (l.baths == null || l.baths < f.bathsMin)) return false;
  if (f.types.length && (!l.type || !f.types.includes(l.type))) return false;
  if (f.features.length && !f.features.every((x) => l.features.includes(x))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Formatting — money is mono and never ambiguous
// ---------------------------------------------------------------------------

/** R 2.45m · R 850k · POA */
export function shortPrice(n: number | null): string {
  if (n == null) return "POA";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `R ${m >= 10 ? m.toFixed(1).replace(/\.0$/, "") : m.toFixed(2).replace(/0$/, "").replace(/\.$/, "")}m`;
  }
  if (n >= 1_000) return `R ${Math.round(n / 1_000)}k`;
  return `R ${n}`;
}

/** 2450000 → "2 450 000". By hand: Node and browsers disagree on the
 *  en-ZA separator (space vs narrow no-break space), which breaks hydration. */
export function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** R 2 450 000 */
export function fullPrice(n: number | null): string {
  if (n == null) return "Price on application";
  return `R ${groupDigits(n)}`;
}

export function sqm(n: number | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 10_000) return `${(n / 10_000).toFixed(2).replace(/0$/, "")} ha`;
  return `${groupDigits(n)} m²`;
}

export const STATE_LABEL: Record<OurState, string> = {
  exclusive: "Exclusive mandate",
  joint: "Joint mandate",
  open: "Open mandate",
  none: "No mandate",
  under_offer: "Under offer",
  sold: "Sold",
};

/** Price steps for the min / max pickers. */
export const PRICE_STEPS = [
  500_000, 1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000, 4_000_000, 5_000_000,
  6_000_000, 7_500_000, 10_000_000, 15_000_000, 20_000_000, 30_000_000,
];

/** Suburb suggestions with counts, most listings first; the bare town name is no help. */
export function areaSuggestions(listings: MapListing[]): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const l of listings) {
    const s = (l.suburb ?? "").trim();
    if (!s || /^knysna$/i.test(s)) continue;
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
