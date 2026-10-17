"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import "./map.css";
import type { Light } from "@/lib/feeds/registry";
import mapboxgl from "mapbox-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { savePropertyPin } from "./actions";
import PreviewPanel from "./PreviewPanel";
import FilterBar from "./FilterBar";
import ResultsList, { type SortKey } from "./ResultsList";
import HoverCard from "./HoverCard";
import { type Filters, type MapListing, DEFAULT_FILTERS, groupDigits, matches, shortPrice, toListing } from "./listing";

// =============================================================================
// The map (redesigned 2026-10-17).
//
// Simon: "it's just too busy … maybe it's better to have little dots, and
// then you hover over the dot to see some detail … a little search engine:
// this suburb, this price range, this many bedrooms, garden or not."
//
// What changed, and why (research: Airbnb's map-pin paper, Baymard on
// split list + map views, Mapbox's markers-vs-layers guidance):
//   * Every listing is a DOT in a Mapbox layer — not one DOM price flag per
//     listing (hundreds of DOM markers is what made the map feel heavy).
//     Ours are larger, in Dream blue, ringed white; other agencies' are
//     small slate dots. Shape and size, not only colour, tell them apart:
//     a joint mandate is a hollow ring.
//   * Detail on hover: a card with photo, price, rooms, size, who lists it.
//   * Prices on the map are a switch, off by default; when on, labels that
//     would collide are dropped and ours win.
//   * A search bar across the top: area, price (with a bar chart of where
//     prices sit), beds & baths, type, garden / pool, and which listings.
//   * The list beside the map shows what is in view, "N in view of M", and
//     stays in step: hover a card → its dot lights; click a dot → its card.
//   * A calm basemap by default ("Map"), satellite one click away.
//   * Erf outlines only for the listing you hover or select (plus the
//     existing all-erven switch). Every listing now shows at every zoom —
//     before, erf-matched listings vanished below zoom 14.
// =============================================================================

export type MapProperty = {
  id: string;
  address: string;
  suburb: string | null;
  lng: number | null;
  lat: number | null;
  geoManual: boolean; // pin was hand-placed by an admin
  extentSqm: number | null;
  titleDeed: string | null;
  askingPrice: number | null;
  listingStatus: string | null;
  listingHeadline: string | null;
  mandateType: string; // exclusive | joint | open | none
  mandateRaw: string | null;
  transferStatus: string | null;
  transferDate: string | null;
  transferCount: number;
  prclKey: string | null; // cadastral parcel key
  propertyType?: string | null;
};

export type SourceKey = "dream_os" | "dream_website" | "property24" | "private_property";

export type ExternalRef = {
  id: string;
  source: "dream_website" | "property24" | "private_property";
  sourceRef: string;
  url: string | null;
  headline: string | null;
  price: number | null;
  addressRaw: string | null;
  suburb: string | null;
  imageUrl: string | null;
  agencyName: string | null;
  lat: number | null;
  lng: number | null;
  prclKey: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  propertyType?: string | null;
  features?: string[];
  erfSqm?: number | null;
  floorSqm?: number | null;
  /** exact = the house; centroid = only the suburb / estate is known. */
  geocodeSource?: "exact" | "centroid";
};

// For-sale erf (kept for the page's data contract; the map now highlights
// erven per listing via prclKey instead of painting every one).
export type ForSalePolygon = {
  prclKey: string;
  state: "os_exclusive" | "os_joint" | "os_sold" | "os_under_offer" | "os_other" | "market";
  source: SourceKey;
  propertyId?: string;
  listingId?: string;
  price?: number;
  headline?: string;
};

export type UngeocodedExternal = {
  id: string;
  source: "property24" | "private_property";
  lng: number;
  lat: number;
  price: number | null;
  headline: string | null;
};

// One merged pin = one physical listing, potentially on several sources.
export type MergedPin = {
  key: string;
  lng: number;
  lat: number;
  matchedPropertyId: string | null;
  our: MapProperty | null;
  externals: ExternalRef[];
  sources: SourceKey[];
  representative: {
    address: string;
    price: number | null;
    suburb: string | null;
    mandateType: string; // exclusive|joint|open|none|market
  };
};

