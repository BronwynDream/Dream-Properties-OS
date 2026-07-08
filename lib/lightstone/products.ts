import type { Product } from "./adapter";

// Menu of Lightstone products Dream will typically use. Rendered as the
// checkbox list in the Fetch modal. Order = display priority.
export const PRODUCTS: Product[] = [
  {
    code: "title_deed",
    label: "Title Deed",
    description:
      "Registered title deed from the Deeds Office — the primary evidence of ownership.",
  },
  {
    code: "deeds_search",
    label: "Deeds Search",
    description:
      "Property + owner registration summary. Faster than the full deed for a quick check.",
  },
  {
    code: "ownership",
    label: "Ownership Timeline",
    description:
      "Chain of registered owners over time. Useful for referral history and comparables.",
  },
  {
    code: "avm",
    label: "AVM Valuation",
    description:
      "Automated valuation estimate. Ballpark for CMA anchoring, not a formal valuation.",
  },
  {
    code: "property_report",
    label: "Property Report",
    description:
      "Full property report — municipal data, comparables, market context in one PDF.",
  },
  {
    code: "comparables",
    label: "Comparable Sales",
    description:
      "Recent recorded sales in the surrounding area, ranked by distance and time.",
  },
];
