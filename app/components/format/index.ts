// Shared display components enforcing SA formatting conventions across
// the OS. Import from here so a future format tweak (e.g. cents display
// rule for levies) is a one-place change.
//
// Aligned to the estate-agency-design skill:
//   - Rand: "R 2 450 000" prices; "R 3 250,00" for cents contexts
//   - Area: "682 m²" (opt into "1.2 ha" for land / farms)
//   - PropertyDate: "14 Aug 2026" (or ISO in tables); label prop names
//     which date so multiple date fields don't blur together
//   - Ref: verbatim monospace for erf / SG21 / deed / listing ref
export { default as Rand } from "./Rand";
export { default as Area } from "./Area";
export { default as PropertyDate } from "./PropertyDate";
export { default as Ref } from "./Ref";
export { default as ListingStatusPill } from "./ListingStatusPill";
export type { ListingStatus } from "./ListingStatusPill";
