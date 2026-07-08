import type { LightstoneAdapter } from "./adapter";
import { StubLightstoneAdapter } from "./stub";
import { LiveLightstoneAdapter } from "./live";

// Picks the live adapter when both env vars are set, otherwise falls back to
// the stub. The stub is safe by default: nothing external is called and every
// document is title-prefixed [SAMPLE].
export function getLightstoneAdapter(): LightstoneAdapter {
  const base = process.env.LIGHTSTONE_API_BASE;
  const key = process.env.LIGHTSTONE_API_KEY;
  if (base && key) return new LiveLightstoneAdapter();
  return new StubLightstoneAdapter();
}

export * from "./adapter";
export { PRODUCTS } from "./products";
