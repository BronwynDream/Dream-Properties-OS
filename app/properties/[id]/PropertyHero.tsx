"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";

// PropertyHero — the visual anchor at the top of a Property Record.
//
// Design thesis: a Dream property record should open with the SHAPE of the
// ground. Every property in Dream's world is a specific polygon on the CSG
// cadastre. That polygon is the property's legal identity — deeds change,
// owners change, prices change; the erf shape is permanent. Rendering it in
// Dream gold on a satellite basemap is the one thing no generic real-estate
// CRM does, and it's directly enabled by the cadastre marathon we shipped
// two weeks ago (75,745 parcels imported for Knysna + George).
//
// The map is not interactive — it's an anchor, not a navigation surface.
// Panning / zooming happens on /map. Here the polygon is a fixed still-frame.

type Photo = { id: string; url: string | null; title: string };

export type SinceLine = {
  surname: string;
  year: string | null;
  price: string | null;
} | null;

export default function PropertyHero({
  lat,
  lng,
  prclKey,
  erven,
  titleDeed,
  extentSqm,
  suburb,
  type,
  ownership,
  since,
  photos,
  mapboxToken,
}: {
  lat: number | null;
  lng: number | null;
  prclKey: string | null;
  erven: string;
  titleDeed: string | null;
  extentSqm: number | null;
  suburb: string | null;
  type: string | null;
  ownership: string | null;
  since: SinceLine;
  photos: Photo[];
  mapboxToken: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const token = (mapboxToken ?? "").trim();
    if (!token || lat == null || lng == null) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [lng, lat],
      zoom: 17.5,
      attributionControl: false,
      // Fixed anchor — no pan / zoom / rotate. Agents go to /map for that.
      interactive: false,
      cooperativeGestures: false,
    });
    mapRef.current = map;

    const install = () => {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      if (!map.getSource("parcels-hero")) {
        map.addSource("parcels-hero", {
          type: "vector",
          tiles: [`${origin}/api/tiles/parcels/{z}/{x}/{y}`],
          minzoom: 14,
          maxzoom: 22,
        });
      }

      // Neighbours — silent navy hairline for spatial context. Rendered when
      // we have a prcl_key (so we can exclude the subject) OR when we don't
      // (draws the whole neighbourhood, still useful).
      if (!map.getLayer("hero-neighbours-line")) {
        map.addLayer({
          id: "hero-neighbours-line",
          type: "line",
          source: "parcels-hero",
          "source-layer": "parcels",
          filter: prclKey
            ? ["!=", ["get", "prcl_key"], prclKey]
            : ["all"],
          paint: {
            "line-color": "#132B84",
            "line-width": 1,
            "line-opacity": 0.55,
          },
        });
      }

      // Subject erf — gold outline + lagoon fill. Only rendered when the
      // property has been bridged to a specific parcel.
      if (prclKey) {
        if (!map.getLayer("hero-subject-fill")) {
          map.addLayer({
            id: "hero-subject-fill",
            type: "fill",
            source: "parcels-hero",
            "source-layer": "parcels",
            filter: ["==", ["get", "prcl_key"], prclKey],
            paint: {
              "fill-color": "#0d3a52",
              "fill-opacity": 0.22,
            },
          });
        }
        if (!map.getLayer("hero-subject-line")) {
          map.addLayer({
            id: "hero-subject-line",
            type: "line",
            source: "parcels-hero",
            "source-layer": "parcels",
            filter: ["==", ["get", "prcl_key"], prclKey],
            paint: {
              "line-color": "#C8A032",
              "line-width": 3,
            },
          });
        }
      }
    };

    // Basemap styles can arrive after the map load event. Install once on
    // first style load, then re-install if the style ever swaps (defensive —
    // we don't swap here, but the pattern matches MapView).
    map.on("style.load", install);
    map.once("load", install);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasMap = (mapboxToken ?? "").trim() && lat != null && lng != null;

  return (
    <div className="property-hero">
      <div className="property-hero-left">
        {hasMap ? (
          <div className="property-hero-map">
            <div ref={containerRef} className="property-hero-map-canvas" />
            <span className="property-hero-coords">
              {lat!.toFixed(4)}, {lng!.toFixed(4)}
            </span>
          </div>
        ) : (
          <div className="property-hero-mapless">
            <p>
              No coordinates on file yet.
              <br />
              Trigger a geocode from <b>/map → Refresh Dream listings</b>, or drop a Lightstone report to bring in a lat / lng.
            </p>
          </div>
        )}

        {photos.length > 0 && (
          <div className="property-hero-photos">
            {photos.slice(0, 6).map((p) =>
              p.url ? (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="property-hero-photo"
                  title={p.title}
                >
                  <img src={p.url} alt={p.title} loading="lazy" />
                </a>
              ) : null,
            )}
            {photos.length > 6 && (
              <span className="property-hero-photo-more">+{photos.length - 6}</span>
            )}
          </div>
        )}
      </div>

      <aside className="property-hero-stats">
        <div className="property-hero-stat">
          <p className="property-hero-eyebrow">Erf</p>
          <p className="property-hero-value mono">{erven || "—"}</p>
        </div>
        <div className="property-hero-stat">
          <p className="property-hero-eyebrow">Title deed</p>
          <p className="property-hero-value mono">{titleDeed ?? "—"}</p>
        </div>
        <div className="property-hero-stat">
          <p className="property-hero-eyebrow">Extent</p>
          <p className="property-hero-value">
            {extentSqm ? (
              <>
                {extentSqm} <span className="property-hero-unit">m²</span>
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
        <div className="property-hero-stat">
          <p className="property-hero-eyebrow">Suburb · Type</p>
          <p className="property-hero-value">
            {suburb ?? "—"}
            {type ? ` · ${type}` : ""}
          </p>
        </div>
        <div className="property-hero-stat">
          <p className="property-hero-eyebrow">Ownership</p>
          <p className="property-hero-value">{ownership ?? "—"}</p>
        </div>

        {since && (
          <div className="property-hero-since">
            <p className="property-hero-eyebrow">Since</p>
            <p className="property-hero-since-value">
              <b>{since.surname}</b>
              {since.year && (
                <>
                  {" "}
                  · <span className="mono">{since.year}</span>
                </>
              )}
            </p>
            {since.price && (
              <p className="property-hero-since-price mono">{since.price}</p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
