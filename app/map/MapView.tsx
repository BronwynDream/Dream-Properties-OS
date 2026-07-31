"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import mapboxgl from "mapbox-gl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { geocodeMissingProperties, savePropertyPin } from "./actions";
import RefreshDreamButton from "./RefreshDreamButton";
import RefreshMuniButton from "./RefreshMuniButton";
import RefreshProperty24Button from "./RefreshProperty24Button";
import DrainQueueButton from "./DrainQueueButton";
import RegeocodeProperty24Button from "./RegeocodeProperty24Button";
import MarketListingAttach from "./MarketListingAttach";
import RegeocodeListingButton from "./RegeocodeListingButton";

export type MapProperty = {
  id: string;
  address: string;
  suburb: string | null;
  lng: number | null;
  lat: number | null;
  geoManual: boolean;              // pin was hand-placed by an admin
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
  prclKey: string | null;          // cadastral parcel key for polygon rendering
};

export type SourceKey =
  | "dream_os"
  | "dream_website"
  | "property24"
  | "private_property";

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
  prclKey: string | null;          // cadastral parcel key; null = ungeocoded to parcel
};

// For-sale property rendered as a coloured cadastral polygon at z≥14.
export type ForSalePolygon = {
  prclKey: string;
  state: "os_exclusive" | "os_joint" | "os_sold" | "os_under_offer" | "os_other" | "market";
  propertyId?: string;
  listingId?: string;
  price?: number;
  headline?: string;
};

// External listing with lat/lng but no prcl_key — rendered as a discreet dot.
export type UngeocodedExternal = {
  id: string;
  source: "property24" | "private_property";
  lng: number;
  lat: number;
  price: number | null;
  headline: string | null;
};

// One merged pin = one physical listing, potentially spanning multiple sources.
// `our` is set when we own the underlying property; `externals` lists every
// portal / feed row that resolved to this same listing. Every merged pin has
// a stable key (prop-<id> / grp-<uuid> / ext-<id>) so the map can maintain
// its markers across re-renders.
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
    mandateType: string; // exclusive|sole|joint|open|none|market
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

// Default framing on map open: Buffalo Bay (SW) → Noetzie (NE). Chosen by
// Simon to always show the full Knysna coastal strip — lagoon, Leisure Isle,
// The Heads, Pezula — no matter which OS listings exist. mapbox.fitBounds
// auto-adapts to viewport size so mobile/desktop both frame it sensibly.
const INITIAL_BOUNDS: [[number, number], [number, number]] = [
  [22.98, -34.10], // SW: past Buffalo Bay
  [23.16, -33.99], // NE: past Noetzie / Pezula
];

const MANDATE_ORDER = ["exclusive", "sole", "joint", "under_offer", "open", "none"] as const;

const SOURCE_ORDER: SourceKey[] = [
  "dream_os",
  "dream_website",
  "property24",
  "private_property",
];

// Label + short code for each source. `code` shows on the pin's source stack
// (compact letters/dots); `label` shows in the rail chips and preview panel.
const SOURCE_META: Record<SourceKey, { label: string; code: string }> = {
  dream_os:         { label: "Our listings",       code: "OS" },
  dream_website:    { label: "Dream website",      code: "DW" },
  property24:       { label: "Property24",         code: "P24" },
  private_property: { label: "Private Property",   code: "PP" },
};

const BASEMAPS = [
  {
    id: "satellite",
    label: "Satellite",
    style: "mapbox://styles/mapbox/satellite-streets-v12",
  },
  { id: "streets", label: "Streets", style: "mapbox://styles/mapbox/streets-v12" },
  { id: "light",   label: "Light",   style: "mapbox://styles/mapbox/light-v11" },
] as const;

type BasemapId = (typeof BASEMAPS)[number]["id"];

// Plan 005: colour map for for-sale cadastral polygon fills.
// Keys match ForSalePolygon.state values.
const STATE_COLORS: Record<string, string> = {
  os_exclusive:   "#C8A032", // gold
  os_joint:       "#132B84", // navy
  os_sold:        "#1C5B3A", // forest
  os_under_offer: "#D17E22", // amber
  os_other:       "#6B78A0", // slate
  market:         "#8090B5", // grey
};

// Build a Mapbox 'match' expression that assigns a fill colour per prcl_key.
function buildMatchExpr(rows: ForSalePolygon[]): mapboxgl.Expression {
  const pairs: (string | number)[] = [];
  for (const r of rows) {
    pairs.push(r.prclKey, STATE_COLORS[r.state] ?? STATE_COLORS.os_other);
  }
  return ["match", ["get", "prcl_key"], ...pairs, "#8090B5"] as mapboxgl.Expression;
}

