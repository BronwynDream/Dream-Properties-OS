/**
 * Regression test for the 2026-08-05 over-merge.
 *
 * Nine Dream-website listings shared one coordinate (-34.067203, 23.064679)
 * because the WordPress scraper's geocoder returns a single fallback point for
 * every address it can't resolve — and labels it `exact`, so the existing
 * `geocode_source !== 'centroid'` guard never fired. Two of the nine had no
 * price, and the old price gate skipped its ratio check whenever either side
 * was null, so those two unioned with everything at 0m and chained R895k to
 * R60M into a single map pin.
 *
 * Run: npm run test:dedup
 *
 * Both assertions matter. The first proves the collided rows no longer merge;
 * the second proves we haven't broken genuine cross-portal dedup, which is the
 * whole point of the clustering step. Reverting either guard in dedup.ts makes
 * the first one fail (verified — it collapses back to 1 group).
 */
import { rebuildDedupAndMatch } from "../dedup";

const LAT = -34.067203;
const LNG = 23.064679;

const collided = [
  { addr: "The Boat Aerial View", price: 60000000 },
  { addr: "C13 Updated Photos", price: 19900000 },
  { addr: "Anotated", price: 17500000 },
  { addr: "African Breeze", price: 16750000 },
  { addr: "Crabs Creek", price: 13000000 },
  { addr: "Angie", price: 5900000 },
  { addr: "Avril", price: 895000 },
  { addr: "Fish Eagle Lodge Welbedacht", price: null },
  { addr: "Sandpoint", price: null },
].map((l, i) => ({
  id: `collided-${i}`,
  source: "dream_website",
  address_raw: l.addr,
  price: l.price,
  lat: LAT,
  lng: LNG,
  lightstone_property_id: null,
  prcl_key: null,
  matched_property_id: null,
  dedup_group_id: null,
  geocode_source: "exact",
}));

// Same house on two portals: 8 m apart, 1.25% price difference. Must merge.
const genuine = [
  {
    id: "genuine-a",
    source: "property24",
    address_raw: "12 Eagles Way",
    price: 8000000,
    lat: -34.05,
    lng: 23.05,
    lightstone_property_id: null,
    prcl_key: null,
    matched_property_id: null,
    dedup_group_id: null,
    geocode_source: "exact",
  },
  {
    id: "genuine-b",
    source: "private_property",
    address_raw: "12 Eagles Way Knysna",
    price: 7900000,
    lat: -34.050072,
    lng: 23.05,
    lightstone_property_id: null,
    prcl_key: null,
    matched_property_id: null,
    dedup_group_id: null,
    geocode_source: "exact",
  },
];

const rows = [...collided, ...genuine];
const patches = new Map<string, Record<string, unknown>>();

/* eslint-disable @typescript-eslint/no-explicit-any */
const supabase: any = {
  from(table: string) {
    if (table === "external_listing") {
      return {
        select: () => ({ eq: () => Promise.resolve({ data: rows }) }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => {
            patches.set(id, patch);
            return { error: null };
          },
        }),
      };
    }
    return { select: () => Promise.resolve({ data: [] }) };
  },
};

(async () => {
  await rebuildDedupAndMatch(supabase);
  const groupOf = (id: string) => String(patches.get(id)?.dedup_group_id ?? "none");

  const collidedGroups = new Set(collided.map((r) => groupOf(r.id)));
  const genuineMerged = groupOf("genuine-a") === groupOf("genuine-b");

  const failures: string[] = [];
  if (collidedGroups.size !== collided.length) {
    failures.push(
      `collided rows merged: ${collided.length} listings on one fallback coordinate collapsed into ${collidedGroups.size} group(s), expected ${collided.length}`,
    );
  }
  if (!genuineMerged) {
    failures.push("genuine cross-portal duplicate no longer merges");
  }

  if (failures.length) {
    for (const f of failures) console.error(`FAIL  ${f}`);
    process.exit(1);
  }
  console.log(
    `PASS  ${collided.length} collided listings stayed separate; genuine duplicate still merged`,
  );
})();
