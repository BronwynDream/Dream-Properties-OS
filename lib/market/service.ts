/* eslint-disable @typescript-eslint/no-explicit-any */

import { createServiceClient } from "@/lib/supabase/service";
import { guardedGet } from "@/lib/lightstone/gateway";

// Cache-first accessor for the Market layer. Every Lightstone Property Data
// facet on a Defined Property Layer id (the numeric "lightstone_property_id")
// lands in market_property once and stays there. The gateway is only
// consulted on a real miss — or when the caller passes { force: true } to
// simulate a Refresh button. If a facet is fresh under its own freshness
// rule, we ledger a cache_hit and return the cached JSON.
//
// Freshness rules (spec):
//   deeds        — permanent (only manual refresh, or triggered on new registered transfer)
//   ownership    — permanent (same)
//   last_sale    — permanent (same)
//   comparables  — permanent (same)
//   avm          — 12 months
// The "new registered transfer" trigger is out of scope for this ship —
// callers can pass force:true when they know something's changed. A future
// server-side trigger on transfer.status = 'registered' can flip the same
// bit by updating market_property.<facet>_fetched_at to null.

export type MarketFacet =
  | "deeds"
  | "ownership"
  | "last_sale"
  | "comparables"
  | "avm"
  | "address"
  | "legal"
  | "land";

const AVM_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 12 months

// Facet → (json column, fetched_at column, TTL in ms). TTL 0 = permanent.
const FACET_COLS: Record<
  MarketFacet,
  { json: string; fetchedAt: string; ttlMs: number; path: (id: number) => string; endpoint: string }
> = {
  deeds: {
    json: "legal_json",
    fetchedAt: "legal_fetched_at",
    ttlMs: 0,
    path: (id) => `/lspdata/v1/property/${id}/legal`,
    endpoint: "legal",
  },
  legal: {
    json: "legal_json",
    fetchedAt: "legal_fetched_at",
    ttlMs: 0,
    path: (id) => `/lspdata/v1/property/${id}/legal`,
    endpoint: "legal",
  },
  land: {
    json: "land_json",
    fetchedAt: "land_fetched_at",
    ttlMs: 0,
    path: (id) => `/lspdata/v1/property/${id}/land`,
    endpoint: "land",
  },
  address: {
    json: "address_json",
    fetchedAt: "address_fetched_at",
    ttlMs: 0,
    path: (id) => `/lspdata/v1/property/${id}/address`,
    endpoint: "address",
  },
  ownership: {
    json: "owners_json",
    fetchedAt: "ownership_fetched_at",
    ttlMs: 0,
    path: (id) => `/lspdata/v1/property/${id}/owners`,
    endpoint: "owners",
  },
  last_sale: {
    json: "last_sale_json",
    fetchedAt: "last_sale_fetched_at",
    ttlMs: 0,
    path: (id) => `/lspdata/v1/property/${id}/lastsale`,
    endpoint: "last_sale",
  },
  comparables: {
    json: "comparables_json",
    fetchedAt: "comparables_fetched_at",
    ttlMs: 0,
    path: (id) => `/lspdata/v1/property/${id}/comparables`,
    endpoint: "comparables",
  },
  avm: {
    json: "avm_json",
    fetchedAt: "avm_fetched_at",
    ttlMs: AVM_TTL_MS,
    path: (id) => `/lspdata/v1/property/${id}/avm`,
    endpoint: "avm",
  },
};

function isFresh(fetchedAt: string | null, ttlMs: number): boolean {
  if (!fetchedAt) return false;
  if (ttlMs === 0) return true; // permanent cache when we have any timestamp
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age < ttlMs;
}

export type GetFacetOpts = {
  force?: boolean;
  userId?: string;
  ourPropertyId?: string;
};

export async function getMarketFacet<T = any>(
  lightstonePropertyId: number,
  facet: MarketFacet,
  opts: GetFacetOpts = {},
): Promise<T | null> {
  const supabase = createServiceClient();
  const cfg = FACET_COLS[facet];
  if (!cfg) throw new Error(`unknown market facet: ${facet}`);

  const { data: row } = await supabase
    .from("market_property")
    .select(`${cfg.json}, ${cfg.fetchedAt}, matched_property_id`)
    .eq("lightstone_property_id", lightstonePropertyId)
    .maybeSingle();

  const cachedJson = (row as any)?.[cfg.json] ?? null;
  const cachedAt = (row as any)?.[cfg.fetchedAt] ?? null;

  if (!opts.force && cachedJson != null && isFresh(cachedAt, cfg.ttlMs)) {
    // Cache hit — write a ledger row so admins can see we saved a call.
    await supabase.from("lightstone_usage").insert({
      path: cfg.path(lightstonePropertyId),
      endpoint: cfg.endpoint,
      billable: true,
      cache_hit: true,
      blocked: false,
      user_id: opts.userId ?? null,
      our_property_id: opts.ourPropertyId ?? null,
      lightstone_property_id: lightstonePropertyId,
    });
    return cachedJson as T;
  }

  // Miss (or forced refresh) — spend a billable call.
  const data = await guardedGet(cfg.path(lightstonePropertyId), {
    endpoint: cfg.endpoint,
    lightstonePropertyId,
    ourPropertyId: opts.ourPropertyId,
    userId: opts.userId,
    billable: true,
  });

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    lightstone_property_id: lightstonePropertyId,
    [cfg.json]: data,
    [cfg.fetchedAt]: nowIso,
  };
  await supabase.from("market_property").upsert(patch, {
    onConflict: "lightstone_property_id",
  });

  return data as T;
}

// Explicit invalidation, e.g. after a new transfer registers on the matched
// property. Nulls the fetched_at so the next getMarketFacet call misses.
export async function invalidateMarketFacet(
  lightstonePropertyId: number,
  facet: MarketFacet,
): Promise<void> {
  const supabase = createServiceClient();
  const cfg = FACET_COLS[facet];
  await supabase
    .from("market_property")
    .update({ [cfg.fetchedAt]: null })
    .eq("lightstone_property_id", lightstonePropertyId);
}