function formatPrice(n: number | null): string {
  if (n == null) return "POR";
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
  mergedPins,
  forSalePolygons,
  ungeocoded,
  isAdmin,
  mapboxToken,
  stats,
  externalCounts,
  budget,
}: {
  properties: MapProperty[];
  mergedPins: MergedPin[];
  forSalePolygons: ForSalePolygon[];
  ungeocoded: UngeocodedExternal[];
  isAdmin: boolean;
  mapboxToken: string;
  stats: Stats;
  // Raw DB counts per external source. Passed straight through to the
  // "Sources" chip so the number matches what SQL says, not what merging
  // + dedup collapses down to. Optional so an older caller doesn't 500;
  // when absent the chips fall back to merged-pin counts.
  externalCounts?: {
    dream_website: number;
    property24: number;
    private_property: number;
  };
  budget?: BudgetSummary | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});

  // Refs let the dragend handler (registered ONCE per marker at creation)
  // read the current drag mode + trigger the save without stale closures.
  const dragKeyRef = useRef<string | null>(null);
  const pinPropertyIdRef = useRef<Record<string, string>>({}); // mergedKey → property.id
  const didInitialFitRef = useRef(false);
  const didUrlTargetRef = useRef(false); // one-shot: honour ?property=/lng/lat exactly once per mount
  const handlePinDropRef = useRef<(propertyId: string, lng: number, lat: number) => void>(
    () => {},
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [enabledMandates, setEnabledMandates] = useState<Set<string>>(
    () => new Set(MANDATE_ORDER),
  );
  // Sources filter — all four available. dream_website is off by default:
  // the WordPress scraper produces unreliable titles/coords (image-filename
  // address extraction, centroid-collapsed pins) and we've settled on P24 as
  // source of truth for market data. The chip stays togglable so a director
  // can spot-check DW when a portal listing looks suspicious.
  const [enabledSources, setEnabledSources] = useState<Set<SourceKey>>(
    () => new Set<SourceKey>(["dream_os", "property24", "private_property"]),
  );
  const [splitDupes, setSplitDupes] = useState(false);
  // Erf boundaries overlay — off by default. Vector tiles are served from
  // /api/tiles/parcels/{z}/{x}/{y}; source-layer name matches parcel_mvt's
  // ST_AsMVT layer arg ('parcels').
  const [showErf, setShowErf] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>("satellite");
  // Mobile-only: rail as a bottom sheet. Desktop CSS makes this state a no-op
  // (the rail is always visible at ≥901px), but it's cheap to keep both
  // branches driven from one flag.
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Admin-only manual pin move. dragKey is the mergedKey of the pin currently
  // in drag mode. Ref mirror lets marker-level dragend read it without a
  // stale closure. pinMsg/pinErr surface success/failure in the preview panel.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [pinPending, setPinPending] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [pinErr, setPinErr] = useState<string | null>(null);
  useEffect(() => { dragKeyRef.current = dragKey; }, [dragKey]);
  const [geocodeMsg, setGeocodeMsg] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const cleanToken = (mapboxToken ?? "").trim();

  // Selecting a different pin cancels any in-flight drag mode so the state
  // machine can't get stuck showing "Drop pin to save" on a stale target.
  useEffect(() => {
    if (dragKey && dragKey !== selectedKey) {
      setDragKey(null);
      setPinMsg(null);
      setPinErr(null);
    }
  }, [selectedKey, dragKey]);

  // On drop, immediately save + exit drag mode. The marker retains its new
  // position because Mapbox has already moved it; router.refresh() then
  // pulls the persisted coords + geo_manual flag on the next render.
  useEffect(() => {
    handlePinDropRef.current = (propertyId, lng, lat) => {
      setPinErr(null);
      setPinMsg(null);
      setPinPending(true);
      savePropertyPin(propertyId, lng, lat)
        .then((res) => {
          if (!res.ok) {
            setPinErr(res.error ?? "save failed");
          } else {
            setPinMsg("Pin saved. Automated geocoders will skip this property.");
            setDragKey(null);
            router.refresh();
            setTimeout(() => setPinMsg(null), 3200);
          }
        })
        .catch((e) => setPinErr((e as Error).message))
        .finally(() => setPinPending(false));
    };
  }, [router]);

  // Counts for the rail chips.
  const mandateCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of properties) {
      m.set(p.mandateType, (m.get(p.mandateType) ?? 0) + 1);
    }
    return m;
  }, [properties]);

  const sourceCounts = useMemo(() => {
    const m = new Map<SourceKey, number>();
    for (const s of SOURCE_ORDER) m.set(s, 0);
    for (const pin of mergedPins) {
      for (const s of pin.sources) m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [mergedPins]);

  // A merged pin is visible if:
  //   - AT LEAST ONE of its sources is enabled, AND
  //   - if it has an `our` record, its mandate is enabled (so mandate chips
  //     still work as a filter on our own stock);
  //   - if it has no `our` record (market-only), the mandate filter doesn't
  //     apply (there's nothing to filter on).
  const visiblePins = useMemo(() => {
    return mergedPins.filter((pin) => {
      const anySource = pin.sources.some((s) => enabledSources.has(s));
      if (!anySource) return false;
      if (pin.our && !enabledMandates.has(pin.our.mandateType)) return false;
      return true;
    });
  }, [mergedPins, enabledMandates, enabledSources]);

  const visibleProperties = useMemo(
    () => properties.filter((p) => enabledMandates.has(p.mandateType)),
    [properties, enabledMandates],
  );

  const selectedPin =
    mergedPins.find((p) => p.key === selectedKey) ?? null;

  // Honour ?property=<id> [&lng=X&lat=Y] on first-render: fly to the
  // property's coord and open its panel if it matches a rendered pin.
  // Runs once per mount — a pin re-render (mandate filter change etc.)
  // shouldn't yank the view back. Fires after mergedPins are settled
  // and after the map has completed its initial fitBounds so the flyTo
  // isn't overridden by the coastal-strip framing.
  useEffect(() => {
    if (didUrlTargetRef.current) return;
    const map = mapRef.current;
    if (!map) return;
    const propId = searchParams?.get("property");
    const lngStr = searchParams?.get("lng");
    const latStr = searchParams?.get("lat");
    if (!propId && !lngStr) return;

    // Resolve target coord — from URL params if present, else look the
    // property up in the props array. A property with no coord can't be
    // flown-to but we still open its panel where possible.
    let lng: number | null = lngStr ? Number(lngStr) : null;
    let lat: number | null = latStr ? Number(latStr) : null;
    if ((lng == null || !Number.isFinite(lng)) && propId) {
      const p = properties.find((pp) => pp.id === propId);
      if (p) { lng = p.lng; lat = p.lat; }
    }

    const fly = () => {
      if (lng != null && lat != null && Number.isFinite(lng) && Number.isFinite(lat)) {
        map.flyTo({ center: [lng, lat], zoom: 17, essential: true });
      }
      // Match a mergedPin either by explicit property id or by nearest coord.
      let matched = propId ? mergedPins.find((p) => p.matchedPropertyId === propId || p.our?.id === propId) : null;
      if (matched) setSelectedKey(matched.key);
      didUrlTargetRef.current = true;
    };

    // Wait until the map has done its initial fitBounds before flying.
    if (didInitialFitRef.current) {
      fly();
    } else {
      const t = setTimeout(fly, 400);
      return () => clearTimeout(t);
    }
  }, [searchParams, mergedPins, properties]);

  // Map init.
  useEffect(() => {
    if (!containerRef.current) return;
    if (!cleanToken) return;
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
        // INITIAL_BOUNDS gives the same coastal-strip framing across viewports.
        // center + zoom are needed as a first paint before the style loads;
        // fitBounds runs immediately on load below and takes over.
        center: KNYSNA_CENTRE,
        zoom: 11,
        bounds: INITIAL_BOUNDS,
        fitBoundsOptions: { padding: 40 },
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

    map.resize();
    requestAnimationFrame(() => map.resize());
    const resizeTimer = setTimeout(() => map.resize(), 200);
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const target = BASEMAPS.find((b) => b.id === basemap)?.style;
    if (!target) return;
    map.setStyle(target);
  }, [basemap]);

  // Erf boundary vector layer. Sits behind the price pins (HTML markers
  // are always on top) but visually distinct from the basemap. Because
  // map.setStyle() drops all custom sources/layers, we re-install on the
  // 'styledata' event too.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function installErfLayer(m: mapboxgl.Map) {
      if (m.getSource("parcels")) return;
      // Absolute tile URL — Mapbox picks it up more reliably than a
      // path-only string, and CDN edge caching keys off the full origin.
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      m.addSource("parcels", {
        type: "vector",
        tiles: [`${origin}/api/tiles/parcels/{z}/{x}/{y}`],
        minzoom: 14,
        maxzoom: 22,
      });
      m.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 14,
        paint: {
          "fill-color": "#132B84",
          "fill-opacity": 0.12,
        },
        layout: { visibility: showErf ? "visible" : "none" },
      });
      m.addLayer({
        id: "parcels-line",
        type: "line",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 14,
        paint: {
          "line-color": "#132B84",
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1, 18, 3],
          "line-opacity": 0.95,
        },
        layout: { visibility: showErf ? "visible" : "none" },
      });
      m.addLayer({
        id: "parcels-labels",
        type: "symbol",
        source: "parcels",
        "source-layer": "parcels",
        minzoom: 17,
        layout: {
          "text-field": ["get", "tag_value"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 17, 11, 20, 14],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Regular"],
          "text-allow-overlap": false,
          visibility: showErf ? "visible" : "none",
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#132B84",
          "text-halo-width": 1.6,
        },
      });
    }

    // Local non-null alias so async / event closures below satisfy the
    // TypeScript narrowing without repeat null-checks.
    const mapRefLocal = map;

    if (mapRefLocal.isStyleLoaded()) installErfLayer(mapRefLocal);
    const onStyleData = () => installErfLayer(mapRefLocal);
    mapRefLocal.on("styledata", onStyleData);

    // Click any bare erf polygon (no OS / P24 overlay) → fetch its muni
    // data and show a compact popup at the click point. Guarded by
    // queryRenderedFeatures against the OS/P24 layer so clicks on a
    // matched pin still go through the existing preview panel path.
    let currentPopup: mapboxgl.Popup | null = null;
    async function parcelsClick(e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) {
      const overlaid = mapRefLocal.queryRenderedFeatures(e.point, {
        layers: [
          ...(mapRefLocal.getLayer("for-sale-fill") ? ["for-sale-fill"] : []),
          ...(mapRefLocal.getLayer("ungeocoded-dots") ? ["ungeocoded-dots"] : []),
        ] as string[],
      });
      if (overlaid.length > 0) return;
      const feat = e.features?.[0];
      const props = (feat?.properties ?? {}) as {
        prcl_key?: string;
        tag_value?: string;
        maj_region?: string;
      };
      const prclKey = props.prcl_key;
      const tagValue = props.tag_value;
      const majRegion = props.maj_region;
      if (!prclKey && !tagValue) return;
      currentPopup?.remove();
      currentPopup = new mapboxgl.Popup({ closeButton: true, maxWidth: "320px" })
        .setLngLat(e.lngLat)
        .setHTML(`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#6a7692;padding:4px 8px">loading muni data…</div>`)
        .addTo(mapRefLocal);
      try {
        // Primary match: erf number (tag_value) + town (maj_region) — works
        // for both ArcGIS and Full-GV-synthetic sg_numbers. Falls back to
        // digits-only match on the prcl_key path segment when unavailable.
        const qs = new URLSearchParams();
        if (tagValue) qs.set("erf", tagValue);
        if (majRegion) qs.set("town", majRegion);
        const seg = encodeURIComponent(prclKey ?? tagValue ?? "unknown");
        const path = qs.toString() ? `/api/muni/at-erf/${seg}?${qs}` : `/api/muni/at-erf/${seg}`;
        const res = await fetch(path);
        const j = await res.json();
        if (!res.ok || j.error) {
          currentPopup.setHTML(`<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#a24700;padding:8px">${j.error ?? "no muni data"}</div>`);
          return;
        }
        const fmtR = (n: number | null | undefined) => n == null ? "—" : n >= 1_000_000 ? `R ${(n/1_000_000).toFixed(2)}m` : `R ${Math.round(n).toLocaleString("en-ZA")}`;
        const html = `
<div style="font-family:'Inter',-apple-system,sans-serif;padding:2px 4px;min-width:240px">
  <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#C8A032;margin-bottom:4px">Muni erf ${j.erfNumber ?? "?"} · ${j.town ?? j.suburb ?? ""}</div>
  <div style="font-family:'Fraunces',serif;font-size:15px;color:#132B84;font-weight:500;margin-bottom:6px">${j.address ?? "(no address on file)"}</div>
  <div style="font-family:'JetBrains Mono',monospace;font-size:16px;color:#132B84;font-weight:600;margin-bottom:6px">${fmtR(j.muniValuationTotal)}${j.valuations.length > 1 ? ` <span style="font-size:9px;color:#C8A032">×${j.valuations.length}</span>` : ""}</div>
  <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#6a7692;line-height:1.6">
    ${j.extentSqm ? `${j.extentSqm} m² · ` : ""}${j.zoning ?? ""}${j.use ? ` · ${j.use}` : ""}<br/>
    ${j.owner ? `Owner: ${j.owner}<br/>` : ""}
    ${j.titleDeed ? `Deed: ${j.titleDeed}<br/>` : ""}
    ${j.purchDate ? `Last sale ${j.purchDate}${j.purchPrice ? ` · ${fmtR(j.purchPrice)}` : ""}` : ""}
  </div>
  <a href="/erf-lookup?q=${j.erfNumber ?? ""}${j.town ? `&suburb=${encodeURIComponent(j.town)}` : ""}" style="display:inline-block;margin-top:8px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#132B84;text-decoration:none;font-weight:600">Full detail →</a>
</div>`;
        currentPopup.setHTML(html);
      } catch (err) {
        currentPopup?.setHTML(`<div style="color:#a24700;padding:8px">${(err as Error).message}</div>`);
      }
    }
    mapRefLocal.on("click", "parcels-fill", parcelsClick);
    mapRefLocal.on("mouseenter", "parcels-fill", () => { mapRefLocal.getCanvas().style.cursor = "pointer"; });
    mapRefLocal.on("mouseleave", "parcels-fill", () => { mapRefLocal.getCanvas().style.cursor = ""; });

    return () => {
      mapRefLocal.off("styledata", onStyleData);
      mapRefLocal.off("click", "parcels-fill", parcelsClick);
      currentPopup?.remove();
    };
  }, [showErf]);

  // Toggle visibility without tearing the layers down — cheap and preserves
  // the browser's tile cache.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const vis = showErf ? "visible" : "none";
    for (const id of ["parcels-fill", "parcels-line", "parcels-labels"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
    }
  }, [showErf]);

  // Plan 005: for-sale cadastral polygon fill + ungeocoded-external dots.
  // Installed on 'styledata' (re-fires when basemap changes) and whenever
  // forSalePolygons or ungeocoded arrays change. Layers are torn down and
  // re-added on each update so colour assignments stay in sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const forSalePrclKeys = forSalePolygons.map((r) => r.prclKey);

    function installForSaleLayers(m: mapboxgl.Map) {
      // Parcels source must already be present (added by installErfLayer).
      // If the style hasn't loaded the parcel source yet, installErfLayer's
      // 'styledata' handler will fire again and re-install; we piggyback.
      if (!m.getSource("parcels")) return;

      // Tear down previous for-sale layers so we can re-add with fresh data.
      for (const id of ["for-sale-outline", "for-sale-fill"]) {
        if (m.getLayer(id)) m.removeLayer(id);
      }

      if (forSalePolygons.length > 0) {
        m.addLayer(
          {
            id: "for-sale-fill",
            type: "fill",
            source: "parcels",
            "source-layer": "parcels",
            minzoom: 14,
            filter: ["in", ["get", "prcl_key"], ["literal", forSalePrclKeys]],
            paint: {
              "fill-color": buildMatchExpr(forSalePolygons),
              "fill-opacity": 0.35,
            },
          },
          "parcels-line", // insert BEFORE outline so line renders above fill
        );

        m.addLayer({
          id: "for-sale-outline",
          type: "line",
          source: "parcels",
          "source-layer": "parcels",
          minzoom: 14,
          filter: ["in", ["get", "prcl_key"], ["literal", forSalePrclKeys]],
          paint: {
            "line-color": buildMatchExpr(forSalePolygons),
            "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1.5, 18, 3],
            "line-opacity": 1.0,
          },
        });
      }

      // Click + hover on the fill layer.
      if (m.getLayer("for-sale-fill")) {
        // Build a lookup map from prclKey → ForSalePolygon for click handler.
        const prclLookup = new Map<string, ForSalePolygon>(
          forSalePolygons.map((r) => [r.prclKey, r]),
        );
        m.on("click", "for-sale-fill", (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const pk = feature.properties?.prcl_key as string | undefined;
          if (!pk) return;
          const poly = prclLookup.get(pk);
          if (!poly) return;
          // Resolve to the merged pin key so the existing preview panel works.
          const matchedPin = poly.propertyId
            ? mergedPins.find((p) => p.matchedPropertyId === poly.propertyId || p.our?.id === poly.propertyId)
            : poly.listingId
            ? mergedPins.find((p) => p.externals.some((ex) => ex.id === poly.listingId))
            : null;
          if (matchedPin) setSelectedKey(matchedPin.key);
        });
        m.on("mouseenter", "for-sale-fill", () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", "for-sale-fill", () => {
          m.getCanvas().style.cursor = "";
        });
      }

      // Ungeocoded externals: GeoJSON circle layer.
      if (m.getSource("ungeocoded-externals")) {
        (m.getSource("ungeocoded-externals") as mapboxgl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: ungeocoded.map((u) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [u.lng, u.lat] },
            properties: { id: u.id, source: u.source, price: u.price, headline: u.headline },
          })),
        });
      } else {
        m.addSource("ungeocoded-externals", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: ungeocoded.map((u) => ({
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [u.lng, u.lat] },
              properties: { id: u.id, source: u.source, price: u.price, headline: u.headline },
            })),
          },
        });
        m.addLayer({
          id: "ungeocoded-dots",
          type: "circle",
          source: "ungeocoded-externals",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 6],
            "circle-color": "#8090B5",
            "circle-opacity": 0.5,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#132B84",
            "circle-stroke-opacity": 0.6,
          },
        });

        m.on("click", "ungeocoded-dots", (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const extId = feature.properties?.id as string | undefined;
          if (!extId) return;
          const matchedPin = mergedPins.find((p) =>
            p.externals.some((ex) => ex.id === extId),
          );
          if (matchedPin) setSelectedKey(matchedPin.key);
        });
        m.on("mouseenter", "ungeocoded-dots", () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", "ungeocoded-dots", () => {
          m.getCanvas().style.cursor = "";
        });
      }
    }

    // Install ONCE on style load (real style change, not every tile load).
    // Mapbox fires 'styledata' many times per second during tile fetches;
    // re-adding layers on each fire creates a teardown-during-render race
    // that manifests as `TypeError: undefined is not an object (evaluating
    // 'n.layout.get')` and stops the basemap from painting. `style.load`
    // fires only on actual basemap-style changes.
    //
    // When forSalePolygons / ungeocoded change (this effect's deps), we
    // re-run install synchronously here — no styledata subscription needed.
    if (map.isStyleLoaded()) {
      installForSaleLayers(map);
    } else {
      map.once("style.load", () => installForSaleLayers(map));
    }

    // Re-install on genuine basemap swap only.
    const onStyleLoad = () => installForSaleLayers(map);
    map.on("style.load", onStyleLoad);
    return () => {
      map.off("style.load", onStyleLoad);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forSalePolygons, ungeocoded]);

  // Split-duplicates mode: expand each merged pin into one pin per source.
  // The split rows sit at the same coord with a tiny angular offset so the
  // clicks don't overlap perfectly.
  type RenderPin = {
    id: string;                 // marker id (merged key, or key + source)
    lng: number;
    lat: number;
    mergedKey: string;          // for selection: always the merged pin's key
    propertyId: string | null;  // our property.id when this pin is us / merged with us
    geoManual: boolean;         // pin was hand-placed by an admin
    label: string;              // price string
    styleClass: string;         // CSS class for the price-pin
    sourcesShown: SourceKey[];  // which source stack to render
  };

  // Plan 005: strip out pins for properties / externals that have a prcl_key
  // and will render as cadastral polygons. Only properties with NO prcl_key on
  // both their OS record and all externals still need a pin.
  const pinnedPins = useMemo(
    () =>
      visiblePins.filter(
        (p) => !p.our?.prclKey && !p.externals.some((e) => !!e.prclKey),
      ),
    [visiblePins],
  );

  const renderPins: RenderPin[] = useMemo(() => {
    const out: RenderPin[] = [];
    for (const pin of pinnedPins) {
      const activeSources = pin.sources.filter((s) => enabledSources.has(s));
      if (activeSources.length === 0) continue;

      // Priority: any pin (singleton or merged) that includes dream_website
      // wears Dream navy — the dw class trumps mandate colouring on merged
      // pins so a listing that appears on dreamknysna.co.za reads as
      // "on Dream's site" at a glance regardless of mandate type.
      const hasDW = activeSources.includes("dream_website");

      if (!splitDupes || activeSources.length === 1) {
        const styleClass = hasDW
          ? "dw"
          : pin.our
            ? `mandate-${pin.our.mandateType}`
            : "market";
        out.push({
          id: pin.key,
          lng: pin.lng,
          lat: pin.lat,
          mergedKey: pin.key,
          propertyId: pin.matchedPropertyId ?? pin.our?.id ?? null,
          geoManual: pin.our?.geoManual === true,
          label: formatPrice(pin.representative.price),
          styleClass,
          sourcesShown: activeSources,
        });
        continue;
      }

      // Split mode — render one pin per active source, fanned around the coord.
      const n = activeSources.length;
      const radius = 0.00025;   // ~28 m at Knysna latitude
      activeSources.forEach((s, i) => {
        const angle = (i / n) * Math.PI * 2;
        const dLng = Math.cos(angle) * radius;
        const dLat = Math.sin(angle) * radius;
        let price: number | null = null;
        let styleClass = "market";
        if (s === "dream_website") {
          const ext = pin.externals.find((e) => e.source === "dream_website");
          price = ext?.price ?? null;
          styleClass = "dw";
        } else if (s === "dream_os" && pin.our) {
          price = pin.our.askingPrice;
          styleClass = `mandate-${pin.our.mandateType}`;
        } else {
          const ext = pin.externals.find((e) => e.source === s);
          price = ext?.price ?? null;
          styleClass = "market";
        }
        out.push({
          id: `${pin.key}::${s}`,
          lng: pin.lng + dLng,
          lat: pin.lat + dLat,
          mergedKey: pin.key,
          propertyId: pin.matchedPropertyId ?? pin.our?.id ?? null,
          geoManual: pin.our?.geoManual === true,
          label: formatPrice(price),
          styleClass,
          sourcesShown: [s],
        });
      });
    }
    return out;
  }, [pinnedPins, enabledSources, splitDupes]);

  // Sync markers to renderPins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const wantIds = new Set(renderPins.map((r) => r.id));
    for (const [id, marker] of Object.entries(markersRef.current)) {
      if (!wantIds.has(id)) {
        marker.remove();
        delete markersRef.current[id];
      }
    }

    for (const rp of renderPins) {
      // Keep the propertyId lookup fresh — the dragend handler needs it.
      if (rp.propertyId) pinPropertyIdRef.current[rp.mergedKey] = rp.propertyId;

      if (markersRef.current[rp.id]) {
        // Reposition existing marker (split-mode fan may have moved it).
        markersRef.current[rp.id].setLngLat([rp.lng, rp.lat]);
        // Adjusted-mark can flip if the row's geo_manual changes after a save.
        const el = markersRef.current[rp.id].getElement();
        if (rp.geoManual) el.classList.add("adjusted");
        else el.classList.remove("adjusted");
        continue;
      }

      const el = document.createElement("div");
      el.className = `price-pin ${rp.styleClass}${rp.label === "POR" ? " por" : ""}${rp.geoManual ? " adjusted" : ""}`;

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = rp.label;
      el.appendChild(badge);

      // Source stack (small letters) — only rendered when >1 source and not in split mode.
      if (rp.sourcesShown.length > 1) {
        const stack = document.createElement("span");
        stack.className = "source-stack";
        for (const s of rp.sourcesShown) {
          const dot = document.createElement("span");
          dot.className = `source-dot source-${s}`;
          dot.textContent = SOURCE_META[s].code;
          dot.title = SOURCE_META[s].label;
          stack.appendChild(dot);
        }
        el.appendChild(stack);
      }

      const pointer = document.createElement("span");
      pointer.className = "pointer";
      el.appendChild(pointer);

      el.addEventListener("click", () => {
        // Suppress the click that immediately follows a drag release — Mapbox
        // fires both events and we don't want the panel to re-select on drop.
        if (dragKeyRef.current === rp.mergedKey) return;
        setSelectedKey(rp.mergedKey);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([rp.lng, rp.lat])
        .addTo(map);

      // Registered once at marker creation, this handler reads the CURRENT
      // dragKey via the ref — so a marker created in "static" mode still
      // saves correctly when the admin later drags it.
      marker.on("dragend", () => {
        if (dragKeyRef.current !== rp.mergedKey) return;
        const propertyId = pinPropertyIdRef.current[rp.mergedKey];
        if (!propertyId) return;
        const ll = marker.getLngLat();
        handlePinDropRef.current(propertyId, ll.lng, ll.lat);
      });

      markersRef.current[rp.id] = marker;
    }

    // Initial framing is set by INITIAL_BOUNDS on map creation. The
    // pin-fit-to-bounds only fires as a fallback if the initial bounds
    // somehow ended up outside where any pins actually are (should
    // basically never happen for Knysna) — this keeps the "Buffalo Bay to
    // Noetzie" default framing stable across sessions instead of
    // re-fitting to whatever Dream's current stock happens to be.
    didInitialFitRef.current = true;
  }, [renderPins]);

  // Market-only pin clustering. At regional / suburb zoom levels the
  // hundreds of scraped Property24 + Private Property listings turn the
  // map into unreadable confetti. Dream's own OS pins (mandate-typed,
  // ~21 of them) stay individually visible at every zoom — they're the
  // ones Bronwyn navigates by. Everything else (market-only merged pins,
  // i.e. no `our` record) collapses into cluster circles until zoom ≥
  // MARKET_UNCLUSTER_ZOOM.
  //
  // Implementation:
  //   - A native mapboxgl GeoJSON source with cluster:true handles the
  //     visual clustering. cluster-circle + cluster-count layers on top.
  //   - The HTML markers for market pins still exist (they power price
  //     labels + click-to-select) but get display:none-d when the
  //     current zoom is below the uncluster threshold (see the zoom-
  //     visibility effect just below).
  //   - Click on a cluster circle expands it via Mapbox's built-in
  //     getClusterExpansionZoom.
  const MARKET_UNCLUSTER_ZOOM = 13;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Cluster pins that are strictly "other agencies' market listings":
    // no matched OS record AND no dream_website source. Dream's own
    // scraped-website pins are functionally our stock and stay visible
    // as individual markers at every zoom.
    const marketOnly = mergedPins.filter(
      (p) => !p.our && !p.sources.includes("dream_website"),
    );
    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: marketOnly.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: { key: p.key },
      })),
    };

    function install(m: mapboxgl.Map) {
      const existing = m.getSource("market-clusters") as mapboxgl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(geojson);
        return;
      }
      m.addSource("market-clusters", {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterMaxZoom: MARKET_UNCLUSTER_ZOOM,
        clusterRadius: 50,
      });
      m.addLayer({
        id: "market-cluster-circles",
        type: "circle",
        source: "market-clusters",
        filter: ["has", "point_count"],
        maxzoom: MARKET_UNCLUSTER_ZOOM + 1,
        paint: {
          "circle-color": "#132B84",
          "circle-radius": [
            "step",
            ["get", "point_count"],
            16,
            10, 22,
            50, 30,
          ],
          "circle-opacity": 0.9,
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(255,255,255,0.9)",
        },
      });
      m.addLayer({
        id: "market-cluster-count",
        type: "symbol",
        source: "market-clusters",
        filter: ["has", "point_count"],
        maxzoom: MARKET_UNCLUSTER_ZOOM + 1,
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 13,
          "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
        },
        paint: { "text-color": "#FFFFFF" },
      });
      m.on("click", "market-cluster-circles", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const clusterId = f.properties?.cluster_id as number | undefined;
        if (clusterId == null) return;
        const src = m.getSource("market-clusters") as mapboxgl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) return;
          const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          m.easeTo({ center: coords, zoom });
        });
      });
      m.on("mouseenter", "market-cluster-circles", () => {
        m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", "market-cluster-circles", () => {
        m.getCanvas().style.cursor = "";
      });
    }

    if (map.isStyleLoaded()) install(map);
    else map.once("style.load", () => install(map));

    const onStyleLoad = () => install(map);
    map.on("style.load", onStyleLoad);
    return () => {
      map.off("style.load", onStyleLoad);
    };
  }, [mergedPins]);

  // Hide the HTML markers for market-only pins when we're at cluster
  // zoom. Handled here rather than in the marker sync effect because
  // zoom changes shouldn't trigger the full marker teardown/rebuild.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyVisibility = () => {
      const z = map.getZoom();
      // Aligns with the cluster layer's `maxzoom: MARKET_UNCLUSTER_ZOOM + 1`
      // (Mapbox maxzoom is exclusive). Below the threshold the cluster
      // circle covers this pin; at or above, individual markers take over.
      const clustered = z < MARKET_UNCLUSTER_ZOOM + 1;
      for (const marker of Object.values(markersRef.current)) {
        const el = marker.getElement();
        if (!el.classList.contains("market")) continue;
        el.style.display = clustered ? "none" : "";
      }
    };

    applyVisibility();
    map.on("zoom", applyVisibility);
    return () => {
      map.off("zoom", applyVisibility);
    };
  }, [renderPins]);

  // Toggle draggability + drag-mode class as dragKey changes. Runs after any
  // marker sync so the class always reflects the latest state.
  //
  // Side effect: when drag mode ACTIVATES, zoom + centre the map on the pin.
  // Two reasons: (1) the pin might be barely visible at wide zoom levels, so
  // dragging it precisely is impossible; (2) auto-zooming makes it obvious
  // WHICH pin is now moveable, especially when multiple pins overlap.
  useEffect(() => {
    for (const [id, marker] of Object.entries(markersRef.current)) {
      const rp = renderPins.find((r) => r.id === id);
      if (!rp) continue;
      const shouldDrag = dragKey === rp.mergedKey;
      marker.setDraggable(shouldDrag);
      const el = marker.getElement();
      if (shouldDrag) el.classList.add("dragging");
      else el.classList.remove("dragging");
    }
    if (dragKey && mapRef.current) {
      const target = renderPins.find((r) => r.mergedKey === dragKey);
      if (target) {
        mapRef.current.easeTo({
          center: [target.lng, target.lat],
          zoom: Math.max(mapRef.current.getZoom(), 17),
          duration: 500,
        });
      }
    }
  }, [dragKey, renderPins]);

  // Active pin styling.
  useEffect(() => {
    for (const [id, marker] of Object.entries(markersRef.current)) {
      const el = marker.getElement();
      const rp = renderPins.find((r) => r.id === id);
      if (rp && rp.mergedKey === selectedKey) el.classList.add("active");
      else el.classList.remove("active");
    }
    if (selectedPin && mapRef.current) {
      mapRef.current.easeTo({
        center: [selectedPin.lng, selectedPin.lat],
        duration: 350,
      });
    }
  }, [selectedKey, renderPins, selectedPin]);

  function toggleMandate(m: string) {
    setEnabledMandates((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  function toggleSource(s: SourceKey) {
    setEnabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function runGeocode() {
    setGeocodeMsg(null);
    startTransition(async () => {
      try {
        const res = await geocodeMissingProperties();
        if (!res.ok) setGeocodeMsg(res.error ?? "geocode failed");
        else {
          const snapTotal =
            (res.erfSnapped ?? 0) + (res.propertiesSnapped ?? 0) + (res.listingsSnapped ?? 0);
          const snapPart = snapTotal > 0
            ? ` · snapped ${res.erfSnapped ?? 0} by erf + ${res.propertiesSnapped ?? 0} properties + ${res.listingsSnapped ?? 0} externals to cadastre`
            : "";
          setGeocodeMsg(
            `Geocoded ${res.geocoded ?? 0} · ${res.failed ?? 0} failed${snapPart}. Reload to see pins.`,
          );
        }
      } catch (e) {
        setGeocodeMsg(`Geocode threw: ${(e as Error).message}`);
      }
    });
  }

  return (
    <div className="map-shell">
      <aside className={`map-rail${mobileRailOpen ? " mobile-open" : ""}`}>
        {/* Mobile-only bottom-sheet handle. Hidden on desktop via CSS. */}
        <button
          type="button"
          className="map-rail-handle"
          aria-expanded={mobileRailOpen}
          aria-label={mobileRailOpen ? "Close controls" : "Open controls"}
          onClick={() => setMobileRailOpen((v) => !v)}
        >
          <span className="map-rail-handle-grip" aria-hidden />
          <span className="map-rail-handle-text">
            {mobileRailOpen ? "Close" : "Filters & listings"}
          </span>
        </button>
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

        {/* SpendMeter hidden 2026-07-22 — orphaned by the Lightstone API pivot.
            Will return as "External data spend" once WinDeed / CIPC costs land. */}

        <section>
          <h3>Sources</h3>
          <div className="source-chips">
            {SOURCE_ORDER.map((s) => {
              const on = enabledSources.has(s);
              // For external sources, prefer the raw DB count from the
              // server — "how many rows are we tracking" is the number
              // Bronwyn will trust against a portal spot-check. The
              // merged-pin count collapses many-externals-per-property
              // to one and undercounts (Simon spotted 186 vs 342 for
              // P24 on 2026-07-31). dream_os stays on merged-pin count
              // because it's a count of our own records, not externals.
              const count =
                s === "dream_os"
                  ? sourceCounts.get(s) ?? 0
                  : externalCounts?.[s as "dream_website" | "property24" | "private_property"] ??
                    sourceCounts.get(s) ??
                    0;
              return (
                <button
                  key={s}
                  className={`source-chip source-${s} ${on ? "on" : ""}`}
                  onClick={() => toggleSource(s)}
                  type="button"
                  title={SOURCE_META[s].label}
                >
                  <span className="code">{SOURCE_META[s].code}</span>
                  <span>{SOURCE_META[s].label}</span>
                  <span style={{ color: "#8090b5", marginLeft: 2 }}>{count}</span>
                </button>
              );
            })}
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              fontSize: 12,
              color: "var(--estuary)",
              cursor: "pointer",
              fontWeight: 500,
              margin: 0,
              paddingTop: 8,
            }}
          >
            <input
              type="checkbox"
              checked={splitDupes}
              onChange={(e) => setSplitDupes(e.target.checked)}
            />
            Split duplicate pins by source
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 6,
              fontSize: 12,
              color: "var(--estuary)",
              cursor: "pointer",
              fontWeight: 500,
              margin: 0,
              paddingTop: 4,
            }}
          >
            <input
              type="checkbox"
              checked={showErf}
              onChange={(e) => setShowErf(e.target.checked)}
            />
            Erf boundaries
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 10,
                color: "#8090b5",
                letterSpacing: "0.04em",
              }}
            >
              z ≥ 14
            </span>
          </label>

          {isAdmin && <RefreshDreamButton />}
          {isAdmin && <RefreshMuniButton />}
          {isAdmin && <RefreshProperty24Button />}
          {isAdmin && <DrainQueueButton />}
          {isAdmin && <RegeocodeProperty24Button />}
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
          <h3 style={{ padding: "0 16px" }}>Our listings ({visibleProperties.length})</h3>
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
              className={`listing-item mandate-${p.mandateType} ${selectedKey === `prop-${p.id}` ? "active" : ""}`}
              onClick={() => setSelectedKey(`prop-${p.id}`)}
              style={{ background: selectedKey === `prop-${p.id}` ? "#EEF0F8" : undefined, border: 0, textAlign: "left", width: "100%" }}
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

        {isAdmin && (
          <div className="geocode-bar">
            <span>
              <b>{stats.geocoded}</b> / {stats.total} pinned
              {stats.missing > 0 ? ` · ${stats.missing} missing coords` : ""}
            </span>
            <button type="button" onClick={runGeocode} disabled={pending}>
              {pending
                ? "Working…"
                : stats.missing > 0
                ? "Geocode + snap"
                : "Snap to cadastre"}
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

        {renderPins.length > 0 && (
          <div className="map-legend">
            {/* Plan 005: cadastral polygon legend — 6 fill states + 1 dot entry */}
            <div className="row" style={{ "--m-fill": STATE_COLORS.os_exclusive } as React.CSSProperties}>
              <span className="sw" style={{ background: STATE_COLORS.os_exclusive, borderRadius: 3 }} />
              <span>Exclusive</span>
            </div>
            <div className="row" style={{ "--m-fill": STATE_COLORS.os_joint } as React.CSSProperties}>
              <span className="sw" style={{ background: STATE_COLORS.os_joint, borderRadius: 3 }} />
              <span>Joint</span>
            </div>
            <div className="row" style={{ "--m-fill": STATE_COLORS.os_sold } as React.CSSProperties}>
              <span className="sw" style={{ background: STATE_COLORS.os_sold, borderRadius: 3 }} />
              <span>Sold</span>
            </div>
            <div className="row" style={{ "--m-fill": STATE_COLORS.os_under_offer } as React.CSSProperties}>
              <span className="sw" style={{ background: STATE_COLORS.os_under_offer, borderRadius: 3 }} />
              <span>Under Offer</span>
            </div>
            <div className="row" style={{ "--m-fill": STATE_COLORS.os_other } as React.CSSProperties}>
              <span className="sw" style={{ background: STATE_COLORS.os_other, borderRadius: 3 }} />
              <span>Sole / Open / None</span>
            </div>
            <div className="row" style={{ "--m-fill": STATE_COLORS.market } as React.CSSProperties}>
              <span className="sw" style={{ background: STATE_COLORS.market, borderRadius: 3 }} />
              <span>Market (P24 / PP)</span>
            </div>
            <div className="row">
              <span className="sw" style={{
                background: "#8090B5",
                borderRadius: "50%",
                opacity: 0.5,
                border: "1px solid #132B84",
                width: 10,
                height: 10,
              }} />
              <span>Market — location only</span>
            </div>
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
        {mapboxToken && stats.total === 0 && mergedPins.length === 0 && (
          <div className="map-empty">
            <div className="map-empty-card">
              <h2>No properties or market listings yet</h2>
              <p>
                Commit a batch from Triage, or wait for tonight's scraper run to
                surface market listings.
              </p>
              <Link href="/triage" className="cta" style={{ display: "inline-block" }}>
                Open Triage →
              </Link>
            </div>
          </div>
        )}
        {stats.total > 0 && renderPins.length === 0 && stats.missing === stats.total && (
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

        <aside className={`map-preview ${selectedPin ? "on" : ""}`}>
          {selectedPin && (
            <PreviewPanel
              pin={selectedPin}
              onClose={() => setSelectedKey(null)}
              isAdmin={isAdmin}
              inDragMode={dragKey === selectedPin.key}
              onStartDrag={() => {
                setPinMsg(null);
                setPinErr(null);
                setDragKey(selectedPin.key);
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
  );
}

// -----------------------------------------------------------------------------
// Spend meter — admins only. Tints amber at ≥80% of budget, red at ≥100%.
// Reads a server-computed snapshot so we don't do a client-side count query.
// -----------------------------------------------------------------------------

function SpendMeter({ budget }: { budget: BudgetSummary }) {
  const pct = budget.pctUsed;
  const state: "ok" | "warn" | "hit" =
    pct >= 100 ? "hit" : pct >= 80 ? "warn" : "ok";

  const palette = {
    ok:   { fg: "var(--estuary)", bar: "var(--navy)",  bg: "#fbfcfe", ring: "#d7deef" },
    warn: { fg: "#7A5814",        bar: "#C8A032",       bg: "rgba(200,160,50,0.06)", ring: "rgba(200,160,50,0.4)" },
    hit:  { fg: "#8b1a1a",        bar: "#8b1a1a",       bg: "#fdecec", ring: "#f3c2c2" },
  }[state];

  const label =
    state === "hit"  ? "Budget reached · pulls paused" :
    state === "warn" ? `At ${pct}% of monthly budget` :
                        `${pct}% of monthly budget`;

  return (
    <section>
      <h3>Lightstone spend</h3>
      <div
        style={{
          padding: 12,
          margin: "0 16px",
          borderRadius: 10,
          border: `1px solid ${palette.ring}`,
          background: palette.bg,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            color: palette.fg,
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {budget.used}
          </span>
          <span style={{ fontSize: 12, color: "#7a86a8" }}>
            / {budget.budget} calls
          </span>
        </div>
        <div
          style={{
            marginTop: 8,
            height: 4,
            width: "100%",
            background: "#eef1f8",
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min(100, pct)}%`,
              height: "100%",
              background: palette.bar,
              transition: "width 0.25s",
            }}
          />
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: palette.fg,
            fontWeight: 500,
          }}
        >
          {label}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 10,
            color: "#7a86a8",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            letterSpacing: "0.04em",
          }}
        >
          {budget.monthKey} · warn at {budget.softWarnPct}%
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Preview panel — shape depends on whether the pin is ours, market-only, or
// merged across sources.
// -----------------------------------------------------------------------------

function PreviewPanel({
  pin,
  onClose,
  isAdmin,
  inDragMode,
  onStartDrag,
  onCancelDrag,
  pinPending,
  pinMsg,
  pinErr,
}: {
  pin: MergedPin;
  onClose: () => void;
  isAdmin: boolean;
  inDragMode: boolean;
  onStartDrag: () => void;
  onCancelDrag: () => void;
  pinPending: boolean;
  pinMsg: string | null;
  pinErr: string | null;
}) {
  const our = pin.our;
  const externals = pin.externals;
  const hasMultipleSources = pin.sources.length > 1;

  // Adjust-pin control is only meaningful when the pin is a property we own
  // and the viewer is a Director. Market-only listings have no property to
  // move; agents shouldn't reshape the map.
  const canAdjust = isAdmin && !!our && !!pin.matchedPropertyId;

  // Compare prices across sources; if the range spans more than 5% we flag it.
  const priceQuotes: { source: SourceKey; price: number | null; url: string | null }[] = [];
  if (our) priceQuotes.push({ source: "dream_os", price: our.askingPrice, url: null });
  for (const e of externals) priceQuotes.push({ source: e.source, price: e.price, url: e.url });

  const withPrice = priceQuotes.filter((q) => q.price != null) as { source: SourceKey; price: number; url: string | null }[];
  let priceMismatch = false;
  if (withPrice.length > 1) {
    const min = Math.min(...withPrice.map((q) => q.price));
    const max = Math.max(...withPrice.map((q) => q.price));
    if (max > 0 && (max - min) / max > 0.05) priceMismatch = true;
  }

  return (
    <>
      <div className="head">
        <button
          type="button"
          className="close"
          onClick={onClose}
          aria-label="Close preview"
        >
          ×
        </button>
        <div className={`mandate-line mandate-${pin.representative.mandateType}`}>
          <span className="m-chip">
            {our ? (our.mandateRaw ?? "No mandate") : "Market listing"}
          </span>
          {our?.listingStatus && (
            <span
              className="m-chip"
              style={{ background: "var(--mist)", color: "var(--estuary)" }}
            >
              {our.listingStatus}
            </span>
          )}
        </div>
        <h2 className="addr">{pin.representative.address}</h2>
        {pin.representative.suburb && (
          <p className="suburb">{pin.representative.suburb}</p>
        )}
        {hasMultipleSources && (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {pin.sources.map((s) => (
              <span
                key={s}
                className={`source-dot source-${s}`}
                title={SOURCE_META[s].label}
                style={{ position: "static" }}
              >
                {SOURCE_META[s].code}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="body">
        {/* Our-property block */}
        {our ? (
          <>
            <p className="price">{formatFullPrice(our.askingPrice)}</p>
            <p className="price-sub">Our asking price</p>

            <div className="pv-grid">
              <div className="pv-cell">
                <div className="lbl">Extent</div>
                <div className="val">
                  {our.extentSqm ? `${our.extentSqm} m²` : "—"}
                </div>
              </div>
              <div className="pv-cell">
                <div className="lbl">Title deed</div>
                <div className="val mono" style={{ fontSize: 12 }}>
                  {our.titleDeed ?? "—"}
                </div>
              </div>
              <div className="pv-cell">
                <div className="lbl">Transfers</div>
                <div className="val">{our.transferCount}</div>
              </div>
              <div className="pv-cell">
                <div className="lbl">Latest transfer</div>
                <div className="val" style={{ fontSize: 12 }}>
                  {our.transferStatus ? our.transferStatus.replace(/_/g, " ") : "—"}
                </div>
              </div>
            </div>

            {our.listingHeadline && (
              <p style={{ marginTop: 20, fontFamily: "Inter, -apple-system, sans-serif", color: "var(--estuary)", fontSize: 14, lineHeight: 1.5 }}>
                {our.listingHeadline}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="price">{formatFullPrice(pin.representative.price)}</p>
            <p className="price-sub">Market listing</p>
            {externals[0]?.headline && (
              <p style={{ marginTop: 12, fontFamily: "Inter, -apple-system, sans-serif", color: "var(--estuary)", fontSize: 14, lineHeight: 1.5 }}>
                {externals[0].headline}
              </p>
            )}
          </>
        )}

        {/* Per-source table when merged */}
        {(hasMultipleSources || externals.length > 0) && (
          <div style={{ marginTop: 24 }}>
            <p
              style={{
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--gold)",
                margin: "0 0 8px",
              }}
            >
              Also listed on
            </p>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {externals.map((e) => (
                <li
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #e2e8f5",
                    background: "#fbfcfe",
                  }}
                >
                  <span
                    className={`source-dot source-${e.source}`}
                    style={{ position: "static", flexShrink: 0 }}
                  >
                    {SOURCE_META[e.source as SourceKey].code}
                  </span>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      fontSize: 12,
                      color: priceMismatch ? "#a24700" : "var(--estuary)",
                      fontWeight: 600,
                      minWidth: 80,
                    }}
                  >
                    {formatFullPrice(e.price)}
                  </span>
                  <span style={{ fontSize: 11, color: "#7a86a8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.agencyName ?? SOURCE_META[e.source as SourceKey].label}
                  </span>
                  {e.url && (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 12,
                        color: "var(--navy)",
                        textDecoration: "none",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Open ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {priceMismatch && (
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 11,
                  color: "#a24700",
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Prices differ across sources
              </p>
            )}
          </div>
        )}

        {canAdjust && (
          <div
            style={{
              marginTop: 24,
              padding: 14,
              borderRadius: 10,
              background: inDragMode ? "rgba(200,160,50,0.10)" : "#fbfcfe",
              border: `1px solid ${inDragMode ? "rgba(200,160,50,0.45)" : "#e2e8f5"}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <p
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--gold)",
                  margin: 0,
                }}
              >
                Pin location
              </p>
              {our?.geoManual && !inDragMode && (
                <span
                  title="An admin has hand-placed this pin. Automated geocoders skip it."
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 10,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    background: "rgba(200,160,50,0.14)",
                    border: "1px solid rgba(200,160,50,0.45)",
                    color: "#7A5814",
                  }}
                >
                  Pin adjusted
                </span>
              )}
            </div>

            {inDragMode ? (
              <>
                <p
                  style={{
                    margin: "10px 0 4px",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--estuary)",
                    lineHeight: 1.35,
                  }}
                >
                  Grab the pulsing pin on the map and drag it to the correct
                  spot.
                </p>
                <p
                  style={{
                    margin: "0 0 12px",
                    fontSize: 12,
                    color: "#7a86a8",
                    lineHeight: 1.4,
                  }}
                >
                  It saves automatically when you release. The map is centred
                  on the pin.
                </p>
                <button
                  type="button"
                  className="ghost-dark"
                  onClick={onCancelDrag}
                  disabled={pinPending}
                  style={{ padding: "10px 16px", fontSize: 13, minHeight: 40 }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <p
                  style={{
                    margin: "8px 0 10px",
                    fontSize: 12,
                    color: "#5b6885",
                    lineHeight: 1.4,
                  }}
                >
                  {our?.geoManual
                    ? "Move this pin again if the placement drifted."
                    : "Drop the pin exactly on the property."}
                </p>
                <button
                  type="button"
                  className="cta"
                  onClick={onStartDrag}
                  disabled={pinPending}
                  style={{
                    padding: "11px 18px",
                    fontSize: 14,
                    minHeight: 44,
                    width: "100%",
                    justifyContent: "center",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  {our?.geoManual ? "Move pin again" : "Move pin"}
                </button>
              </>
            )}
            {pinPending && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#7a86a8" }}>
                Saving…
              </p>
            )}
            {pinMsg && (
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 12,
                  color: "var(--estuary)",
                  fontWeight: 600,
                }}
              >
                {pinMsg}
              </p>
            )}
            {pinErr && (
              <p className="error" style={{ margin: "8px 0 0", fontSize: 12 }}>
                {pinErr}
              </p>
            )}
          </div>
        )}

        {pin.matchedPropertyId ? (
          <Link href={`/properties/${pin.matchedPropertyId}`} className="pv-cta">
            Open property record →
          </Link>
        ) : (
          pin.externals.length > 0 &&
          isAdmin && (
            <MarketListingAttach externalIds={pin.externals.map((e) => e.id)} />
          )
        )}

        {/* Admin: re-geocode the pin when it's visibly in the wrong place.
            Works on any market pin (matched or not) since a wrong coord is
            a wrong coord regardless of whether it's been attached to an
            OS property. Runs on the first external in the group; dedup
            groups share a physical address so one is enough. */}
        {isAdmin && pin.externals.length > 0 && (
          <RegeocodeListingButton externalId={pin.externals[0].id} />
        )}
      </div>
    </>
  );
}
