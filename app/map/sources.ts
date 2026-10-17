import type { SourceKey } from "./MapView";

// Label + short code for each listing source. `code` is the compact badge
// (P24, PP…); `label` is what the menus and panels say.
export const SOURCE_META: Record<SourceKey, { label: string; code: string }> = {
  dream_os: { label: "Our listings", code: "OS" },
  dream_website: { label: "Dream website", code: "DW" },
  property24: { label: "Property24", code: "P24" },
  private_property: { label: "Private Property", code: "PP" },
};

export const MARKET_SOURCES: SourceKey[] = ["property24", "private_property", "dream_website"];
