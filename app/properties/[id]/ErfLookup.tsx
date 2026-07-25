"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import { attachErfToProperty } from "./actions";

type LookupResponse = {
  ok: boolean;
  erf?: string;
  sg21?: string;
  propDesc?: string;
  source?: string;
  error?: string;
};

// Click-on-satellite ERF lookup. Opens a modal with a satellite map centred
// on the property (or Knysna centre if the property has no coords yet).
// Agent clicks on the actual roof; we call /api/erf-lookup at that point;
// on success we attach the returned ERF to the property, which fires the
// snap trigger and repositions the pin to the cadastre centroid.
//
// Free primary source: Knysna Municipality (same data Bronwyn already
// looks up manually in the valuation roll). Fallback: national CSG mirror.
const KNYSNA_CENTRE: [number, number] = [23.0479, -34.0363];

export default function ErfLookup({
  propertyId,
  propertyLat,
  propertyLng,
  mapboxToken,
}: {
  propertyId: string;
  propertyLat: number | null;
  propertyLng: number | null;
  mapboxToken: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "looking-up" }
    | { kind: "found"; erf: string; sg21?: string; propDesc?: string; source?: string; lng: number; lat: number }
    | { kind: "attaching" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Init map when modal opens.
  useEffect(() => {
    if (!open || !mapEl.current) return;
    if (mapRef.current) return;
    mapboxgl.accessToken = mapboxToken;
    const initial: [number, number] = [
      propertyLng ?? KNYSNA_CENTRE[0],
      propertyLat ?? KNYSNA_CENTRE[1],
    ];
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: initial,
      zoom: propertyLat && propertyLng ? 18 : 15,
    });
    mapRef.current = map;

    map.on("click", async (e) => {
      const { lng, lat } = e.lngLat;
      // Update marker
      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
      } else {
        markerRef.current = new mapboxgl.Marker({ color: "#C8A032" })
          .setLngLat([lng, lat])
          .addTo(map);
      }
      setStatus({ kind: "looking-up" });
      try {
        const res = await fetch(
          `/api/erf-lookup?lng=${lng}&lat=${lat}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as LookupResponse;
        if (json.ok && json.erf) {
          setStatus({
            kind: "found",
            erf: json.erf,
            sg21: json.sg21,
            propDesc: json.propDesc,
            source: json.source,
            lng,
            lat,
          });
        } else {
          setStatus({ kind: "error", message: json.error ?? "No erf found." });
        }
      } catch (err) {
        setStatus({ kind: "error", message: (err as Error).message });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    setStatus({ kind: "idle" });
  }

  async function confirm() {
    if (status.kind !== "found") return;
    setStatus({ kind: "attaching" });
    const res = await attachErfToProperty(propertyId, status.erf);
    if (res.ok) {
      close();
      router.refresh();
    } else {
      setStatus({ kind: "error", message: res.error ?? "Attach failed." });
    }
  }

  return (
    <>
      <button
        type="button"
        className="ghost-dark"
        onClick={() => setOpen(true)}
        style={{ padding: "6px 12px", fontSize: 12 }}
      >
        Find ERF from map
      </button>

      {open && (
        <div
          className="erf-lookup-backdrop"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Look up ERF from map"
        >
          <div
            className="erf-lookup-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="erf-lookup-header">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>Cadastre lookup</p>
                <h2 style={{ margin: "4px 0 0", fontSize: 18 }}>
                  Click the actual house
                </h2>
              </div>
              <button
                type="button"
                className="ghost-dark"
                onClick={close}
                aria-label="Close"
                style={{ padding: "6px 10px" }}
              >
                ×
              </button>
            </div>

            <div ref={mapEl} className="erf-lookup-map" />

            <div className="erf-lookup-footer">
              {status.kind === "idle" && (
                <p style={{ margin: 0, fontSize: 13, color: "var(--slate, #5b6885)" }}>
                  Zoom in and click on the property&rsquo;s roof.
                  We&rsquo;ll query the Knysna Municipality cadastre and confirm the erf.
                </p>
              )}
              {status.kind === "looking-up" && (
                <p style={{ margin: 0, fontSize: 13, color: "var(--estuary)" }}>
                  Looking up erf…
                </p>
              )}
              {status.kind === "found" && (
                <div>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                    ERF {status.erf}
                    {status.propDesc ? ` · ${status.propDesc}` : ""}
                  </p>
                  {status.sg21 && (
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "#5b6885", fontFamily: "monospace" }}>
                      SG21: {status.sg21} · via {status.source ?? "cadastre"}
                    </p>
                  )}
                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="cta"
                      onClick={confirm}
                      style={{ padding: "8px 14px", fontSize: 13 }}
                    >
                      Attach to this property
                    </button>
                    <button
                      type="button"
                      className="ghost-dark"
                      onClick={() => setStatus({ kind: "idle" })}
                      style={{ padding: "8px 14px", fontSize: 13 }}
                    >
                      Click somewhere else
                    </button>
                  </div>
                </div>
              )}
              {status.kind === "attaching" && (
                <p style={{ margin: 0, fontSize: 13 }}>Attaching…</p>
              )}
              {status.kind === "error" && (
                <p style={{ margin: 0, fontSize: 13, color: "#a12020" }}>
                  {status.message}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
