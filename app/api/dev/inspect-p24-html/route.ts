import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/dev/inspect-p24-html?url=<full-p24-listing-url>
//
// One-shot diagnostic — Firecrawls a P24 listing in HTML mode and greps
// for coord-shaped patterns. Purpose: reverse-engineer WHERE in the P24
// HTML they embed lat/lng so we can write a real regex-based coord
// extractor (replacing the current fragile "geocode the address" chain).
//
// Delete this route once we know the pattern. Not for production use.

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

  // Fetch RAW HTML via Firecrawl. Standard scrape mode returns markdown by
  // default, which is exactly what stripped the coord data we're hunting.
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
  // Firecrawl v1 shape varies by plan — try both common locations.
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

  // Try several patterns commonly used by real-estate sites to expose
  // coords in the HTML. Return any that match, up to 10 hits each.
  const patterns: { name: string; re: RegExp }[] = [
    { name: "data-lat attr", re: /data-lat(?:itude)?=["']([^"']+)["']/gi },
    { name: "data-lng attr", re: /data-l(?:ng|ongitude)=["']([^"']+)["']/gi },
    { name: "og:latitude meta", re: /property=["']og:latitude["'][^>]*content=["']([^"']+)["']/gi },
    { name: "og:longitude meta", re: /property=["']og:longitude["'][^>]*content=["']([^"']+)["']/gi },
    { name: "geo.position meta", re: /name=["']geo\.position["'][^>]*content=["']([^"']+)["']/gi },
    { name: "JSON-LD geo latitude", re: /"latitude"\s*:\s*"?(-?\d+\.\d+)"?/gi },
    { name: "JSON-LD geo longitude", re: /"longitude"\s*:\s*"?(-?\d+\.\d+)"?/gi },
    { name: "js var lat", re: /\blat(?:itude)?\s*[:=]\s*(-?\d+\.\d{3,})/gi },
    { name: "js var lng", re: /\bl(?:ng|ongitude|on)\s*[:=]\s*(-?\d+\.\d{3,})/gi },
    { name: "google-maps url", re: /maps\.google\.com[^"'\s]*[?&]q=(-?\d+\.\d+,-?\d+\.\d+)/gi },
    { name: "coord-in-Knysna-range", re: /-3[3-4]\.\d{4,}/g },
  ];

  const matches: Record<string, string[]> = {};
  for (const p of patterns) {
    const found: string[] = [];
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(html)) !== null) {
      found.push(m[0]);
      if (found.length >= 10) break;
    }
    if (found.length > 0) matches[p.name] = found;
  }

  // If we found a Knysna-range coord, return 400 chars of surrounding
  // context so we can eyeball how it's structured in the source.
  let firstCoordContext: string | null = null;
  const anyCoord = /-3[3-4]\.\d{4,}/.exec(html);
  if (anyCoord && anyCoord.index != null) {
    const start = Math.max(0, anyCoord.index - 200);
    const end = Math.min(html.length, anyCoord.index + 400);
    firstCoordContext = html.slice(start, end);
  }

  return NextResponse.json({
    ok: true,
    url,
    htmlLength: html.length,
    matches,
    firstCoordContext,
  });
}
