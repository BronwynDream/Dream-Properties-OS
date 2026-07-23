import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

// Cluster + match every active external_listing.
//
// Called at the tail of every source refresh, so a single row that just
// changed can drag its cluster into shape (e.g. a Property24 listing that
// was matched by geo-proximity yesterday can be re-matched by lightstone id
// when we scrape today's Dream page and learn the LS id).
//
// Cluster keys (checked in order for each active row):
//   1. same lightstone_property_id → same group
//   2. same normalised address       → same group
//   3. within ~20 m AND price within 15% → same group
// If any cluster member already has a dedup_group_id we reuse it; otherwise
// we mint a new uuid.
//
// Match to our DB (only for rows with matched_property_id IS NULL so a
// manual match is never overwritten — a future manual-override table can
// harden this further):
//   1. lightstone_property_id === property.lightstone_property_id
//   2. normalised address === property.primary_address
//   3. geo-proximity (~50 m)

/* eslint-disable @typescript-eslint/no-explicit-any */

const CLUSTER_METERS = 20;
const CLUSTER_PRICE_RATIO = 0.15;
const MATCH_METERS = 50;

type Row = {
  id: string;
  source: string;
  address_raw: string | null;
  price: number | null;
  lat: number | null;
  lng: number | null;
  lightstone_property_id: number | null;
  prcl_key: string | null;
  matched_property_id: string | null;
  dedup_group_id: string | null;
};

type Prop = {
  id: string;
  primary_address: string | null;
  lat: number | null;
  lng: number | null;
  lightstone_property_id: number | null;
  prcl_key: string | null;
};

// Garden Route suburb names (and common misspellings) that appear as trailing
// noise on address strings. Both sides need stripping — our records store
// "6 Bowden Park, Leisure Isle, Knysna", scrapers extract "Eagles Way" from
// image filenames with no suburb, and marketing headlines carry "LI" for
// "Leisure Isle". Order matters: strip longest names first so "leisure isle"
// doesn't leave "isle" behind.
const SUBURB_NOISE = [
  "leisure island",
  "leisure isle",
  "the heads",
  "pezula private estate",
  "pezula golf estate",
  "pezula",
  "brenton on sea",
  "brenton",
  "belvidere estate",
  "belvidere",
  "eastford vale",
  "eastford",
  "knysna waterfront",
  "knysna quays",
  "knysna heights",
  "knysna central",
  "knysna",
  "sedgefield",
  "rheenendal",
  "simola",
  "thesen islands",
  "thesen",
  "costa sarda",
  "paradise",
];

// Collapse an address to a stable comparable form. Aggressive noise-stripping
// so scraper-extracted "15 Eagles Way Evening" and our stored
// "15 EAGLES WAY, THE HEADS, KNYSNA" both normalise to "15 eagles way".
export function normaliseAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw
    .toLowerCase()
    .replace(/[,.]/g, " ")
    .replace(/\bsouth africa\b/g, "")
    .replace(/\bwestern cape\b/g, "")
    .replace(/\b(6\d{3})\b/g, "") // Garden Route postal codes are 6xxx
    .replace(/\s+/g, " ")
    .trim();

  // Strip suburb suffixes iteratively — "6 bowden park leisure isle knysna"
  // → "6 bowden park". Only strips at the tail, so "brenton road" (a road
  // that happens to share a suburb name) stays intact.
  let changed = true;
  while (changed) {
    changed = false;
    for (const suburb of SUBURB_NOISE) {
      if (s.endsWith(" " + suburb) || s === suburb) {
        s = s.slice(0, s.length - suburb.length).trim();
        changed = true;
        break;
      }
    }
    // "LI" abbreviation for Leisure Isle when it's a standalone trailing word
    if (s.endsWith(" li")) {
      s = s.slice(0, -3).trim();
      changed = true;
    }
    // Marketing suffixes that occasionally appear after the address in image
    // filenames: "Evening", "Morning", "Special", "Featured", "Sale". Only
    // stripped as trailing single tokens so they don't clobber street names.
    for (const suffix of ["evening", "morning", "special", "featured", "sale", "new"]) {
      if (s.endsWith(" " + suffix)) {
        s = s.slice(0, s.length - suffix.length - 1).trim();
        changed = true;
      }
    }
  }
  return s;
}

