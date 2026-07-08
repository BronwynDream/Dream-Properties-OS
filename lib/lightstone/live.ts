/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AddressCandidate,
  FetchResult,
  FetchedProduct,
  LightstoneAdapter,
  OwnerFact,
  Product,
  ProductCode,
  PropertyRef,
  StructuredFields,
} from "./adapter";
import { PRODUCTS } from "./products";
import { guardedGet } from "./gateway";

// Live Lightstone adapter — talks to the Lightstone Azure API Management
// gateway. Two APIs are used, chained:
//
//   1. Property Search  (lspsearch/v1) — resolves a free-text address into
//      candidate properties, each carrying a numeric `propertyId` (the key into
//      the Lightstone "Defined Property Layer").
//   2. Property Data    (lspdata/v1)   — returns JSON facets for a propertyId:
//      address+spatial, owners, legal (title deed), land (erf/extent),
//      municipal, avm, comparables.
//
// IMPORTANT: Property Data is JSON-per-facet, NOT a PDF document per product.
// So each fetched "product" here stores the raw JSON response as its document
// (application/json) — giving the existing document-promotion + viewer pipeline
// an artifact to show and audit — AND parses the fields we care about into
// StructuredFields for record population.
//
// Auth:
//   LIGHTSTONE_API_KEY  → Ocp-Apim-Subscription-Key header
//   LIGHTSTONE_API_BASE → gateway root, e.g. https://apis.lightstone.co.za
//
// CONFIRM-ON-LIVE: at the time of writing, Lightstone returned HTTP 500 on
// every endpoint (subscription Active in the portal but the data contract not
// yet provisioned on the backend), so only the *documented* response schemas
// were available. The Property Search and /property/{id}/address field names
// are confirmed from the docs; the owners / legal / land field names are
// best-effort with multiple candidate keys and MUST be re-checked against a
// real 200 response. Because the full raw JSON is always stored on the
// document, nothing is lost if a mapping key is slightly off — we just refine
// the parse* helpers below.

const SEARCH_PREFIX = "/lspsearch/v1";
const DATA_PREFIX = "/lspdata/v1";

// All calls to Lightstone are routed through guardedGet — the cost-control
// gateway that reads/writes lightstone_budget + lightstone_usage. auth
// headers, base URL, and error surfacing live there.
//
// Billable vs not:
//   - Property Search (/lspsearch/v1/address) and /health/status are cheap
//     or free per the current Lightstone rate card — billable: false.
//   - Every Property Data facet (/lspdata/v1/property/{id}/...) is billable.
type FacetMeta = {
  endpoint: string;
  lightstonePropertyId?: number;
  userId?: string;
  ourPropertyId?: string;
};
function billableFacet(path: string, meta: FacetMeta): Promise<any> {
  return guardedGet(path, { ...meta, billable: true });
}
function freeCall(path: string, meta: FacetMeta): Promise<any> {
  return guardedGet(path, { ...meta, billable: false });
}

// Try several candidate keys on an object; return the first non-empty value.
function pick<T = any>(obj: any, keys: string[]): T | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}
function num(v: any): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
function clean(o: Record<string, any>): StructuredFields | undefined {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return Object.keys(out).length ? (out as StructuredFields) : undefined;
}
// Merge several partial StructuredFields; first non-empty wins per scalar key,
// owners are concatenated.
function mergeFields(...parts: (StructuredFields | undefined)[]): StructuredFields | undefined {
  const merged: Record<string, any> = {};
  const owners: OwnerFact[] = [];
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (k === "owners") {
        if (Array.isArray(v)) owners.push(...(v as OwnerFact[]));
        continue;
      }
      if (merged[k] === undefined && v !== undefined) merged[k] = v;
    }
  }
  if (owners.length) merged.owners = owners;
  return Object.keys(merged).length ? (merged as StructuredFields) : undefined;
}

