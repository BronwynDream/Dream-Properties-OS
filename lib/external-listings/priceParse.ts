// Rand-price extraction from scraped listing markdown.
//
// Why this exists: Firecrawl's LLM extract, asked for `price: number`,
// is unreliable on Property24 pages. It has silently returned the erf
// number, the rates figure, or a random 3-digit value ("693" on a
// R 9 500 000 listing) — the same brittleness that made us stop asking
// it for coordinates (see the deliberate lat/lng: null in
// scrapeListingDetail).
//
// So price extraction is now done by regex against the page markdown,
// with the LLM as a fallback. SA money formats are well-defined enough
// that a small library of regexes covers 99% of listings.
//
// Rule set (in order of preference):
//   1. Match "R X XXX XXX" (space-thousands) → largest value wins.
//      Rationale: bond-calculator samples, levies, rates are always
//      smaller than the listing price on a real listing.
//   2. Match "R X,XXX,XXX" (comma-thousands) as an alternative.
//   3. Match "R 9.5m" / "R 9.5M" shorthand.
//   4. Sanity floor + ceiling to filter obviously wrong numbers.

const KNYSNA_PRICE_FLOOR = 100_000;      // property below this in Knysna = extraction error
const KNYSNA_PRICE_CEILING = 500_000_000; // above this = extraction error (highest recorded ~R200M)

const SPACE_THOUSANDS = /R\s*(\d{1,3}(?:[\s ]\d{3})+)/g;
const COMMA_THOUSANDS = /R\s*(\d{1,3}(?:,\d{3})+)/g;
const SHORTHAND       = /R\s*(\d+(?:\.\d+)?)\s*([mMkK])\b/g;

// Parse a single "1 234 567" or "1,234,567" numeric string into a number.
// Handles NBSP thousands seps too (Firecrawl converts some to  ).
function parseNumericString(s: string): number | null {
  const clean = s.replace(/[\s ,]/g, "");
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

export type PriceParseResult = {
  price: number | null;
  source: "space" | "comma" | "shorthand" | "llm" | null;
  candidates: number[]; // all plausible candidates found, for debugging
};

/**
 * Extract the most likely listing asking price from markdown.
 * Returns null when nothing plausible is found.
 */
export function parsePriceFromMarkdown(markdown: string): PriceParseResult {
  if (!markdown) return { price: null, source: null, candidates: [] };

  const candidates: { value: number; source: "space" | "comma" | "shorthand" }[] = [];

  for (const m of markdown.matchAll(SPACE_THOUSANDS)) {
    const v = parseNumericString(m[1]);
    if (v != null && v >= KNYSNA_PRICE_FLOOR && v <= KNYSNA_PRICE_CEILING) {
      candidates.push({ value: v, source: "space" });
    }
  }
  for (const m of markdown.matchAll(COMMA_THOUSANDS)) {
    const v = parseNumericString(m[1]);
    if (v != null && v >= KNYSNA_PRICE_FLOOR && v <= KNYSNA_PRICE_CEILING) {
      candidates.push({ value: v, source: "comma" });
    }
  }
  for (const m of markdown.matchAll(SHORTHAND)) {
    const base = Number(m[1]);
    if (!Number.isFinite(base)) continue;
    const mult = m[2].toLowerCase() === "m" ? 1_000_000 : 1_000;
    const v = Math.round(base * mult);
    if (v >= KNYSNA_PRICE_FLOOR && v <= KNYSNA_PRICE_CEILING) {
      candidates.push({ value: v, source: "shorthand" });
    }
  }

  if (candidates.length === 0) {
    return { price: null, source: null, candidates: [] };
  }

  // Rule: pick the maximum. On a real listing the asking price is the
  // largest Rand figure on the page (bond samples / levies / rates are
  // always smaller). Ties break by preference: space > comma > shorthand
  // (space format is P24's canonical rendering).
  const best = candidates.reduce((a, b) => (b.value > a.value ? b : a));
  return {
    price: best.value,
    source: best.source,
    candidates: candidates.map((c) => c.value),
  };
}

/**
 * Resolve a final price given both the markdown-derived value and the
 * LLM's extracted number. Preference: markdown-parse when both agree
 * roughly OR when the LLM returned a suspiciously low number. Falls back
 * to the LLM only if markdown parsing found nothing at all.
 *
 * "Roughly agree" = within 10% or both above the plausibility floor.
 * A big divergence (LLM said 693, markdown said 9_500_000) always
 * trusts the markdown result.
 */
export function reconcilePrice(
  llmValue: number | null,
  markdownValue: number | null,
): { price: number | null; source: "markdown" | "llm" | "agreed" | null; warn: string | null } {
  if (markdownValue == null && (llmValue == null || llmValue < KNYSNA_PRICE_FLOOR)) {
    return { price: null, source: null, warn: null };
  }
  if (markdownValue == null) {
    return { price: llmValue, source: "llm", warn: null };
  }
  if (llmValue == null || llmValue < KNYSNA_PRICE_FLOOR) {
    return {
      price: markdownValue,
      source: "markdown",
      warn: llmValue != null ? `LLM returned suspicious price ${llmValue}; using markdown ${markdownValue}` : null,
    };
  }
  const diffRatio = Math.abs(llmValue - markdownValue) / Math.max(llmValue, markdownValue);
  if (diffRatio <= 0.1) {
    return { price: markdownValue, source: "agreed", warn: null };
  }
  return {
    price: markdownValue,
    source: "markdown",
    warn: `LLM ${llmValue} disagrees with markdown ${markdownValue}; using markdown`,
  };
}