// Address tokens for the subset-match rule. "19 glenview" ⊆ "19 glenview road
// the heads" means every token of the listing address appears in the
// property address — used to bind a portal-scraped short address to the
// canonical property record without a lightstone id.
function addressTokens(raw: string | null | undefined): string[] {
  const n = normaliseAddress(raw);
  if (n.length === 0) return [];
  return n.split(/\s+/).filter((t) => t.length > 0);
}

// Metres between two WGS84 points via haversine. Small enough that the flat-
// earth approximation would work for Knysna-scale distances, but haversine is
// only marginally more expensive and doesn't drift near the pole.
function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Union-find (path-compressed) — small and fine for our row counts.
class Union {
  parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p === x) {
      this.parent.set(x, x);
      return x;
    }
    p = this.find(p);
    this.parent.set(x, p);
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export async function rebuildDedupAndMatch(
  supabase: SupabaseClient,
): Promise<{ clustered: number; matched: number; groups: number }> {
  const { data: rowsData } = await supabase
    .from("external_listing")
    .select(
      "id, source, address_raw, price, lat, lng, lightstone_property_id, prcl_key, matched_property_id, dedup_group_id",
    )
    .eq("active", true);
  const rows = (rowsData ?? []) as Row[];
  if (rows.length === 0) return { clustered: 0, matched: 0, groups: 0 };

  const { data: propsData } = await supabase
    .from("property")
    .select("id, primary_address, lat, lng, lightstone_property_id, prcl_key");
  const props = (propsData ?? []) as Prop[];

  // ---- CLUSTERING ---------------------------------------------------------
  const uf = new Union();
  for (const r of rows) uf.find(r.id);

  // Same lightstone id → same cluster
  const byLs = new Map<number, string[]>();
  for (const r of rows) {
    if (r.lightstone_property_id == null) continue;
    const list = byLs.get(r.lightstone_property_id) ?? [];
    list.push(r.id);
    byLs.set(r.lightstone_property_id, list);
  }
  for (const ids of byLs.values()) {
    for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);
  }

  // Same prcl_key → same cluster. Cadastre-snapped rows on the same erf
  // are unambiguously the same physical listing.
  const byPrcl = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.prcl_key) continue;
    const list = byPrcl.get(r.prcl_key) ?? [];
    list.push(r.id);
    byPrcl.set(r.prcl_key, list);
  }
  for (const ids of byPrcl.values()) {
    for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);
  }

  // Same normalised address → same cluster
  const byAddr = new Map<string, string[]>();
  for (const r of rows) {
    const n = normaliseAddress(r.address_raw);
    if (n.length < 5) continue;
    const list = byAddr.get(n) ?? [];
    list.push(r.id);
    byAddr.set(n, list);
  }
  for (const ids of byAddr.values()) {
    for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);
  }

  // Geo-proximity within CLUSTER_METERS AND price within CLUSTER_PRICE_RATIO
  const geo = rows.filter((r) => r.lat != null && r.lng != null);
  for (let i = 0; i < geo.length; i++) {
    for (let j = i + 1; j < geo.length; j++) {
      const a = geo[i];
      const b = geo[j];
      const d = metresBetween(
        { lat: Number(a.lat), lng: Number(a.lng) },
        { lat: Number(b.lat), lng: Number(b.lng) },
      );
      if (d > CLUSTER_METERS) continue;
      if (a.price != null && b.price != null) {
        const min = Math.min(a.price, b.price);
        const max = Math.max(a.price, b.price);
        if (max > 0 && (max - min) / max > CLUSTER_PRICE_RATIO) continue;
      }
      uf.union(a.id, b.id);
    }
  }

  // Root → dedup_group_id. Prefer an already-assigned group id inside the
  // cluster so pins don't reshuffle their uuids every refresh.
  const clusterMembers = new Map<string, string[]>();
  for (const r of rows) {
    const root = uf.find(r.id);
    const list = clusterMembers.get(root) ?? [];
    list.push(r.id);
    clusterMembers.set(root, list);
  }
  const groupIdFor = new Map<string, string>();
  for (const [root, memberIds] of clusterMembers) {
    const existing = memberIds
      .map((id) => rows.find((r) => r.id === id)!.dedup_group_id)
      .find((g) => !!g);
    groupIdFor.set(root, existing ?? randomUUID());
  }

  // ---- MATCH TO OUR PROPERTIES --------------------------------------------
  // Only for rows without a matched_property_id — a manually-set match is
  // preserved. (When a manual-override table lands, that guard moves here.)
  //
  // Order (strongest → weakest):
  //   1. lightstone id
  //   2. prcl_key (same erf = same property, once the cadastre is loaded)
  //   3. normalised address exact
  //   4. token-subset ("19 glenview" ⊆ "19 glenview road the heads")
  //   5. geo-proximity
  const propByLs = new Map<number, string>();
  for (const p of props) {
    if (p.lightstone_property_id != null) {
      propByLs.set(Number(p.lightstone_property_id), p.id);
    }
  }
  const propByPrcl = new Map<string, string>();
  for (const p of props) {
    if (p.prcl_key && !propByPrcl.has(p.prcl_key)) propByPrcl.set(p.prcl_key, p.id);
  }
  const propByAddr = new Map<string, string>();
  for (const p of props) {
    const n = normaliseAddress(p.primary_address);
    if (n.length >= 5 && !propByAddr.has(n)) propByAddr.set(n, p.id);
  }
  // Pre-compute property token sets once — matchFor is O(rows × props) with
  // this sub-loop but tokens are cheap and the row counts are small.
  const propTokenSets: { id: string; tokens: Set<string> }[] = props
    .map((p) => ({ id: p.id, tokens: new Set(addressTokens(p.primary_address)) }))
    .filter((p) => p.tokens.size > 0);
  const propsWithGeo = props.filter((p) => p.lat != null && p.lng != null);

  function matchFor(r: Row): string | null {
    if (r.lightstone_property_id != null) {
      const hit = propByLs.get(Number(r.lightstone_property_id));
      if (hit) return hit;
    }
    if (r.prcl_key) {
      const hit = propByPrcl.get(r.prcl_key);
      if (hit) return hit;
    }
    const n = normaliseAddress(r.address_raw);
    if (n.length >= 5) {
      // Exact after normalisation. Common now that both sides strip suburb
      // suffixes ("15 eagles way" from both sides).
      const hit = propByAddr.get(n);
      if (hit) return hit;

      // Prefix match either direction. Handles marketing suffixes still
      // clinging to scraper output that the normaliser doesn't recognise
      // ("15 eagles way evening" starts with "15 eagles way"), and stored
      // addresses with extra road-type words ("6 bowden park road" starts
      // with "6 bowden park"). Guard: shorter side must be ≥5 chars and
      // start with a digit — prevents "1" matching "1 anything".
      if (/^\d/.test(n)) {
        for (const [propN, propId] of propByAddr) {
          if (Math.min(n.length, propN.length) < 5) continue;
          if (!/^\d/.test(propN)) continue;
          if (propN.startsWith(n) || n.startsWith(propN)) return propId;
        }
      }
    }
    // Token-subset: every listing token must appear in the property's tokens.
    // Post-normalisation-fix, this catches the rare cases where prefix match
    // fails due to token reordering ("eagles way 15" — unlikely but possible).
    // House-number guard kept: prevents suburb-only matches ("the heads"
    // latching onto every Heads property).
    const lt = addressTokens(r.address_raw);
    if (lt.length >= 2 && lt.some((t) => /^\d/.test(t))) {
      for (const p of propTokenSets) {
        if (lt.every((t) => p.tokens.has(t))) return p.id;
      }
    }
    if (r.lat != null && r.lng != null) {
      let best: { id: string; d: number } | null = null;
      for (const p of propsWithGeo) {
        const d = metresBetween(
          { lat: Number(r.lat), lng: Number(r.lng) },
          { lat: Number(p.lat!), lng: Number(p.lng!) },
        );
        if (d <= MATCH_METERS && (!best || d < best.d)) best = { id: p.id, d };
      }
      if (best) return best.id;
    }
    return null;
  }

  // ---- WRITE BACK ---------------------------------------------------------
  let clustered = 0;
  let matched = 0;
  for (const r of rows) {
    const root = uf.find(r.id);
    const newGroup = groupIdFor.get(root)!;
    const newMatch =
      r.matched_property_id ?? matchFor(r) ?? null;

    const changedGroup = r.dedup_group_id !== newGroup;
    const changedMatch = r.matched_property_id !== newMatch;
    if (!changedGroup && !changedMatch) continue;

    const patch: Record<string, unknown> = {};
    if (changedGroup) patch.dedup_group_id = newGroup;
    if (changedMatch) patch.matched_property_id = newMatch;

    await supabase.from("external_listing").update(patch).eq("id", r.id);

    if (changedGroup) clustered++;
    if (changedMatch && newMatch) matched++;
  }

  return {
    clustered,
    matched,
    groups: new Set(groupIdFor.values()).size,
  };
}