type Stats = { total: number; geocoded: number; missing: number };

export type BudgetSummary = {
  used: number;
  budget: number;
  softWarnPct: number;
  pctUsed: number;
  monthKey: string;
  alertedSoft: boolean;
  alertedHard: boolean;
};

const KNYSNA_CENTRE: [number, number] = [23.0479, -34.0363];

// Default framing: Buffalo Bay (SW) → Noetzie (NE), the whole coastal strip.
const INITIAL_BOUNDS: [[number, number], [number, number]] = [
  [22.98, -34.1],
  [23.16, -33.99],
];

const BASEMAPS = [
  { id: "map", label: "Map", style: "mapbox://styles/mapbox/light-v11" },
  { id: "satellite", label: "Satellite", style: "mapbox://styles/mapbox/satellite-streets-v12" },
] as const;
type BasemapId = (typeof BASEMAPS)[number]["id"];

// Blueprint palette for the dots (globals.css tokens, as literal values
// because Mapbox paint properties can't read CSS variables).
const C = {
  navy: "#122E87",
  estuary: "#0B1D5A",
  slate: "#7A849E",
  caution: "#9A6A1A",
  positive: "#3D7A4E",
  white: "#FFFFFF",
  ink: "#1B2236",
};

const LS_BASEMAP = "dreamos.map.basemap";
const LS_PRICES = "dreamos.map.prices";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function readLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* private window: the choice just isn't remembered */
  }
}

/** A rounded-rectangle image for price labels (stretched to fit the text). */
function pillImage(fill: string, stroke: string): { width: number; height: number; data: Uint8ClampedArray } {
  const r = 2; // pixel ratio
  const w = 24 * r;
  const h = 20 * r;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const rad = 10 * r - 1;
  g.beginPath();
  g.moveTo(rad + 1, 1);
  g.arcTo(w - 1, 1, w - 1, h - 1, rad);
  g.arcTo(w - 1, h - 1, 1, h - 1, rad);
  g.arcTo(1, h - 1, 1, 1, rad);
  g.arcTo(1, 1, w - 1, 1, rad);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 1.5 * r;
  g.strokeStyle = stroke;
  g.stroke();
  const img = g.getImageData(0, 0, w, h);
  return { width: w, height: h, data: img.data };
}