// --- Property Search result → AddressCandidate (field names confirmed) -------
function mapCandidate(r: any): AddressCandidate {
  return {
    propertyId: num(pick(r, ["propertyId"])) ?? 0,
    addressString: pick(r, ["addressString", "description", "name"]) ?? "",
    streetNumber: pick(r, ["streetNumber"]),
    streetName: pick(r, ["streetName"]),
    suburb: pick(r, ["suburbName", "suburb"]),
    town: pick(r, ["townName", "town"]),
    municipality: pick(r, ["municipalityName", "municipality"]),
    province: pick(r, ["provinceName", "province"]),
    postCode: pick(r, ["postCode", "postalCode"]),
    estateName: pick(r, ["estateName"]),
    schemeName: pick(r, ["schemeName"]),
    relevanceScore: num(pick(r, ["relevanceScore"])),
    raw: r,
  };
}

// --- Property Data facet parsers ---------------------------------------------
// /property/{id}/address — field names CONFIRMED from docs.
function parseAddress(a: any): StructuredFields | undefined {
  if (!a) return undefined;
  return clean({
    suburb: pick(a, ["suburb", "suburbName"]),
    town: pick(a, ["town", "townName"]),
    municipality: pick(a, ["municipality", "municipalityName"]),
    province: pick(a, ["province", "provinceName"]),
    postal_code: pick(a, ["postalCode", "postCode"]),
    estate_name: pick(a, ["estateName"]),
    scheme_name: pick(a, ["schemeName"]),
    // Lightstone gives coordinateX = longitude, coordinateY = latitude.
    latitude: num(pick(a, ["coordinateY", "latitude", "lat"])),
    longitude: num(pick(a, ["coordinateX", "longitude", "lng", "lon"])),
  });
}
// /property/{id}/legal — field names UNCONFIRMED (confirm on live 200).
function parseLegal(l: any): StructuredFields | undefined {
  if (!l) return undefined;
  return clean({
    title_deed_no: pick(l, [
      "titleDeedNumber",
      "titleDeedNo",
      "deedNumber",
      "deedNo",
      "titleDeed",
    ]),
    erf_number: pick(l, ["erfNumber", "erf", "portionNumber", "standNumber"]),
  });
}
// /property/{id}/land — field names UNCONFIRMED (confirm on live 200).
function parseLand(l: any): StructuredFields | undefined {
  if (!l) return undefined;
  return clean({
    extent_sqm: num(
      pick(l, ["extent", "extentSqm", "erfSize", "landSize", "size", "areaSqm"]),
    ),
    erf_number: pick(l, ["erfNumber", "erf", "standNumber"]),
  });
}
// /property/{id}/owners — field names UNCONFIRMED (confirm on live 200).
// Tolerates either a bare array or an object wrapping the array.
function parseOwners(o: any): StructuredFields | undefined {
  if (!o) return undefined;
  const arr: any[] = Array.isArray(o)
    ? o
    : o.owners || o.results || o.data || o.results?.owners || [];
  const owners: OwnerFact[] = [];
  for (const row of arr) {
    const name = pick(row, [
      "ownerName",
      "name",
      "fullName",
      "registeredOwner",
      "displayName",
      "owner",
    ]);
    if (!name) continue;
    owners.push({
      display_name: String(name).trim(),
      id_number: pick(row, ["idNumber", "identityNumber", "registrationNumber", "idNo"]),
      is_current: pick(row, ["isCurrent", "current"]) ?? true,
    });
  }
  return owners.length ? { owners } : undefined;
}

export class LiveLightstoneAdapter implements LightstoneAdapter {
  listProducts(): Product[] {
    return PRODUCTS;
  }

  // Property Search — free-text address → candidate properties. Marked
  // billable:false; the Property Search endpoint is cheap/free per rate card.
  async searchAddress(query: string): Promise<AddressCandidate[]> {
    const q = query?.trim();
    if (!q) return [];
    const data = await freeCall(
      `${SEARCH_PREFIX}/address?query=${encodeURIComponent(q)}`,
      { endpoint: "address_search" },
    );
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    return results.map(mapCandidate).filter((c) => c.propertyId > 0);
  }

