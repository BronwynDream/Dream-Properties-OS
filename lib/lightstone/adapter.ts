// Lightstone adapter interface — one seam for the live API to plug into.
//
// Dream doesn't have Lightstone API credentials yet (Aug 2023 Competition
// Commission ruling gave them free interoperability with portals but the
// property-data side is still on the Lightstone Azure API portal, sold per
// tier). Everything downstream (UI, /api/lightstone route, document
// promotion) is built against this interface so the day the credentials land
// is a one-file swap in ./index.ts.
//
// Every result carries a `source` field. Stub results are visually marked
// as SAMPLE on the Property Record so no one confuses a sample title deed
// for a real one.

export type ProductCode =
  | "title_deed"
  | "deeds_search"
  | "ownership"
  | "avm"
  | "property_report"
  | "comparables";

export type Product = {
  code: ProductCode;
  label: string;
  description: string;
};

// The property being looked up. All fields optional; the adapter uses whichever
// it can — deed is most reliable, then erf, then address.
export type PropertyRef = {
  address?: string;
  erf?: string;
  deed?: string;
};

// Structured fields the adapter parses out of the returned document, ready
// to coalesce into property + party rows. Never overwrite non-null property
// fields.
export type OwnerFact = {
  display_name: string;
  id_number?: string;
  is_current?: boolean;
};

export type StructuredFields = {
  title_deed_no?: string;
  extent_sqm?: number;
  owners?: OwnerFact[];
};

export type FetchedProduct = {
  code: ProductCode;
  label: string;
  source: "stub" | "live";
  documentTitle: string;
  documentBytes: Uint8Array;
  documentMime: string;
  structuredFields?: StructuredFields;
};

export type FetchResult = {
  source: "stub" | "live";
  fetched: FetchedProduct[];
  errors: string[];
};

export interface LightstoneAdapter {
  listProducts(): Product[];
  fetchProducts(
    ref: PropertyRef,
    productCodes: ProductCode[],
  ): Promise<FetchResult>;
}
