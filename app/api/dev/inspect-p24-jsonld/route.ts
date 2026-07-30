import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseJsonLdCoords } from "@/lib/external-listings/property24";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/dev/inspect-p24-jsonld?url=<full-p24-listing-url>
//
// Diagnostic for the P24 JSON-LD coord extractor. Given a listing URL:
//   1. Firecrawls the raw HTML.
//   2. Pulls every <script type="application/ld+json"> block, parses it,
//      and returns a compact summary (with @type keys + presence of
//      latitude/longitude/address).
//   3. Calls parseJsonLdCoords on the raw HTML and reports the result.
//
// Purpose: figure out why some P24 listings return no_jsonld_coord.
// Either their JSON-LD is genuinely coord-less, or our extractor is
// walking the wrong shape. This endpoint tells us which.

/* eslint-disable @typescript-eslint/no-explicit-any */

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

// Walk the parsed object, collect { path, keys } for every object node.
// Truncate at 100 nodes so we don't spam the response.
function summariseShape(node: any, path = "$", out: { path: string; keys: string[] }[] = []) {
  if (out.length >= 100) return out;
  if (node == null) return out;
  if (Array.isArray(node)) {
    node.slice(0, 10).forEach((el, i) => summariseShape(el, `${path}[${i}]`, out));
    return out;
  }
  if (typeof node === "object") {
    const keys = Object.keys(node);
    out.push({ path, keys });
    for (const k of keys) summariseShape(node[k], `${path}.${k}`, out);
  }
  return out;
}

// Find every geo-shaped value anywhere in the tree.
function findAllGeoCandidates(node: any, path = "$", out: any[] = []): any[] {
  if (out.length >= 20) return out;
  if (node == null) return out;
  if (Array.isArray(node)) {
    node.forEach((el, i) => findAllGeoCandidates(el, `${path}[${i}]`, out));
    return out;
  }
  if (typeof node !== "object") return out;
  const keys = Object.keys(node);
  const geoKeys = keys.filter((k) => /lat|lng|lon|geo|coord|position|place/i.test(k));
  if (geoKeys.length > 0) {
    const summary: any = { path, type: node["@type"], keys };
    for (const gk of geoKeys) summary[gk] = node[gk];
    out.push(summary);
  }
  for (const k of keys) findAllGeoCandidates(node[k], `${path}.${k}`, out);
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
    body: JSON.stringify({ url, formats: ["rawHtml"] }),
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
    (typeof payload?.rawHtml === "string" && payload.rawHtml) ||
    (typeof payload?.data?.rawHtml === "string" && payload.data.rawHtml) ||
    "";

  if (!html) {
    return NextResponse.json({ error: "no rawHtml in firecrawl response" });
  }

  // Extract every JSON-LD block and try parsing each.
  const jsonLdBlocks: {
    blockIndex: number;
    parsed: boolean;
    parseError?: string;
    topLevelType?: any;
    graphTypes?: any[];
    shapeSummary?: { path: string; keys: string[] }[];
    geoCandidates?: any[];
    firstChars: string;
  }[] = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(html)) !== null) {
    const body = (m[1] ?? "").trim();
    const firstChars = body.slice(0, 200);
    try {
      const parsed = JSON.parse(body);
      const graphTypes = Array.isArray(parsed?.["@graph"])
        ? parsed["@graph"].map((g: any) => g?.["@type"] ?? null)
        : undefined;
      jsonLdBlocks.push({
        blockIndex: idx,
        parsed: true,
        topLevelType: parsed?.["@type"] ?? null,
        graphTypes,
        shapeSummary: summariseShape(parsed).slice(0, 30),
        geoCandidates: findAllGeoCandidates(parsed),
        firstChars,
      });
    } catch (e) {
      jsonLdBlocks.push({
        blockIndex: idx,
        parsed: false,
        parseError: (e as Error).message,
        firstChars,
      });
    }
    idx++;
  }

  // What does our extractor actually return?
  const extractorResult = parseJsonLdCoords(html);

  return NextResponse.json({
    ok: true,
    url,
    htmlLength: html.length,
    jsonLdBlockCount: jsonLdBlocks.length,
    jsonLdBlocks,
    extractorResult,
  });
}