  async fetchProducts(
    ref: PropertyRef,
    productCodes: ProductCode[],
  ): Promise<FetchResult> {
    const fetched: FetchedProduct[] = [];
    const errors: string[] = [];

    // Resolve the Lightstone propertyId. Prefer an explicit id on the ref
    // (captured at take-on); otherwise fall back to an address search.
    let propertyId = ref.propertyId;
    if (!propertyId && ref.address) {
      try {
        const cands = await this.searchAddress(ref.address);
        propertyId = cands[0]?.propertyId;
      } catch (e) {
        errors.push(`address search failed: ${(e as Error).message}`);
      }
    }
    if (!propertyId) {
      errors.push(
        "no Lightstone propertyId (provide ref.propertyId, or a ref.address the search can resolve)",
      );
      return { source: "live", fetched, errors };
    }

    for (const code of productCodes) {
      const product = PRODUCTS.find((p) => p.code === code);
      if (!product) {
        errors.push(`unknown product code: ${code}`);
        continue;
      }
      try {
        const { json, structuredFields } = await this.fetchFacet(code, propertyId);
        const bytes = new TextEncoder().encode(JSON.stringify(json, null, 2));
        const slug = (ref.address ?? String(propertyId))
          .replace(/[^a-zA-Z0-9]+/g, "-")
          .slice(0, 60);
        fetched.push({
          code,
          label: product.label,
          source: "live",
          documentTitle: `Lightstone ${product.label} — ${slug}`,
          documentBytes: bytes,
          documentMime: "application/json",
          structuredFields,
        });
      } catch (e) {
        errors.push(`${product.label}: ${(e as Error).message}`);
      }
    }

    return { source: "live", fetched, errors };
  }

  // Map one product code → one or more Property Data facet calls, returning the
  // combined raw JSON (stored as the document) and parsed StructuredFields.
  // Every facet call is billable and goes through the gateway with the
  // Lightstone propertyId in meta so the ledger can show per-property spend.
  private async fetchFacet(
    code: ProductCode,
    id: number,
  ): Promise<{ json: any; structuredFields?: StructuredFields }> {
    const P = `${DATA_PREFIX}/property/${id}`;
    const m = (endpoint: string) => ({ endpoint, lightstonePropertyId: id });

    switch (code) {
      case "title_deed": {
        const [legal, land] = await Promise.all([
          billableFacet(`${P}/legal`, m("legal")).catch(() => null),
          billableFacet(`${P}/land`, m("land")).catch(() => null),
        ]);
        return {
          json: { legal, land },
          structuredFields: mergeFields(parseLegal(legal), parseLand(land)),
        };
      }
      case "deeds_search": {
        const [owners, address] = await Promise.all([
          billableFacet(`${P}/owners`, m("owners")).catch(() => null),
          billableFacet(`${P}/address`, m("address")).catch(() => null),
        ]);
        return {
          json: { owners, address },
          structuredFields: mergeFields(parseOwners(owners), parseAddress(address)),
        };
      }
      case "ownership": {
        const owners = await billableFacet(`${P}/owners`, m("owners"));
        return { json: { owners }, structuredFields: parseOwners(owners) };
      }
      case "avm": {
        const [avm, avmrange] = await Promise.all([
          billableFacet(`${P}/avm`, m("avm")).catch(() => null),
          billableFacet(`${P}/avmrange`, m("avmrange")).catch(() => null),
        ]);
        return { json: { avm, avmrange } };
      }
      case "comparables": {
        const comparables = await billableFacet(`${P}/comparables`, m("comparables"));
        return { json: { comparables } };
      }
      case "property_report": {
        const [address, legal, land, owners, municipal] = await Promise.all([
          billableFacet(`${P}/address`, m("address")).catch(() => null),
          billableFacet(`${P}/legal`, m("legal")).catch(() => null),
          billableFacet(`${P}/land`, m("land")).catch(() => null),
          billableFacet(`${P}/owners`, m("owners")).catch(() => null),
          billableFacet(`${P}/municipal`, m("municipal")).catch(() => null),
        ]);
        return {
          json: { address, legal, land, owners, municipal },
          structuredFields: mergeFields(
            parseAddress(address),
            parseLegal(legal),
            parseLand(land),
            parseOwners(owners),
          ),
        };
      }
      default:
        throw new Error(`no facet mapping for product code ${code}`);
    }
  }
}