export default function MapView({
  properties,
  mergedPins,
  isAdmin,
  mapboxToken,
  stats,
  externalCounts,
  sourceHealth,
  styleOverride,
}: {
  /** Dev harness only: a style to use instead of the Mapbox basemaps. */
  styleOverride?: mapboxgl.StyleSpecification;
  properties: MapProperty[];
  mergedPins: MergedPin[];
  forSalePolygons?: ForSalePolygon[];
  ungeocoded?: UngeocodedExternal[];
  isAdmin: boolean;
  mapboxToken: string;
  stats: Stats;
  externalCounts?: { dream_website: number; property24: number; private_property: number };
  sourceHealth?: Partial<Record<SourceKey, Light>>;
  budget?: BudgetSummary | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(0); // bumps on every style load
  const [mapError, setMapError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>("ours");
  const [basemap, setBasemap] = useState<BasemapId>("map");
  const [showPrices, setShowPrices] = useState(false);
  const [showErf, setShowErf] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null); // from the map or the list
  const [hoverFromMap, setHoverFromMap] = useState(false);
  const [hoverXY, setHoverXY] = useState<{ x: number; y: number } | null>(null);
  const [bounds, setBounds] = useState<mapboxgl.LngLatBounds | null>(null);
  const [listOpen, setListOpen] = useState(false); // phones: the list is a sheet

  // Admin "move pin".
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [pinPending, setPinPending] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const dragMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const appliedBasemap = useRef<BasemapId>("map");

  const cleanToken = (mapboxToken ?? "").trim();

  // Remembered per viewer: basemap and the prices switch.
  useEffect(() => {
    const b = readLS(LS_BASEMAP);
    if (b === "map" || b === "satellite") setBasemap(b);
    if (readLS(LS_PRICES) === "1") setShowPrices(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  const listings = useMemo(() => mergedPins.map(toListing), [mergedPins]);
  const byKey = useMemo(() => new Map(listings.map((l) => [l.key, l])), [listings]);
  const filtered = useMemo(() => listings.filter((l) => matches(l, filters)), [listings, filters]);
  const featuresKnown = useMemo(() => listings.some((l) => l.features.length > 0), [listings]);

  const counts = useMemo(() => {
    const bySource: Partial<Record<SourceKey, number>> = {
      property24: externalCounts?.property24,
      private_property: externalCounts?.private_property,
      dream_website: externalCounts?.dream_website,
    };
    return { ours: listings.filter((l) => l.kind === "ours").length, bySource };
  }, [listings, externalCounts]);

  const inView = useMemo(() => {
    const vis = bounds ? filtered.filter((l) => bounds.contains([l.lng, l.lat])) : filtered;
    const byPrice = (a: MapListing, b: MapListing, dir: 1 | -1) => {
      if (a.price == null && b.price == null) return 0;
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return (a.price - b.price) * dir;
    };
    return [...vis].sort((a, b) => {
      if (sort === "ours" && a.kind !== b.kind) return a.kind === "ours" ? -1 : 1;
      return byPrice(a, b, sort === "price_asc" ? 1 : -1);
    });
  }, [filtered, bounds, sort]);

  const selected = selectedKey ? byKey.get(selectedKey) ?? null : null;
  const hovered = hoverKey ? byKey.get(hoverKey) ?? null : null;

  // ---------------------------------------------------------------------------
  // Map setup
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || !cleanToken) return;
    if (!mapboxgl.supported()) {
      setMapError("This browser doesn't support WebGL (Mapbox requires it).");
      return;
    }
    mapboxgl.accessToken = cleanToken;
    const startId: BasemapId = readLS(LS_BASEMAP) === "satellite" ? "satellite" : "map";
    appliedBasemap.current = startId;
    const startStyle = styleOverride ?? BASEMAPS.find((b) => b.id === startId)!.style;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: startStyle,
        center: KNYSNA_CENTRE,
        zoom: 11,
        bounds: INITIAL_BOUNDS,
        fitBoundsOptions: { padding: 32 },
        attributionControl: false,
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
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true, customAttribution: "Dream Knysna" }), "bottom-right");

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    const onMoveEnd = () => setBounds(map.getBounds());
    map.on("moveend", onMoveEnd);
    map.on("load", onMoveEnd);
    map.on("style.load", () => setMapReady((n) => n + 1));

    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- styleOverride is a dev-harness constant
  }, [cleanToken]);

  // Basemap switch: setStyle drops our layers; style.load re-installs them.
  // appliedBasemap is what the map is actually showing (it starts on the
  // remembered choice), so only a real change calls setStyle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemap === appliedBasemap.current) return;
    appliedBasemap.current = basemap;
    const target = BASEMAPS.find((b) => b.id === basemap)?.style;
    if (target && !styleOverride) map.setStyle(target);
    writeLS(LS_BASEMAP, basemap);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- styleOverride is a dev-harness constant
  }, [basemap]);

  // Install sources + layers after every style load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!map.hasImage("pill-ours")) {
      // 48×40 px at pixel ratio 2: stretch the flat middle, keep the round ends.
      const pr = { pixelRatio: 2, stretchX: [[19, 29]] as [number, number][], stretchY: [[18, 22]] as [number, number][], content: [12, 6, 36, 34] as [number, number, number, number] };
      map.addImage("pill-ours", pillImage(C.navy, C.white), pr);
      map.addImage("pill-market", pillImage(C.white, "#C5CDE3"), pr);
    }

    // Erven: vector tiles from our own endpoint, z ≥ 14.
    if (!map.getSource("parcels")) {
      map.addSource("parcels", { type: "vector", tiles: [`${window.location.origin}/api/tiles/parcels/{z}/{x}/{y}`], minzoom: 14, maxzoom: 22 });
      map.addLayer({ id: "parcels-fill", type: "fill", source: "parcels", "source-layer": "parcels", minzoom: 14, paint: { "fill-color": C.navy, "fill-opacity": 0.06 }, layout: { visibility: "none" } });
      map.addLayer({ id: "parcels-line", type: "line", source: "parcels", "source-layer": "parcels", minzoom: 14, paint: { "line-color": C.navy, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.6, 18, 1.6], "line-opacity": 0.55 }, layout: { visibility: "none" } });
      map.addLayer({
        id: "parcels-labels",
        type: "symbol",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 17,
        layout: { "text-field": ["get", "tag_value"], "text-size": 11, "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"], visibility: "none" },
        paint: { "text-color": C.navy, "text-halo-color": C.white, "text-halo-width": 1.4 },
      });
      // The hovered / selected listing's erf.
      map.addLayer({ id: "erf-focus-fill", type: "fill", source: "parcels", "source-layer": "parcels", minzoom: 14, filter: ["in", ["get", "prcl_key"], ["literal", []]], paint: { "fill-color": C.navy, "fill-opacity": 0.16 } });
      map.addLayer({ id: "erf-focus-line", type: "line", source: "parcels", "source-layer": "parcels", minzoom: 14, filter: ["in", ["get", "prcl_key"], ["literal", []]], paint: { "line-color": C.navy, "line-width": 2.2 } });
    }

    if (!map.getSource("listings")) {
      map.addSource("listings", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "key" });

      // Zoom must stay the top-level interpolate, so the hover / selected
      // growth multiplies each stop.
      const focused = ["case", ["any", ["boolean", ["feature-state", "hover"], false], ["boolean", ["feature-state", "selected"], false]], 1.45, 1];
      const grow = (a: number, b: number, c: number) =>
        ["interpolate", ["linear"], ["zoom"], 10, ["*", a, focused], 13, ["*", b, focused], 17, ["*", c, focused]] as mapboxgl.Expression;

      // Other agencies: small slate dots.
      map.addLayer({
        id: "dots-market",
        type: "circle",
        source: "listings",
        filter: ["==", ["get", "kind"], "market"],
        paint: {
          "circle-radius": grow(2.6, 3.6, 5.5),
          // Area-only listings (we know the suburb, not the house) are hollow:
          // the dot marks the area, not a claim about the address.
          "circle-color": ["case", ["boolean", ["feature-state", "hover"], false], C.estuary, ["==", ["get", "area"], 1], C.white, C.slate],
          "circle-stroke-color": ["case", ["==", ["get", "area"], 1], C.slate, C.white],
          // Zoom stays the top-level interpolate (Mapbox rule); the case sits in each stop.
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["==", ["get", "area"], 1], 1.4, 0.8], 13, ["case", ["==", ["get", "area"], 1], 1.6, 1.2], 17, ["case", ["==", ["get", "area"], 1], 1.8, 1.6]],
          "circle-opacity": 0.92,
        },
      });
      // Ours: larger, Dream blue; joint = hollow ring; deal states recoloured.
      const fill: mapboxgl.Expression = ["match", ["get", "state"], "joint", C.white, "under_offer", C.caution, "sold", C.positive, C.navy];
      map.addLayer({
        id: "dots-ours",
        type: "circle",
        source: "listings",
        filter: ["==", ["get", "kind"], "ours"],
        paint: {
          "circle-radius": grow(4.5, 6, 8.5),
          "circle-color": fill,
          "circle-stroke-color": ["match", ["get", "state"], "joint", C.navy, C.white],
          "circle-stroke-width": ["match", ["get", "state"], "joint", 2.6, 2],
        },
      });
      // A ring around whatever is hovered or selected.
      map.addLayer({
        id: "dots-ring",
        type: "circle",
        source: "listings",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["==", ["get", "kind"], "ours"], 10, 7], 13, ["case", ["==", ["get", "kind"], "ours"], 12, 8.5], 17, ["case", ["==", ["get", "kind"], "ours"], 15, 11]],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": C.navy,
          "circle-stroke-width": 2,
          "circle-stroke-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, ["boolean", ["feature-state", "hover"], false], 0.55, 0],
        },
      });
      // Prices — a switch. Collisions drop labels; ours are placed first.
      map.addLayer({
        id: "prices",
        type: "symbol",
        source: "listings",
        // No pill for "price on application": it says nothing a dot doesn't.
        filter: ["all", ["!=", ["get", "label"], "POA"], ["any", ["==", ["get", "kind"], "ours"], [">=", ["zoom"], 13]]],
        layout: {
          visibility: "none",
          "text-field": ["get", "label"],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          "text-size": ["case", ["==", ["get", "kind"], "ours"], 12, 11],
          "text-anchor": "bottom",
          "text-offset": [0, -1.1],
          "icon-image": ["case", ["==", ["get", "kind"], "ours"], "pill-ours", "pill-market"],
          "icon-text-fit": "both",
          "icon-text-fit-padding": [2, 7, 2, 7],
          "symbol-sort-key": ["get", "sort"],
          "text-allow-overlap": false,
          "icon-allow-overlap": false,
        },
        paint: { "text-color": ["case", ["==", ["get", "kind"], "ours"], C.white, C.ink] },
      });
      // An invisible, generous hit area: small dots are hard to hover.
      map.addLayer({ id: "dots-hit", type: "circle", source: "listings", paint: { "circle-radius": 11, "circle-opacity": 0 } });
    }
    pushData();
    applyToggles();
    applyFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // Data → the listings source.
  const pushData = useCallback(() => {
    const map = mapRef.current;
    const src = map?.getSource("listings") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: filtered.map((l) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [l.lng, l.lat] },
        properties: {
          key: l.key,
          kind: l.kind,
          state: l.state ?? "market",
          area: l.areaOnly ? 1 : 0,
          label: shortPrice(l.price),
          sort: l.kind === "ours" ? 0 : l.price == null ? 2 : 1,
        },
      })),
    });
    // feature-state survives setData for keys that remain.
  }, [filtered]);
  useEffect(() => pushData(), [pushData]);

  const applyToggles = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("prices")) return;
    map.setLayoutProperty("prices", "visibility", showPrices ? "visible" : "none");
    for (const id of ["parcels-fill", "parcels-line", "parcels-labels"]) map.setLayoutProperty(id, "visibility", showErf ? "visible" : "none");
  }, [showPrices, showErf]);
  useEffect(() => {
    applyToggles();
    writeLS(LS_PRICES, showPrices ? "1" : "0");
  }, [applyToggles, showPrices]);

  // Hover / selected → feature-state on the dots, and the erf outline.
  const prevHover = useRef<string | null>(null);
  const prevSel = useRef<string | null>(null);
  const applyFocus = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("listings")) return;
    const set = (key: string | null, state: Record<string, boolean>) => {
      if (key) map.setFeatureState({ source: "listings", id: key }, state);
    };
    if (prevHover.current !== hoverKey) set(prevHover.current, { hover: false });
    if (prevSel.current !== selectedKey) set(prevSel.current, { selected: false });
    set(hoverKey, { hover: true });
    set(selectedKey, { selected: true });
    prevHover.current = hoverKey;
    prevSel.current = selectedKey;
    const erfs = [hovered?.prclKey, selected?.prclKey].filter(Boolean) as string[];
    for (const id of ["erf-focus-fill", "erf-focus-line"]) {
      if (map.getLayer(id)) map.setFilter(id, ["in", ["get", "prcl_key"], ["literal", erfs]]);
    }
  }, [hoverKey, selectedKey, hovered, selected]);
  useEffect(() => applyFocus(), [applyFocus, filtered]);

  // Pointer events on the dots (bound once per map).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onMove = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      // Ours win where dots overlap.
      const feats = map.queryRenderedFeatures(e.point, { layers: ["dots-hit"] });
      if (!feats.length) return;
      const pick = feats.find((f) => f.properties?.kind === "ours") ?? feats[0];
      const key = pick.properties?.key as string;
      map.getCanvas().style.cursor = "pointer";
      setHoverKey(key);
      setHoverFromMap(true);
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
      setHoverKey(null);
      setHoverFromMap(false);
    };
    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: ["dots-hit"] });
      if (!feats.length) return;
      const pick = feats.find((f) => f.properties?.kind === "ours") ?? feats[0];
      setSelectedKey(pick.properties?.key as string);
      setListOpen(false);
    };
    map.on("mousemove", "dots-hit", onMove);
    map.on("mouseleave", "dots-hit", onLeave);
    map.on("click", "dots-hit", onClick);
    return () => {
      map.off("mousemove", "dots-hit", onMove);
      map.off("mouseleave", "dots-hit", onLeave);
      map.off("click", "dots-hit", onClick);
    };
  }, [mapReady]);

  // Erven switch on: click an erf (not a listing) for its municipal record.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let popup: mapboxgl.Popup | null = null;
    const onClick = async (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      if (map.queryRenderedFeatures(e.point, { layers: ["dots-hit"] }).length) return;
      const props = (e.features?.[0]?.properties ?? {}) as { prcl_key?: string; tag_value?: string; maj_region?: string };
      if (!props.prcl_key && !props.tag_value) return;
      popup?.remove();
      popup = new mapboxgl.Popup({ closeButton: true, maxWidth: "300px", className: "mx-erf-pop" })
        .setLngLat(e.lngLat)
        .setHTML(`<p class="mx-erf-loading">Loading municipal record…</p>`)
        .addTo(map);
      try {
        const qs = new URLSearchParams();
        if (props.tag_value) qs.set("erf", props.tag_value);
        if (props.maj_region) qs.set("town", props.maj_region);
        const seg = encodeURIComponent(props.prcl_key ?? props.tag_value ?? "unknown");
        const res = await fetch(qs.toString() ? `/api/muni/at-erf/${seg}?${qs}` : `/api/muni/at-erf/${seg}`);
        const j = await res.json();
        if (!res.ok || j.error) {
          popup.setHTML(`<p class="mx-erf-loading">${esc(j.error ?? "No municipal record for this erf.")}</p>`);
          return;
        }
        const r = (n: number | null | undefined) => (n == null ? "—" : `R ${groupDigits(n)}`);
        popup.setHTML(`
<div class="mx-erf">
  <p class="mx-erf-eyebrow">Erf ${esc(j.erfNumber ?? "?")} · ${esc(j.town ?? j.suburb ?? "")}</p>
  <p class="mx-erf-addr">${esc(j.address ?? "No address on file")}</p>
  <p class="mx-erf-val">${r(j.muniValuationTotal)}<span> municipal valuation</span></p>
  <p class="mx-erf-meta">${[j.extentSqm ? `${j.extentSqm} m²` : null, j.zoning, j.use].filter(Boolean).map(esc).join(" · ")}</p>
  ${j.purchDate ? `<p class="mx-erf-meta">Last sale ${esc(j.purchDate)}${j.purchPrice ? ` · ${r(j.purchPrice)}` : ""}</p>` : ""}
  <a class="mx-erf-link" href="/erf-lookup?q=${encodeURIComponent(j.erfNumber ?? "")}${j.town ? `&suburb=${encodeURIComponent(j.town)}` : ""}">Full erf record →</a>
</div>`);
      } catch (err) {
        popup?.setHTML(`<p class="mx-erf-loading">${esc((err as Error).message)}</p>`);
      }
    };
    const onEnter = () => (map.getCanvas().style.cursor = "pointer");
    const onLeave = () => (map.getCanvas().style.cursor = "");
    map.on("click", "parcels-fill", onClick);
    map.on("mouseenter", "parcels-fill", onEnter);
    map.on("mouseleave", "parcels-fill", onLeave);
    return () => {
      map.off("click", "parcels-fill", onClick);
      map.off("mouseenter", "parcels-fill", onEnter);
      map.off("mouseleave", "parcels-fill", onLeave);
      popup?.remove();
    };
  }, [mapReady]);

  // Keep the hover card glued to its dot while the map moves.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hovered || !hoverFromMap) {
      setHoverXY(null);
      return;
    }
    const place = () => {
      const p = map.project([hovered.lng, hovered.lat]);
      setHoverXY({ x: p.x, y: p.y });
    };
    place();
    map.on("move", place);
    return () => {
      map.off("move", place);
    };
  }, [hovered, hoverFromMap]);

  // Picking an area fits the map to its listings.
  const lastAreas = useRef<string>("");
  useEffect(() => {
    const sig = filters.areas.join("|") + "#" + filters.query;
    if (sig === lastAreas.current) return;
    lastAreas.current = sig;
    const map = mapRef.current;
    if (!map || (!filters.areas.length && !filters.query.trim())) return;
    if (!filtered.length) return;
    // Fit to where the area's listings actually are: a stray mis-geocoded
    // pin kilometres away shouldn't drag the view out to sea.
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const cx = med(filtered.map((l) => l.lng));
    const cy = med(filtered.map((l) => l.lat));
    const d = (l: MapListing) => Math.hypot(l.lng - cx, l.lat - cy);
    const md = med(filtered.map(d));
    const core = filtered.length > 4 ? filtered.filter((l) => d(l) <= Math.max(md * 3, 0.004)) : filtered;
    const b = new mapboxgl.LngLatBounds();
    for (const l of core) b.extend([l.lng, l.lat]);
    map.fitBounds(b, { padding: 80, maxZoom: 16, duration: 600 });
  }, [filters.areas, filters.query, filtered]);

  // Selecting from the list flies there if the dot is off screen.
  const selectFromList = (key: string) => {
    setSelectedKey(key);
    setListOpen(false);
    const map = mapRef.current;
    const l = byKey.get(key);
    const vb = map?.getBounds();
    if (map && l && vb && !vb.contains([l.lng, l.lat])) {
      map.easeTo({ center: [l.lng, l.lat], zoom: Math.max(map.getZoom(), 14), duration: 500 });
    }
  };

  // ?property=<id>[&lng&lat]: fly there and open its panel, once.
  const didUrlTarget = useRef(false);
  useEffect(() => {
    if (didUrlTarget.current || !mapReady) return;
    const map = mapRef.current;
    const propId = searchParams?.get("property");
    const lngStr = searchParams?.get("lng");
    const latStr = searchParams?.get("lat");
    if (!map || (!propId && !lngStr)) return;
    didUrlTarget.current = true;
    let lng = lngStr ? Number(lngStr) : null;
    let lat = latStr ? Number(latStr) : null;
    if ((lng == null || !Number.isFinite(lng)) && propId) {
      const p = properties.find((pp) => pp.id === propId);
      if (p) {
        lng = p.lng;
        lat = p.lat;
      }
    }
    if (lng != null && lat != null && Number.isFinite(lng) && Number.isFinite(lat)) map.flyTo({ center: [lng, lat], zoom: 17, essential: true });
    const hit = propId ? mergedPins.find((p) => p.matchedPropertyId === propId || p.our?.id === propId) : null;
    if (hit) setSelectedKey(hit.key);
  }, [mapReady, searchParams, mergedPins, properties]);

  // ---------------------------------------------------------------------------
  // Admin: move a pin. A temporary draggable marker over the dot; saves on drop.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (dragKey && dragKey !== selectedKey) {
      setDragKey(null);
      setPinMsg(null);
      setPinErr(null);
    }
  }, [selectedKey, dragKey]);

  useEffect(() => {
    const map = mapRef.current;
    dragMarkerRef.current?.remove();
    dragMarkerRef.current = null;
    if (!map || !dragKey) return;
    const l = byKey.get(dragKey);
    const propertyId = l?.pin.matchedPropertyId ?? l?.pin.our?.id;
    if (!l || !propertyId) return;
    const el = document.createElement("div");
    el.className = "mx-drag-pin";
    el.setAttribute("aria-label", "Drag to the correct spot");
    const marker = new mapboxgl.Marker({ element: el, draggable: true }).setLngLat([l.lng, l.lat]).addTo(map);
    marker.on("dragend", () => {
      const ll = marker.getLngLat();
      setPinErr(null);
      setPinMsg(null);
      setPinPending(true);
      savePropertyPin(propertyId, ll.lng, ll.lat)
        .then((res) => {
          if (!res.ok) setPinErr(res.error ?? "save failed");
          else {
            setPinMsg("Pin saved. Automated geocoders will skip this property.");
            setDragKey(null);
            router.refresh();
            setTimeout(() => setPinMsg(null), 3200);
          }
        })
        .catch((e) => setPinErr((e as Error).message))
        .finally(() => setPinPending(false));
    });
    dragMarkerRef.current = marker;
    map.easeTo({ center: [l.lng, l.lat], zoom: Math.max(map.getZoom(), 17), duration: 500 });
    return () => {
      marker.remove();
    };
  }, [dragKey, byKey, router]);

  // ---------------------------------------------------------------------------

  const stageW = stageRef.current?.clientWidth ?? 800;

  return (
    <div className="mx-shell">
      <FilterBar filters={filters} setFilters={setFilters} listings={listings} counts={counts} sourceHealth={sourceHealth} featuresKnown={featuresKnown} />

      <div className="mx-main">
        <aside className={`mx-side${listOpen ? " open" : ""}`} aria-label="Listings in view">
          <ResultsList
            items={inView}
            total={filtered.length}
            sort={sort}
            setSort={setSort}
            hoverKey={hoverKey}
            selectedKey={selectedKey}
            onHover={(k) => {
              setHoverKey(k);
              setHoverFromMap(false);
            }}
            onSelect={selectFromList}
          />
        </aside>

        <div className="mx-stage" ref={stageRef}>
          <div ref={containerRef} className="mx-canvas" />

          <div className="mx-tools">
            <div className="mx-seg" role="group" aria-label="Basemap">
              {BASEMAPS.map((b) => (
                <button key={b.id} type="button" className={basemap === b.id ? "on" : ""} onClick={() => setBasemap(b.id)}>
                  {b.label}
                </button>
              ))}
            </div>
            <button type="button" className={`mx-tool${showPrices ? " on" : ""}`} aria-pressed={showPrices} onClick={() => setShowPrices((v) => !v)}>
              Prices
            </button>
            <button
              type="button"
              className={`mx-tool${showErf ? " on" : ""}`}
              aria-pressed={showErf}
              onClick={() => setShowErf((v) => !v)}
              title="Every surveyed erf, from zoom 14. Click an erf for its municipal valuation."
            >
              Erven
            </button>
          </div>

          <div className="mx-legend" aria-label="Legend">
            <span><i className="dot ours" /> Ours</span>
            <span><i className="dot joint" /> Joint</span>
            <span><i className="dot offer" /> Under offer</span>
            <span><i className="dot market" /> Other agencies</span>
            <span><i className="dot area" /> Area only</span>
          </div>

          {hovered && hoverFromMap && hoverXY && hovered.key !== selectedKey && <HoverCard listing={hovered} x={hoverXY.x} y={hoverXY.y} stageW={stageW} />}

          <button type="button" className="mx-list-toggle" onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}>
            {listOpen ? "Show map" : `List · ${inView.length}`}
          </button>

          {!cleanToken && (
            <div className="map-empty">
              <div className="map-empty-card">
                <h2>Mapbox token needed</h2>
                <p>
                  Set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> in Vercel (Project → Settings → Environment Variables) to a public Mapbox access token, then redeploy.
                </p>
              </div>
            </div>
          )}
          {mapError && (
            <div className="mx-error">
              <b>Map error:</b> {mapError}
            </div>
          )}
          {cleanToken && stats.total === 0 && mergedPins.length === 0 && (
            <div className="map-empty">
              <div className="map-empty-card">
                <h2>No properties or market listings yet</h2>
                <p>Commit a batch from Triage, or wait for tonight&apos;s scraper run to surface market listings.</p>
                <Link href="/triage" className="btn-primary" style={{ display: "inline-block" }}>
                  Open Triage →
                </Link>
              </div>
            </div>
          )}

          <aside className={`map-preview ${selected ? "on" : ""}`}>
            {selected && (
              <PreviewPanel
                pin={selected.pin}
                onClose={() => setSelectedKey(null)}
                isAdmin={isAdmin}
                inDragMode={dragKey === selected.key}
                onStartDrag={() => {
                  setPinMsg(null);
                  setPinErr(null);
                  setDragKey(selected.key);
                }}
                onCancelDrag={() => setDragKey(null)}
                pinPending={pinPending}
                pinMsg={pinMsg}
                pinErr={pinErr}
              />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
