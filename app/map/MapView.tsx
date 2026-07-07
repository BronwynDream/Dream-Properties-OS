"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import mapboxgl from "mapbox-gl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { geocodeMissingProperties } from "./actions";

export type MapProperty = {
  id: string;
  address: string;
  suburb: string | null;
  lng: number | null;
  lat: number | null;
  extentSqm: number | null;
  titleDeed: string | null;
  askingPrice: number | null;
  listingStatus: string | null;
  listingHeadline: string | null;
  mandateType: string; // exclusive | sole | joint | open | none
  mandateRaw: string | null;
  transferStatus: string | null;
  transferDate: string | null;
  transferCount: number;
};

type Stats = { total: number; geocoded: number; missing: number };

const KNYSNA_CENTRE: [number, number] = [23.0479, -34.0363];

const MANDATE_ORDER = ["exclusive", "sole", "joint", "under_offer", "open", "none"] as const;

// Basemap options. Satellite Streets first because for property work it's the
// killer — you see the actual roof, pool, land, plus street labels for orientation.
const BASEMAPS = [
  {
    id: "satellite",
    label: "Satellite",
    style: "mapbox://styles/mapbox/satellite-streets-v12",
  },
  {
    id: "streets",
    label: "Streets",
    style: "mapbox://styles/mapbox/streets-v12",
  },
  {
    id: "light",
    label: "Light",
    style: "mapbox://styles/mapbox/light-v11",
  },
] as const;

type BasemapId = (typeof BASEMAPS)[number]["id"];

function formatPrice(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `R ${(n / 1_000).toFixed(0)}k`;
  return `R ${n}`;
}

function formatFullPrice(n: number | null): string {
  if (n == null) return "Price on request";
  return `R ${n.toLocaleString("en-ZA")}`;
}


