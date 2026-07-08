import type {
  FetchResult,
  LightstoneAdapter,
  Product,
  ProductCode,
  PropertyRef,
} from "./adapter";
import { PRODUCTS } from "./products";

// Live Lightstone adapter — TODO stub until credentials + the exact
// Azure-API-portal request shape are provisioned. Deliberately throws so a
// mis-configured environment (e.g. LIGHTSTONE_API_BASE set but no code
// written) fails loudly rather than silently returning SAMPLE data.
//
// When implementing:
//   * signed request with LIGHTSTONE_API_KEY in the Ocp-Apim-Subscription-Key
//     header (Lightstone uses Azure API Management gateways).
//   * one endpoint per product (title-deed, deeds-search, ownership, avm,
//     property-report, comparables) OR a single dispatch with productCode —
//     confirm on ticket with Lightstone.
//   * response is usually a JSON envelope + a URL to the PDF blob; fetch the
//     PDF, base64-decode into Uint8Array, populate documentBytes.
//   * parse structured fields into StructuredFields (title_deed_no, extent,
//     owners) — same shape the stub uses so downstream code is unchanged.

export class LiveLightstoneAdapter implements LightstoneAdapter {
  listProducts(): Product[] {
    return PRODUCTS;
  }

  async fetchProducts(
    _ref: PropertyRef,
    _productCodes: ProductCode[],
  ): Promise<FetchResult> {
    throw new Error(
      "Lightstone live adapter not implemented yet. Unset LIGHTSTONE_API_BASE / LIGHTSTONE_API_KEY to fall back to the stub, or wire lib/lightstone/live.ts.",
    );
  }
}
