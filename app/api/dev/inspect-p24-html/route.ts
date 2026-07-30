import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/dev/inspect-p24-html?url=<full-p24-listing-url>
//
// V2 diagnostic — the v1 narrow-regex scan came back empty against a real
// P24 listing (109KB of HTML, zero coord-shaped numbers). Either coords
// are loaded via XHR after render, or they're in the source but shaped
// differently than we guessed. This version dumps ALL structured data
// blocks + any script content mentioning maps so we can eyeball the
// source and find them.
//
// Delete after we know P24's pattern.

async function authorised(request: Request): Promise<boolean> {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (secret && bearer === secret) return true;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from("app_user")
    .select("role, active")
    .eq("id", user.id)
    .single();
  return profile?.role === "admin" && profile?.active !== false;
}

// Extract contents of every <script>...</script> tag. Returns each script
// body as a string. Skips empty ones and src-only tags (no inline body).
function extractScripts(html: string): { attrs: string; body: string }[] {
  const out: { attrs: string; body: string }[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    const body = (m[2] ?? "").trim();
    if (body.length > 0) out.push({ attrs, body });
  }
  return out;
}

export async function GET(request: Request) {
  if (!(await authorised(request))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "missing ?url= param" }, { status: 400 });
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FIRECRAWL_API_KEY not set" }, { status: 500 });
  }

  const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["html"] }),
  });
  if (!r.ok) {
    const body = await r.text();
    return NextResponse.json(
      { error: "firecrawl fetch failed", status: r.status, body: body.slice(0, 500) },
      { status: 502 },
    );
  }
  const payload = await r.json();
  const html: string =
    (typeof payload?.html === "string" && payload.html) ||
    (typeof payload?.data?.html === "string" && payload.data.html) ||
    "";
  if (!html) {
    return NextResponse.json({
      error: "no html in firecrawl response",
      payloadKeys: Object.keys(payload ?? {}),
    });
  }

  // Extract the listing id from the URL so we can search for it appearing
  // inside JSON blobs / script src attrs. If P24 has a per-listing data
  // endpoint, the id will be somewhere in the source.
  const listingIdMatch = url.match(/(\d{6,})(?:[?#]|$)/);
  const listingId = listingIdMatch ? listingIdMatch[1] : null;

  // 1. Grab all JSON-LD structured data (<script type="application/ld+json">).
  //    Real-estate schemas usually include Place.geo with lat/lng.
  const jsonLd: string[] = [];
  const jsonLdRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = jsonLdRe.exec(html)) !== null) {
    jsonLd.push((m[1] ?? "").trim());
  }

  // 2. Grab all <script> src URLs — sometimes coords come from a specific
  //    endpoint (e.g. /Listing/GetMapData?id=...).
  const scriptSrcs: string[] = [];
  const srcRe = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi;
  while ((m = srcRe.exec(html)) !== null) {
    scriptSrcs.push(m[1]);
  }

  // 3. Extract inline script bodies that mention map/coord/google/mapbox
  //    or the listing id. Truncate each to 800 chars around the keyword
  //    so the response stays console-friendly.
  const keywords = /(map|latitude|longitude|coord|google|mapbox|openstreetmap|geometry|marker)/i;
  const scripts = extractScripts(html);
  const relevantScripts: { attrs: string; snippet: string }[] = [];
  for (const s of scripts) {
    // Skip JSON-LD (already captured) and very short scripts.
    if (s.attrs.includes("application/ld+json")) continue;
    if (s.body.length < 40) continue;

    let matchIndex = -1;
    const km = s.body.match(keywords);
    if (km && km.index != null) matchIndex = km.index;
    // Also check for listing id in body.
    if (matchIndex < 0 && listingId && s.body.includes(listingId)) {
      matchIndex = s.body.indexOf(listingId);
    }
    if (matchIndex < 0) continue;

    const start = Math.max(0, matchIndex - 300);
    const end = Math.min(s.body.length, matchIndex + 500);
    relevantScripts.push({
      attrs: s.attrs.slice(0, 200),
      snippet: s.body.slice(start, end),
    });
    if (relevantScripts.length >= 8) break;
  }

  // 4. Look for URLs that point at map / geo APIs.
  const apiUrlRe = /\bhttps?:\/\/[^"'\s<>]*(?:maps\.googleapis|maps\.google|mapbox\.com|openstreetmap|api\.geocod|\/api\/[^"'\s<>]*map|\/Listing\/[^"'\s<>]*|\/Map\/[^"'\s<>]*)/gi;
  const apiUrls = new Set<string>();
  while ((m = apiUrlRe.exec(html)) !== null) apiUrls.add(m[0]);

  // 5. Broader coord scan — any float that could plausibly be a latitude
  //    or longitude anywhere on earth, so we don't miss unusually-precise
  //    encodings. Cap output.
  const anyLat = new Set<string>();
  const latRe = /-?(?:1[0-7]\d|[1-9]?\d)\.\d{4,}/g;
  while ((m = latRe.exec(html)) !== null) {
    anyLat.add(m[0]);
    if (anyLat.size >= 40) break;
  }

  return NextResponse.json({
    ok: true,
    url,
    htmlLength: html.length,
    listingId,
    jsonLd,
    scriptSrcs,
    relevantScripts,
    apiUrls: Array.from(apiUrls).slice(0, 30),
    anyPreciseFloats: Array.from(anyLat),
  });
}
