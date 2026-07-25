"use client";

import { useEffect, useRef, type ReactNode } from "react";
import mapboxgl from "mapbox-gl";

// PropertyHero — the Property Record's identity plate.
//
// Design thesis: this page is not a SaaS card, it's a cadastral document.
// The reference block on a real SA title deed opens with Erf + Deed + SG —
// that block IS the property's legal identity, more permanent than address
// or owner. Rendering it faithfully (JetBrains Mono, gold-bordered stamp,
// hairline internal rule) is the one visual move no generic CRM makes,
// because none understand that ERF + SG + deed is the identity primitive.
//
// The Muni valuation is the mid-page headline number — it's what Bronwyn
// actually reaches for in every pricing conversation. Below the identity
// row: cadastre polygon (satellite) + a proper schedule table with all
// the vitals. When the polygon can't be bridged, the cadastre panel
// degrades to a stylised SG-diagram placeholder — never a black rectangle.

type Photo = { id: string; url: string | null; title: string };

export type SinceLine = {
  surname: string;
  year: string | null;
  price: string | null;
} | null;

export type ScheduleRow = {
  key: string;
  label: string;
  value: string | null;
  mono?: boolean;
  breakBefore?: boolean;
};

export default function PropertyHero({
  lat,
  lng,
  prclKey,
  primaryErf,
  extraErvenCount,
  titleDeed,
  sgNumber,
  muniValuation,
  muniValuationSubtitle,
  since,
  scheduleRows,
  photos,
  mapboxToken,
  actionsSlot,
}: {
  lat: number | null;
  lng: number | null;
  prclKey: string | null;
  primaryErf: string | null;
  extraErvenCount: number;
  titleDeed: string | null;
  sgNumber: string | null;
  muniValuation: number | null;
  muniValuationSubtitle: string | null;
  since: SinceLine;
  scheduleRows: ScheduleRow[];
  photos: Photo[];
  mapboxToken: string;
  actionsSlot?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const hasCoords = (mapboxToken ?? "").trim() && lat != null && lng != null;
  const hasPolygon = hasCoords && !!prclKey;

  useEffect(() => {
    if (!hasCoords) return;
    if (!containerRef.current || mapRef.current) return;
    const token = (mapboxToken ?? "").trim();

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [lng!, lat!],
      zoom: 17.5,
      attributionControl: false,
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
      if (prclKey) {
        if (!map.getLayer("hero-subject-fill")) {
          map.addLayer({
            id: "hero-subject-fill",
            type: "fill",
            source: "parcels-hero",
            "source-layer": "parcels",
            filter: ["==", ["get", "prcl_key"], prclKey],
            paint: {
              "fill-color": "#C8A032",
              "fill-opacity": 0.28,
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

    map.on("style.load", install);
    map.once("load", install);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="record-plate">
      {/* Identity row: Registry Stamp | Headline + Since + Actions */}
      <div className="record-identity">
        <RegistryStamp
          primaryErf={primaryErf}
          extraErvenCount={extraErvenCount}
          titleDeed={titleDeed}
          sgNumber={sgNumber}
        />

        <div className="record-headline">
          <div>
            <p className="record-headline-eyebrow">Muni valuation</p>
            {muniValuation != null ? (
              <>
                <p className="record-headline-value">
                  R {Number(muniValuation).toLocaleString("en-ZA")}
                </p>
                {muniValuationSubtitle && (
                  <p className="record-headline-sub">{muniValuationSubtitle}</p>
                )}
              </>
            ) : (
              <p className="record-headline-empty">
                No muni valuation on record. Try Find ERF from Muni to link a
                valuation-roll entry.
              </p>
            )}

            {since && (
              <div className="record-since">
                <p className="record-since-eyebrow">Registered ownership</p>
                <p className="record-since-value" style={{ margin: 0 }}>
                  Since <b>{since.surname}</b>
                  {since.year && <> · <span className="mono">{since.year}</span></>}
                  {since.price && <> · {since.price}</>}
                </p>
              </div>
            )}
          </div>

          {actionsSlot && <div className="record-actions">{actionsSlot}</div>}
        </div>
      </div>

      {/* Cadastre panel + Schedule */}
      <div className="record-cadastre-row">
        <div className="cadastre-panel">
          {hasPolygon ? (
            <>
              <div ref={containerRef} className="cadastre-panel-canvas" />
              <span className="cadastre-coords">
                {lat!.toFixed(4)}, {lng!.toFixed(4)}
              </span>
            </>
          ) : hasCoords ? (
            // Have coords but no polygon bridge — show the satellite so the
            // record still has visual anchor, with a hint that the polygon
            // isn't linked yet.
            <>
              <div ref={containerRef} className="cadastre-panel-canvas" />
              <span className="cadastre-coords">
                {lat!.toFixed(4)}, {lng!.toFixed(4)} · unlinked
              </span>
            </>
          ) : (
            <div className="cadastre-fallback">
              <CompassRose />
              <p className="cadastre-fallback-title">Cadastral diagram</p>
              <p className="cadastre-fallback-body">
                Not yet linked to a CSG parcel. Use <b>Find ERF from Muni</b>{" "}
                to attach an ERF; the polygon will render here on refresh.
              </p>
              {lat != null && lng != null && (
                <p className="cadastre-fallback-coords">
                  {lat.toFixed(4)}, {lng.toFixed(4)}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="schedule">
          <table>
            <tbody>
              {scheduleRows.map((row) => (
                <tr key={row.key} className={row.breakBefore ? "schedule-break" : ""}>
                  <td className="k">{row.label}</td>
                  <td className={`v ${row.mono ? "mono" : ""} ${row.value ? "" : "dim"}`}>
                    {row.value ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Photos strip — absent entirely when there are no photos */}
      {photos.length > 0 && (
        <div className="record-photos">
          <p className="record-photos-label">Photos · {photos.length}</p>
          <div className="record-photos-strip">
            {photos.slice(0, 8).map((p) =>
              p.url ? (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="record-photo"
                  title={p.title}
                >
                  <img src={p.url} alt={p.title} loading="lazy" />
                </a>
              ) : null,
            )}
            {photos.length > 8 && (
              <span className="record-photo-more">+{photos.length - 8}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// The Registry Stamp — bordered identity block, real title-deed reference
// pattern. Erf number set large in mono; deed + SG below the hairline.
function RegistryStamp({
  primaryErf,
  extraErvenCount,
  titleDeed,
  sgNumber,
}: {
  primaryErf: string | null;
  extraErvenCount: number;
  titleDeed: string | null;
  sgNumber: string | null;
}) {
  return (
    <div className="registry-stamp">
      <p className="registry-stamp-eyebrow">Knysna Deeds Office</p>

      <p className="registry-stamp-label">Erf</p>
      {primaryErf ? (
        <>
          <p className="registry-stamp-erf">{primaryErf}</p>
          {extraErvenCount > 0 && (
            <p className="registry-stamp-erf-more">
              + {extraErvenCount} more {extraErvenCount === 1 ? "erf" : "erven"}
            </p>
          )}
        </>
      ) : (
        <p className="registry-stamp-empty">Not yet linked to an ERF.</p>
      )}

      <hr className="registry-stamp-rule" />

      {titleDeed ? (
        <p className="registry-stamp-deed">{titleDeed}</p>
      ) : (
        <p className="registry-stamp-empty">Title deed not on file</p>
      )}
      {sgNumber && <p className="registry-stamp-sg">SG {sgNumber}</p>}
    </div>
  );
}

// Compass rose for the cadastre-fallback state. Small, gold, CSG-diagram
// aesthetic. Replaces the dead black rectangle the map used to leave when
// the parcel polygon couldn't be bridged.
function CompassRose() {
  return (
    <svg
      className="cadastre-fallback-compass"
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <circle cx="28" cy="28" r="15" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <path d="M28 6 L32 28 L28 24 L24 28 Z" fill="currentColor" />
      <path d="M28 50 L24 28 L28 32 L32 28 Z" fill="currentColor" opacity="0.55" />
      <path d="M6 28 L28 24 L24 28 L28 32 Z" fill="currentColor" opacity="0.45" />
      <path d="M50 28 L28 32 L32 28 L28 24 Z" fill="currentColor" opacity="0.45" />
      <text
        x="28" y="10"
        textAnchor="middle"
        fill="currentColor"
        fontSize="6"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
      >
        N
      </text>
    </svg>
  );
}
