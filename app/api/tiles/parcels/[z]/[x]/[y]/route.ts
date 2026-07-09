import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
// Tiles are cheap once the geom + centroid indexes are built, but keep the
// route on the Hobby ceiling for safety on the first few requests after a
// cold start.
export const maxDuration = 60;

// GET /api/tiles/parcels/[z]/[x]/[y]
//
// Vector-tile endpoint for the "Erf boundaries" layer. Calls the
// parcel_mvt(z,x,y) function and streams the bytes back as MVT with a
// day-long browser + CDN cache header. Below z=14 we return HTTP 204 —
// rendering the cadastre at country scale would be pointless and slow.
//
// Layer name in the MVT is `parcels`; that's what MapView's source-layer
// setting must match. Feature attributes exposed by parcel_mvt: prcl_key,
// tag_value, maj_region, min_region.

export async function GET(
  _request: Request,
  { params }: { params: { z: string; x: string; y: string } },
) {
  const z = Number(params.z);
  const x = Number(params.x);
  const y = Number(params.y);

  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "bad tile coords" }, { status: 400 });
  }
  if (z < 14) {
    return new NextResponse(null, { status: 204 });
  }
  if (z > 22) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("parcel_mvt", { z, x, y });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(`[parcel_mvt] ${z}/${x}/${y}: ${error.message}`);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Empty tile (no parcels in envelope) → 204 so Mapbox doesn't render
    // an empty layer and doesn't retry.
    if (data == null) {
      return new NextResponse(null, {
        status: 204,
        headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
      });
    }

    // PostgREST returns bytea as either a base64 string or a hex \\x prefix.
    // Convert either shape to a Buffer.
    let bytes: Buffer;
    if (typeof data === "string") {
      if (data.startsWith("\\x")) {
        bytes = Buffer.from(data.slice(2), "hex");
      } else {
        bytes = Buffer.from(data, "base64");
      }
    } else if (data instanceof Uint8Array) {
      bytes = Buffer.from(data);
    } else if (data && typeof (data as any).data === "string") {
      bytes = Buffer.from((data as any).data, "base64");
    } else {
      return NextResponse.json(
        { error: "unexpected parcel_mvt payload shape" },
        { status: 500 },
      );
    }

    if (bytes.length === 0) {
      return new NextResponse(null, {
        status: 204,
        headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
      });
    }

    // NextResponse's body accepts Uint8Array but not Buffer directly in the
    // types Vercel ships; the runtime object is the same either way.
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[parcel_mvt] ${z}/${x}/${y}: ${(e as Error).message}`);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
