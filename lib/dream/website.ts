// Reading dreamknysna.co.za (2026-10-17).
//
// The website is Dream's master list of what's on the books (Simon,
// 2026-10-17). Two places on it carry what Dream OS needs:
//
//   * The index cards (/knysna-properties/ + the admin-ajax pages): title,
//     price, area (the knysna-suburbs link), erf / dwelling size, beds,
//     baths, an "offer-banner" class on listings under offer, and the cover
//     photo's alt text — which agents write as the street address
//     ("5 Thella Cres (27)", "3B Bolton (7)"), or leave as "default" / a
//     camera filename ("DSC_2239") when there isn't one.
//   * The listing page's sidebar (.dream_agent_form_data): one card per
//     agent on the listing — photo, name, phones, email. Lead agent first.
//
// The agent photos ("Angie-540x360.jpg", "Bronwyne-540x360.jpg") were being
// read as listing photos, and their names as addresses; stripAgentSidebar()
// removes the sidebar before anything looks for listing images.

export type WebsiteCard = {
  slug: string;
  title: string | null;
  price: number | null;
  area: string | null;
  erfSqm: number | null;
  dwellingSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  underOffer: boolean;
  /** Cover-photo alt text, cleaned; only set when it reads as an address. */
  captionAddress: string | null;
  captionRaw: string | null;
};

export type WebsiteAgent = {
  name: string;
  email: string;
  phone: string | null;
};

const OFFICE_NUMBERS = new Set(["+27443820362", "+27443820387"]);

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8217;|&rsquo;|&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&sup2;/g, "²")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toNumber = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const d = s.replace(/[^0-9]/g, "");
  if (!d) return null;
  const n = Number(d);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Every listing card in an index page or admin-ajax response. */
export function parseIndexCards(html: string): WebsiteCard[] {
  const out: WebsiteCard[] = [];
  const parts = html.split(/<div[^>]+class="item listing-grid-item/i).slice(1);
  for (const part of parts) {
    const cls = part.slice(0, part.indexOf('"'));
    const href = part.match(/href="https?:\/\/(?:www\.)?dreamknysna\.co\.za\/knysna-properties\/([a-z0-9][a-z0-9-]*)\/?"/i);
    if (!href) continue;
    const slug = href[1];
    const title = part.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1];
    const alt = part.match(/<img[^>]+alt="([^"]*)"/i)?.[1] ?? null;
    const prices = [...part.matchAll(/<h4[^>]*class="price"[^>]*>([\s\S]*?)<\/h4>/gi)].map((m) => m[1]);
    const area = part.match(/knysna-suburbs\/[^"]*"[^>]*>(?:\s*<i[^>]*><\/i>)?([^<]+)</i)?.[1];
    const feats = [...part.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => decode(m[1]));
    const feat = (re: RegExp) => {
      for (const f of feats) {
        const m = f.match(re);
        if (m) return toNumber(m[1]);
      }
      return null;
    };
    const captionRaw = alt ? decode(alt).replace(/\s*\(\d+\)\s*$/, "").trim() : null;
    out.push({
      slug,
      title: title ? decode(title) : null,
      price: prices[0] && /R\s?[\d,]/.test(prices[0]) ? toNumber(prices[0]) : null,
      area: area ? decode(area) : null,
      erfSqm: feat(/([\d\s,]+)\s*m[²2]\s*Erf/i),
      dwellingSqm: feat(/([\d\s,]+)\s*m[²2]\s*Dwelling/i),
      bedrooms: feat(/^(\d+)\+?\s*Bedroom/i),
      bathrooms: feat(/^(\d+)\+?\s*Bathroom/i),
      underOffer: /\boffer-banner\b/i.test(cls),
      captionAddress: captionAsAddress(captionRaw),
      captionRaw,
    });
  }
  return out;
}

/** The agent cards in a listing page's sidebar, lead first. */
export function parseAgentCards(html: string): WebsiteAgent[] {
  const out: WebsiteAgent[] = [];
  const parts = html.split(/class="[^"]*dream_agent_form_data[^"]*"/i).slice(1);
  for (const part of parts) {
    const block = part.slice(0, 3000);
    const name = block.match(/class="dream_agent_name"[^>]*>([\s\S]*?)<\/span>/i)?.[1];
    const email = block.match(/mailto:([^"?]+@[^"?]+)/i)?.[1];
    if (!name || !email) continue;
    const phones = [...block.matchAll(/href="tel:([^"]+)"/gi)]
      .map((m) => m[1].replace(/[^\d+]/g, ""))
      .filter((p) => !OFFICE_NUMBERS.has(p));
    const e = email.trim().toLowerCase();
    if (out.some((a) => a.email === e)) continue;
    out.push({ name: decode(name), email: e, phone: phones[0] ?? null });
  }
  return out;
}

/** The listing page without the agent sidebar (agent photos aren't listing photos). */
export function stripAgentSidebar(html: string): string {
  return html.replace(/<div[^>]+class="[^"]*property_listing_sidebar[\s\S]*?(?=<footer|<\/main>|$)/i, "");
}

// Photo words: captions that describe the picture, not the place.
const PHOTO_WORDS =
  /\b(view|views|photo|photos|updated|reshoot|bedroom|kitchen|lounge|living|bathroom|aerial|drone|pool|garden|exterior|interior|default|dsc|img|image|copy|edit|final|web|hdr)\b/i;
// Bare first names the site uses for agent photos — never an address.
const AGENT_FIRST_NAMES = /^(bron|bronwyn|bronwyne|vanessa|angie|avril|jo|gael|charms|charmaine|camilla)$/i;

/** A cover-photo caption is an address when it has a house / stand number
 *  and isn't a description of the photo ("C13 Updated Photos"). */
export function captionAsAddress(caption: string | null | undefined): string | null {
  if (!caption) return null;
  const c = caption
    .replace(/\b(reshoot|annotated|updated photos?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!c || c.length > 70) return null;
  if (AGENT_FIRST_NAMES.test(c)) return null;
  if (PHOTO_WORDS.test(c)) return null;
  // "5 Thella Cres", "3B Bolton", "9-11 Fernwood", "E59 Pezula Private Estate", "A12 PPE 2022"
  if (/^\d+[A-Za-z]?(?:-\d+)?\s+[A-Za-z]/.test(c)) return c;
  if (/^[A-Za-z]{1,2}\d+\s+[A-Za-z]/.test(c)) return c;
  return null;
}

/** Website area name → the suburb name Dream OS uses. */
export const AREA_TO_SUBURB: Record<string, string> = {
  "leisure island": "Leisure Isle",
  "leisure isle": "Leisure Isle",
  "pezula private estate": "Pezula",
  "pezula golf estate": "Pezula",
  pezula: "Pezula",
  "knysna waterfront / knysna quays": "Knysna Quays",
  "knysna quays": "Knysna Quays",
  "brenton-on-sea": "Brenton",
  "brenton on sea": "Brenton",
  "upper old place": "Old Place",
  "old place": "Old Place",
  "fernwood estate": "Fernwood",
};

export function suburbForArea(area: string | null | undefined): string | null {
  if (!area) return null;
  const k = area.trim().toLowerCase();
  return AREA_TO_SUBURB[k] ?? area.trim();
}

/** Website area → the estate Dream OS files estate documents under, if any. */
export function estateForArea(area: string | null | undefined): string | null {
  const k = (area ?? "").trim().toLowerCase();
  if (k === "pezula private estate") return "Pezula Private Estate";
  if (k === "thesen islands") return "Thesen Islands";
  if (k === "simola") return "Simola Golf & Country Estate";
  return null;
}
