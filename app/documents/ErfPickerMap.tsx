"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

// A small satellite map for the mandate take-on (2026-10-19). Simon: the
// property search "should allow you to find the property on the map as
// well". It does two things:
//   * follows the search — picking a result flies here and outlines the erf;
//   * picks from the map — click any erf boundary (zoomed in) to choose it.
// Erf boundaries come from the same parcel tiles as the main map
// (/api/tiles/parcels), and a click reads the municipal record the same way
// the main map's erf popup does (/api/muni/at-erf).

export type MapErf = {
  erfNumber: string;
  sgNumber: string | null;
  address: string | null;
  suburb: string | null;
  extentSqm: number | null;
  titleDeedNo: string | null;
  prclKey: string | null;
  lng: number;
  lat: number;
};

export type MapFocus = { lng: number; lat: number; prclKey: string | null } | null;

const KNYSNA: [number, number] = [23.0479, -34.0363];
const PARCEL_MIN_ZOOM = 14;
const NO_KEYS: string[] = [];

export default function ErfPickerMap({
  token,
  focus,
  onPick,
}: {
  token: string;
  focus: MapFocus;
  onPick: (erf: MapErf) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(12);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!box.current || !token) return;
    if (!mapboxgl.supported()) {
      setFailed("This browser can't show the map (WebGL is off).");
      return;
    }
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: box.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: KNYSNA,
      zoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource("parcels", {
        type: "vector",
        tiles: [`${window.location.origin}/api/tiles/parcels/{z}/{x}/{y}`],
        minzoom: PARCEL_MIN_ZOOM,
        maxzoom: 22,
      });
      map.addLayer({
        id: "pick-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: PARCEL_MIN_ZOOM,
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.04 },
      });
      map.addLayer({
        id: "pick-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: PARCEL_MIN_ZOOM,
        paint: { "line-color": "#ffffff", "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.5, 18, 1.4] },
      });
      map.addLayer({
        id: "pick-hover",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: PARCEL_MIN_ZOOM,
        filter: ["in", ["get", "prcl_key"], ["literal", NO_KEYS]],
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: "pick-chosen-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: PARCEL_MIN_ZOOM,
        filter: ["in", ["get", "prcl_key"], ["literal", NO_KEYS]],
        paint: { "fill-color": "#F2C14E", "fill-opacity": 0.35 },
      });
      map.addLayer({
        id: "pick-chosen-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: PARCEL_MIN_ZOOM,
        filter: ["in", ["get", "prcl_key"], ["literal", NO_KEYS]],
        paint: { "line-color": "#F2C14E", "line-width": 2.5 },
      });
      setReady(true);
    });
    map.on("zoomend", () => setZoom(map.getZoom()));

    let hovered: string | null = null;
    map.on("mousemove", "pick-fill", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const key = (e.features?.[0]?.properties as { prcl_key?: string } | undefined)?.prcl_key ?? null;
      if (key !== hovered) {
        hovered = key;
        map.setFilter("pick-hover", ["in", ["get", "prcl_key"], ["literal", key ? [key] : NO_KEYS]]);
      }
    });
    map.on("mouseleave", "pick-fill", () => {
      map.getCanvas().style.cursor = "";
      hovered = null;
      map.setFilter("pick-hover", ["in", ["get", "prcl_key"], ["literal", NO_KEYS]]);
    });

    map.on("click", "pick-fill", async (e) => {
      const props = (e.features?.[0]?.properties ?? {}) as { prcl_key?: string; tag_value?: string; maj_region?: string };
      if (!props.prcl_key && !props.tag_value) return;
      setBusy(true);
      setNote(null);
      try {
        const qs = new URLSearchParams();
        if (props.tag_value) qs.set("erf", props.tag_value);
        if (props.maj_region) qs.set("town", props.maj_region);
        const seg = encodeURIComponent(props.prcl_key ?? props.tag_value ?? "unknown");
        const res = await fetch(`/api/muni/at-erf/${seg}?${qs}`);
        const j = await res.json();
        if (!res.ok || j.error) {
          setNote("No municipal record for that erf. Try the one next to it, or search by address.");
          return;
        }
        pickRef.current({
          erfNumber: String(j.erfNumber ?? props.tag_value ?? ""),
          sgNumber: j.sgNumber ?? null,
          address: j.address ?? null,
          suburb: j.suburb ?? j.town ?? null,
          extentSqm: j.extentSqm ?? null,
          titleDeedNo: j.titleDeed ?? null,
          prclKey: props.prcl_key ?? null,
          lng: e.lngLat.lng,
          lat: e.lngLat.lat,
        });
      } catch {
        setNote("Couldn't read that erf. Try again.");
      } finally {
        setBusy(false);
      }
    });

    return () => {
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [token]);

  // Follow the chosen property / erf.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const keys = focus?.prclKey ? [focus.prclKey] : NO_KEYS;
    map.setFilter("pick-chosen-fill", ["in", ["get", "prcl_key"], ["literal", keys]]);
    map.setFilter("pick-chosen-line", ["in", ["get", "prcl_key"], ["literal", keys]]);
    markerRef.current?.remove();
    markerRef.current = null;
    if (!focus) return;
    if (!focus.prclKey) {
      markerRef.current = new mapboxgl.Marker({ color: "#F2C14E" }).setLngLat([focus.lng, focus.lat]).addTo(map);
    }
    map.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 17), duration: 900 });
  }, [focus, ready]);

  if (!token) return null;
  return (
    <div className="erfmap">
      <div ref={box} className="erfmap-canvas" role="region" aria-label="Map: click an erf to choose it" />
      {failed ? (
        <p className="erfmap-hint">{failed}</p>
      ) : (
        <p className="erfmap-hint" aria-live="polite">
          {busy
            ? "Reading the municipal record…"
            : note ??
              (zoom < PARCEL_MIN_ZOOM ? "Zoom in to see the erf boundaries, then click the property." : "Click an erf to choose it.")}
        </p>
      )}
    </div>
  );
}
