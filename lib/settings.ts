import { createServiceClient } from "@/lib/supabase/service";

// Typed read layer over the app_setting table. Every setting has a default
// baked in here so the app stays functional if the row is missing, RLS
// misconfigures, or the DB briefly can't be reached — nothing worse than a
// blank Watchlist because someone forgot to seed a row.
//
// Add new keys by:
//   1. adding an entry to DEFAULTS below (with the runtime type)
//   2. calling getSetting("your.key") from the server component that needs it
//   3. inserting a row via migration OR the /settings UI (either works)
//
// The service-role client is used deliberately: settings need to be readable
// from staff and admin sessions alike, but we don't want individual queries
// to be re-authenticated per request. Reads are cheap (single row by pk).

// Central registry of settings. Runtime type is inferred from the default
// value's TS type; keeps the getter typed without a separate schema layer.
export const SETTINGS_DEFAULTS = {
  "mandate.expiry_window_days": [30, 60] as number[],
  // FFC watchlist thresholds. Days-ahead-of-expiry buckets. Default
  // [30, 60, 90] because PPRA renewal window opens ~90 days out and
  // 30 days is "chase renewal now" for the director.
  "ffc.expiry_window_days": [30, 60, 90] as number[],
  // FICA verification is per-transaction, but agencies commonly re-use a
  // recent verification within a validity window rather than re-KYCing on
  // every new deal. 730 days ≈ 2 years is the standard for low/medium
  // risk parties. A verified FICA older than this counts as "stale" and
  // needs refreshing before the next deal proceeds.
  "fica.verification_valid_days": 730 as number,
} as const;

type SettingKey = keyof typeof SETTINGS_DEFAULTS;
type SettingValue<K extends SettingKey> = typeof SETTINGS_DEFAULTS[K];

export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<SettingValue<K>> {
  const fallback = SETTINGS_DEFAULTS[key];
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("app_setting")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return fallback;
    // jsonb comes back already-parsed via PostgREST — no JSON.parse needed.
    return data.value as SettingValue<K>;
  } catch {
    return fallback;
  }
}

// Bulk read for pages that need several settings on one render. One
// round-trip per call; keys must all be known SETTINGS_DEFAULTS entries so
// the returned object is fully typed.
export async function getSettings<K extends SettingKey>(
  keys: readonly K[],
): Promise<{ [P in K]: SettingValue<P> }> {
  const result = {} as { [P in K]: SettingValue<P> };
  for (const k of keys) result[k] = SETTINGS_DEFAULTS[k] as SettingValue<typeof k>;
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("app_setting")
      .select("key, value")
      .in("key", keys as unknown as string[]);
    for (const row of data ?? []) {
      const k = row.key as K;
      if (k in SETTINGS_DEFAULTS) result[k] = row.value as SettingValue<typeof k>;
    }
  } catch {
    // Fall through to defaults populated above.
  }
  return result;
}

// Admin-only write path. Called from the /settings save action. Uses the
// service client (RLS is not the enforcement point — the calling page is,
// via getUser + role check).
export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("app_setting")
    .upsert(
      {
        key,
        value: value as unknown as Record<string, unknown> | number | string | boolean | unknown[],
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
