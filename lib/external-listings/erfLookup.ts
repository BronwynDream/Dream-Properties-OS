// Address → ERF → centroid lookup, backed by Knysna Muni's local mirror
// (muni_property joined to cadastral_parcel). Bronwyn's real Grey St
// pin ended up at Pezula because Mapbox's geocoder is unreliable in
// small SA towns. The Muni's finance system knows which erf sits at
// "8 Grey Street" — using that as the primary source gives us pins that
// are cadastrally correct by construction.
//
// Falls through gracefully — if the address doesn't parse, or nothing
// matches, or the matching erf has no cadastral centroid, we return
// null and the caller falls back to Mapbox geocoding.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createServiceClient } from "@/lib/supabase/service";

// Street-suffix vocabulary. Stripped from the name before matching so
// "Grey Str" and "Grey Street" and "Grey" all normalise to "GREY".
// Kept as one flat set — SA muni data varies wildly in how it stores
// this (some rows have "STREET", some "STR", some just nothing).
const STREET_SUFFIXES = new Set([
  "STREET", "STR", "ST",
  "ROAD", "RD",
  "AVENUE", "AVE", "AV",
  "LANE", "LN",
  "CRESCENT", "CRES", "CR",
  "DRIVE", "DR", "DRV",
  "CLOSE", "CL",
  "WAY",
  "BOULEVARD", "BLVD",
  "PLACE", "PL",
  "TERRACE", "TER",
  "COURT", "CT",
  "SQUARE", "SQ",
  "PARK",
  "MEWS",
  "WALK",
  "BEND",
]);

export type ParsedAddress = {
  streetNo: string | null;
  streetName: string;      // normalised: uppercase, suffix stripped, single-spaced
  streetNameRaw: string;   // original wording, kept for debugging
  suburbHint: string | null;
};

// Very defensive parse. SA address text on P24 is typically shaped like
//   "8 Grey Str, Knysna Central"
//   "12 Welbedacht Lane, Welbedacht, Knysna"
//   "3 Windstar Lane, Pezula Golf Estate, Knysna"
// but plenty of edge cases (no number, complex-name properties, all
// caps, etc.) — return null when we can't get a plausible street name.
export function parseAddress(addressRaw: string | null | undefined): ParsedAddress | null {
  if (!addressRaw) return null;
  const clean = addressRaw.trim();
  if (clean.length < 3) return null;

  // Split on commas — first segment is street, subsequent are suburb hints.
  const segments = clean.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  const streetSegment = segments[0];
  const suburbHint = segments.length > 1 ? segments[1] : null;

  // Extract leading number(s). Accept "8", "12A", "3-5" etc.
  const numMatch = streetSegment.match(/^(\d+[A-Za-z\-\/]?\d*)\s+(.+)$/);
  let streetNo: string | null = null;
  let streetBody: string;
  if (numMatch) {
    streetNo = numMatch[1];
    streetBody = numMatch[2];
  } else {
    streetBody = streetSegment;
  }

  // Normalise the street body:
  //   1. uppercase (muni data is typically all caps)
  //   2. strip trailing suffix (STREET / STR / ST / …)
  //   3. collapse whitespace
  //   4. drop punctuation
  const words = streetBody
    .toUpperCase()
    .replace(/[.,'`"]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  // If the LAST word is a known suffix, drop it. Two-word suffixes ("BAY
  // VIEW") don't exist in our vocab so single-word check is enough.
  const nameWords =
    words.length > 1 && STREET_SUFFIXES.has(words[words.length - 1])
      ? words.slice(0, -1)
      : words;

  if (nameWords.length === 0) return null;

  return {
    streetNo,
    streetName: nameWords.join(" "),
    streetNameRaw: streetBody,
    suburbHint: suburbHint ? suburbHint.toUpperCase().trim() : null,
  };
}

export type ErfLookupHit = {
  sgNumber: string;
  erfNumber: string | null;
  lng: number;
  lat: number;
  matchedAddress: string; // muni's canonical address for this erf
  suburb: string | null;
  source: "muni_address";
};

// Given a raw address string ("8 Grey Str, Knysna Central"), find the
// matching erf in the local Muni mirror and return its cadastral
// centroid. Returns null when no confident match exists — the caller
// should fall back to Mapbox geocoding.
//
// Matching rules:
//   1. Parse address into { streetNo, streetName, suburbHint }.
//   2. Query muni_property WHERE street_name matches (normalised) AND
//      (if streetNo is present) street_no matches too.
//   3. If multiple candidates and we have a suburb hint, prefer
//      exact-suburb matches. If still ambiguous, return null (rather
//      than pick a wrong one — Mapbox is a safer fallback).
//   4. Look up the sg_number in cadastral_parcel; use centroid.
export async function findErfCentroidByAddress(
  addressRaw: string | null | undefined,
): Promise<ErfLookupHit | null> {
  const parsed = parseAddress(addressRaw);
  if (!parsed) return null;

  const supabase = createServiceClient();

  // Query muni_property. We use ILIKE on street_name for case + trim
  // tolerance. Street_no is exact-match when we have it — a house at
  // "12" is a different building from "10".
  let q = supabase
    .from("muni_property")
    .select("sg_number, erf_number, street_no, street_name, suburb, suburb_hint")
    .ilike("street_name", parsed.streetName);
  if (parsed.streetNo) {
    q = q.eq("street_no", parsed.streetNo);
  }
  const { data: candidates, error } = await q.limit(20);
  if (error || !candidates || candidates.length === 0) return null;

  // Suburb-narrow when we have a hint. Prefer exact suburb, else
  // suburb_hint (finance-system packed suffix), else all.
  let chosen: any = null;
  if (parsed.suburbHint) {
    const suburbMatch = candidates.find(
      (c: any) => (c.suburb ?? "").toUpperCase().trim() === parsed.suburbHint,
    );
    if (suburbMatch) chosen = suburbMatch;
    if (!chosen) {
      const hintMatch = candidates.find(
        (c: any) => (c.suburb_hint ?? "").toUpperCase().trim() === parsed.suburbHint,
      );
      if (hintMatch) chosen = hintMatch;
    }
  }
  if (!chosen && candidates.length === 1) chosen = candidates[0];
  if (!chosen) {
    // Ambiguous — multiple streets called "Grey" across Knysna's
    // suburbs and we can't tell which. Bail out; Mapbox falls back.
    return null;
  }

  // Cadastral centroid via sg_number → tag_value join. The Muni's
  // sg_number is like "C03900050000449700000"; cadastral_parcel's
  // tag_value is like "erf 4497" (from CSG). Match via erf_number.
  //
  // Extract lng/lat via a raw SQL RPC because Supabase JS doesn't
  // uniformly deserialise PostGIS geography values across versions —
  // sometimes it's GeoJSON, sometimes WKB hex. ST_X/ST_Y is safest.
  if (!chosen.erf_number) return null;
  const { data: coordRow, error: coordErr } = await supabase.rpc("erf_centroid_lookup", {
    p_erf_number: chosen.erf_number,
  });
  if (coordErr || !coordRow) return null;
  // RPC returns table (prcl_key text, lng double, lat double). PostgREST
  // wraps table-return in an array.
  const row = Array.isArray(coordRow) ? coordRow[0] : coordRow;
  if (!row) return null;
  const lng = Number((row as any).lng);
  const lat = Number((row as any).lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  return {
    sgNumber: chosen.sg_number,
    erfNumber: chosen.erf_number,
    lng,
    lat,
    matchedAddress: [chosen.street_no, chosen.street_name].filter(Boolean).join(" "),
    suburb: chosen.suburb ?? null,
    source: "muni_address",
  };
}