export default function MapView({
  properties,
  isAdmin,
  mapboxToken,
  stats,
}: {
  properties: MapProperty[];
  isAdmin: boolean;
  mapboxToken: string;
  stats: Stats;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enabledMandates, setEnabledMandates] = useState<Set<string>>(
    () => new Set(MANDATE_ORDER),
  );
  const [basemap, setBasemap] = useState<BasemapId>("satellite");
  const [pending, startTransition] = useTransition();
  const [geocodeMsg, setGeocodeMsg] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  // Trim defensively — pasted env vars sometimes carry trailing \n or spaces,
  // and Mapbox rejects those silently.
  const cleanToken = (mapboxToken ?? "").trim();

  // Group + count by mandate for the filter chips.
  const mandateCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of properties) {
      m.set(p.mandateType, (m.get(p.mandateType) ?? 0) + 1);
    }
    return m;
  }, [properties]);

  const visibleProperties = useMemo(
    () => properties.filter((p) => enabledMandates.has(p.mandateType)),
    [properties, enabledMandates],
  );

  const plottable = useMemo(
    () => visibleProperties.filter((p) => p.lng != null && p.lat != null),
    [visibleProperties],
  );

  const selectedProperty = properties.find((p) => p.id === selectedId) ?? null;

  // Set up the map on mount. If no token is configured, render an empty state
  // instead of initialising Mapbox with a broken client.
  useEffect(() => {
    if (!containerRef.current) return;
    if (!cleanToken) return;
    // WebGL check — Safari can disable it.
    if (!mapboxgl.supported()) {
      setMapError("This browser doesn't support WebGL (Mapbox requires it).");
      return;
    }
    mapboxgl.accessToken = cleanToken;

    const initialStyle =
      BASEMAPS.find((b) => b.id === basemap)?.style ?? BASEMAPS[0].style;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: initialStyle,
        center: KNYSNA_CENTRE,
        zoom: 11,
        attributionControl: false,
        cooperativeGestures: false,
      });
    } catch (e) {
      setMapError(`Mapbox init failed: ${(e as Error).message}`);
      return;
    }

    map.on("error", (evt) => {
      const msg = (evt.error as Error | undefined)?.message ?? "unknown mapbox error";
      // eslint-disable-next-line no-console
      console.error("[mapbox]", msg, evt);
      setMapError(msg);
    });

    // Container-size safety: if the map's container is 0 tall at mount (common
    // when the parent layout hasn't settled yet), Mapbox creates a 0-sized
    // canvas and tiles never appear even though they download fine.
    map.resize();
    requestAnimationFrame(() => map.resize());
    const resizeTimer = setTimeout(() => map.resize(), 200);

    // Also watch for future resizes (window resize, layout shift).
    const ro = new ResizeObserver(() => map.resize());
    if (containerRef.current) ro.observe(containerRef.current);

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
    map.addControl(
      new mapboxgl.AttributionControl({ compact: true, customAttribution: "Dream Knysna" }),
      "bottom-right",
    );

    mapRef.current = map;
    return () => {
      clearTimeout(resizeTimer);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, [cleanToken]);

  // Basemap swap — setStyle keeps HTML markers, popups, and controls in place
  // (they're not part of the style), so no marker re-add needed. Guarded so we
  // don't setStyle on the initial mount before mapRef is populated.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const target = BASEMAPS.find((b) => b.id === basemap)?.style;
    if (!target) return;
    map.setStyle(target);
  }, [basemap]);

  // Sync markers to the plottable set. Rebuild on filter change or data change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove markers not in the current visible set.
    const wantIds = new Set(plottable.map((p) => p.id));
    for (const [id, marker] of Object.entries(markersRef.current)) {
      if (!wantIds.has(id)) {
        marker.remove();
        delete markersRef.current[id];
      }
    }

    // Add/update markers for visible properties.
    for (const p of plottable) {
      if (markersRef.current[p.id]) continue;

      const el = document.createElement("div");
      el.className = `price-pin mandate-${p.mandateType}${p.askingPrice == null ? " por" : ""}`;

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = p.askingPrice == null ? "POR" : formatPrice(p.askingPrice);
      el.appendChild(badge);

      const pointer = document.createElement("span");
      pointer.className = "pointer";
      el.appendChild(pointer);

      el.addEventListener("click", () => setSelectedId(p.id));

      const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([p.lng!, p.lat!])
        .addTo(map);

      markersRef.current[p.id] = marker;
    }

    // Fit view once — only if we have markers and this is the first render.
    if (plottable.length > 0 && Object.keys(markersRef.current).length === plottable.length) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const p of plottable) bounds.extend([p.lng!, p.lat!]);
      map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 0 });
    }
  }, [plottable]);

  // Active pin styling.
  useEffect(() => {
    for (const [id, marker] of Object.entries(markersRef.current)) {
      const el = marker.getElement();
      if (id === selectedId) el.classList.add("active");
      else el.classList.remove("active");
    }
    if (selectedId && mapRef.current) {
      const p = properties.find((x) => x.id === selectedId);
      if (p && p.lng != null && p.lat != null) {
        mapRef.current.easeTo({ center: [p.lng, p.lat], duration: 350 });
      }
    }
  }, [selectedId, properties]);

  function toggleMandate(m: string) {
    setEnabledMandates((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  function runGeocode() {
    setGeocodeMsg(null);
    startTransition(async () => {
      try {
        const res = await geocodeMissingProperties();
        if (!res.ok) setGeocodeMsg(res.error ?? "geocode failed");
        else setGeocodeMsg(`Geocoded ${res.geocoded ?? 0} · ${res.failed ?? 0} failed. Reload to see pins.`);
      } catch (e) {
        setGeocodeMsg(`Geocode threw: ${(e as Error).message}`);
      }
    });
  }

  return (
    <div className="map-shell">
      <aside className="map-rail">
        <section>
          <h3>Basemap</h3>
          <div className="basemap-tabs">
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                type="button"
                className={basemap === b.id ? "on" : ""}
                onClick={() => setBasemap(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Mandate</h3>
          <div className="mandate-chips">
            {MANDATE_ORDER.filter((m) => (mandateCounts.get(m) ?? 0) > 0).map((m) => {
              const on = enabledMandates.has(m);
              return (
                <button
                  key={m}
                  className={`mandate-chip mandate-${m} ${on ? "on" : ""}`}
                  onClick={() => toggleMandate(m)}
                  type="button"
                  title={m}
                >
                  <span className="sw" />
                  <span style={{ textTransform: "capitalize" }}>{m.replace("_", " ")}</span>
                  <span style={{ color: "#8090b5", marginLeft: 2 }}>{mandateCounts.get(m)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section style={{ padding: "10px 0 0", borderBottom: "none" }}>
          <h3 style={{ padding: "0 16px" }}>Listings ({visibleProperties.length})</h3>
        </section>

        <div className="listing-scroll">
          {visibleProperties.length === 0 && (
            <p style={{ padding: 16, fontSize: 13, color: "#8090b5" }}>
              Nothing matches the current filter.
            </p>
          )}
          {visibleProperties.map((p) => (
            <button
              key={p.id}
              className={`listing-item mandate-${p.mandateType} ${selectedId === p.id ? "active" : ""}`}
              onClick={() => setSelectedId(p.id)}
              style={{ background: selectedId === p.id ? "#EEF0F8" : undefined, border: 0, textAlign: "left", width: "100%" }}
            >
              <span className="bar" />
              <span>
                <span className="nm">{p.address}</span>
                <span className="pr">{formatFullPrice(p.askingPrice)}</span>
                <span className="meta">
                  {p.suburb ?? "—"}
                  {p.mandateRaw ? ` · ${p.mandateRaw}` : ""}
                  {p.lng == null ? " · no coords" : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="map-stage">
        <div ref={containerRef} className="map-canvas" />

        {isAdmin && stats.missing > 0 && (
          <div className="geocode-bar">
            <span>
              <b>{stats.geocoded}</b> / {stats.total} pinned · {stats.missing} missing coords
            </span>
            <button type="button" onClick={runGeocode} disabled={pending}>
              {pending ? "Geocoding…" : "Geocode all"}
            </button>
          </div>
        )}
        {geocodeMsg && (
          <div
            style={{
              position: "absolute", top: 60, right: 14, zIndex: 30,
              background: "var(--white)", color: "var(--ink)",
              border: "2px solid var(--gold)", borderRadius: 12,
              padding: "14px 18px", fontSize: 14, fontWeight: 600,
              maxWidth: 420,
              boxShadow: "0 10px 30px rgba(15,22,52,0.25)",
            }}
          >
            {geocodeMsg}
          </div>
        )}

        {plottable.length > 0 && (
          <div className="map-legend">
            {MANDATE_ORDER.filter((m) => (mandateCounts.get(m) ?? 0) > 0).map((m) => (
              <div key={m} className={`row mandate-${m}`}>
                <span className="sw" />
                <span style={{ textTransform: "capitalize" }}>{m.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        )}

        {!cleanToken && (
          <div className="map-empty">
            <div className="map-empty-card">
              <h2>Mapbox token needed</h2>
              <p>
                Set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> in Vercel (Project → Settings →
                Environment Variables) to a public Mapbox access token, then redeploy.
                A free Mapbox account covers this easily.
              </p>
              <p style={{ fontSize: 11, color: "#8090b5" }}>
                Received token length: <b>{mapboxToken.length}</b>
              </p>
            </div>
          </div>
        )}
        {mapError && (
          <div
            style={{
              position: "absolute", left: 16, bottom: 90, zIndex: 30,
              background: "#fdecec", color: "#a12020",
              border: "1px solid #f3c2c2", borderRadius: 10,
              padding: "10px 14px", fontSize: 12, maxWidth: 420,
              boxShadow: "0 6px 20px rgba(15,22,52,0.14)",
            }}
          >
            <b>Mapbox error:</b> {mapError}
          </div>
        )}
        {mapboxToken && stats.total === 0 && (
          <div className="map-empty">
            <div className="map-empty-card">
              <h2>No properties yet</h2>
              <p>
                Commit a batch from Triage and it will land here. The map plots any property
                with coordinates on file.
              </p>
              <Link href="/triage" className="cta" style={{ display: "inline-block" }}>
                Open Triage →
              </Link>
            </div>
          </div>
        )}
        {stats.total > 0 && plottable.length === 0 && stats.missing === stats.total && (
          <div className="map-empty">
            <div className="map-empty-card">
              <h2>No coordinates on file</h2>
              <p>
                {stats.total} properties in the database, none geocoded yet. Run the Geocode
                button in the top-right corner{isAdmin ? "" : " (admin only)"} to plot them.
              </p>
              {!isAdmin && (
                <p style={{ fontSize: 12, color: "#8090b5" }}>
                  Ask an admin to run it once — pins stick after that.
                </p>
              )}
            </div>
          </div>
        )}

        <aside className={`map-preview ${selectedProperty ? "on" : ""}`}>
          {selectedProperty && (
            <>
              <div className="head">
                <button
                  type="button"
                  className="close"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close preview"
                >
                  ×
                </button>
                <div className={`mandate-line mandate-${selectedProperty.mandateType}`}>
                  <span className="m-chip">
                    {selectedProperty.mandateRaw ?? "No mandate"}
                  </span>
                  {selectedProperty.listingStatus && (
                    <span className="m-chip" style={{ background: "var(--mist)", color: "var(--estuary)" }}>
                      {selectedProperty.listingStatus}
                    </span>
                  )}
                </div>
                <h2 className="addr">{selectedProperty.address}</h2>
                {selectedProperty.suburb && (
                  <p className="suburb">{selectedProperty.suburb}</p>
                )}
              </div>

              <div className="body">
                <p className="price">{formatFullPrice(selectedProperty.askingPrice)}</p>
                <p className="price-sub">Asking price</p>

                <div className="pv-grid">
                  <div className="pv-cell">
                    <div className="lbl">Extent</div>
                    <div className="val">
                      {selectedProperty.extentSqm ? `${selectedProperty.extentSqm} m²` : "—"}
                    </div>
                  </div>
                  <div className="pv-cell">
                    <div className="lbl">Title deed</div>
                    <div className="val mono" style={{ fontSize: 12 }}>
                      {selectedProperty.titleDeed ?? "—"}
                    </div>
                  </div>
                  <div className="pv-cell">
                    <div className="lbl">Transfers</div>
                    <div className="val">{selectedProperty.transferCount}</div>
                  </div>
                  <div className="pv-cell">
                    <div className="lbl">Latest transfer</div>
                    <div className="val" style={{ fontSize: 12 }}>
                      {selectedProperty.transferStatus
                        ? selectedProperty.transferStatus.replace(/_/g, " ")
                        : "—"}
                    </div>
                  </div>
                </div>

                {selectedProperty.listingHeadline && (
                  <p style={{ marginTop: 20, fontFamily: "Inter, -apple-system, sans-serif", color: "var(--estuary)", fontSize: 14, lineHeight: 1.5 }}>
                    {selectedProperty.listingHeadline}
                  </p>
                )}

                <Link href={`/properties/${selectedProperty.id}`} className="pv-cta">
                  Open property record →
                </Link>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
