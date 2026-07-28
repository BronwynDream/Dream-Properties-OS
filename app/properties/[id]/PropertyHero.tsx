"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import mapboxgl from "mapbox-gl";
import RegisteredStamp from "./RegisteredStamp";
import { Rand } from "@/app/components/format";

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

export type StampProps = {
  variant: "registered" | "mandate_held" | "in_conveyancing" | "preparing" | "sold_externally";
  date: string;
  secondary?: string;
} | null;

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
  mapHref = "/map",
  stamp = null,
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
  mapHref?: string;
  stamp?: StampProps;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const hasCoords = (mapboxToken ?? "").trim() && lat != null && lng != null;
  const hasPolygon = hasCoords && !!prclKey;

  // Photo takes visual priority — for an estate agency, a photo of the house
  // is the primary artefact. The map is a pivot, not the hero. First photo
  // with a URL becomes the hero image; the rest flow through the strip below.
  const primaryPhoto = photos.find((p) => !!p.url) ?? null;
  const remainingPhotos = primaryPhoto
    ? photos.filter((p) => p.id !== primaryPhoto.id)
    : photos;
  const showMap = !primaryPhoto && hasPolygon;

  useEffect(() => {
    if (!showMap) return;
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
      {stamp && (
        <RegisteredStamp
          variant={stamp.variant}
          date={stamp.date}
          secondary={stamp.secondary}
        />
      )}
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
                  <Rand value={muniValuation} mutedPrefix={false} />
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

      {/* Hero visual + Schedule */}
      <div className="record-cadastre-row">
        <div className="cadastre-panel">
          {primaryPhoto ? (
            // Primary: photo of the house. This is what an agent actually
            // wants to see when opening the record. The map moves to a
            // pivot button below.
            <a
              href={primaryPhoto.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="hero-photo-link"
              title={primaryPhoto.title}
            >
              <img
                src={primaryPhoto.url ?? undefined}
                alt={primaryPhoto.title}
                className="hero-photo"
                loading="lazy"
              />
            </a>
          ) : showMap ? (
            // No photo but we have a bridged polygon — satellite view with
            // gold erf polygon is the second-best visual anchor.
            <>
              <div ref={containerRef} className="cadastre-panel-canvas" />
              <span className="cadastre-coords">
                {lat!.toFixed(4)}, {lng!.toFixed(4)}
              </span>
            </>
          ) : (
            // Nothing to render — CSG-diagram placeholder. Never a black
            // rectangle. Also shown when coords exist but no polygon
            // (satellite alone on forested Knysna is a black square).
            <div className="cadastre-fallback">
              <CompassRose />
              <p className="cadastre-fallback-title">Cadastral diagram</p>
              <p className="cadastre-fallback-body">
                {hasCoords
                  ? "Coordinates on file but no CSG parcel linked. Use Find ERF from Muni to attach an ERF and see the boundary."
                  : "No coordinates or cadastre link yet. Use Find ERF from Muni to bring in a location."}
              </p>
              {lat != null && lng != null && (
                <p className="cadastre-fallback-coords">
                  {lat.toFixed(4)}, {lng.toFixed(4)}
                </p>
              )}
            </div>
          )}

          {/* Always-visible map pivot. Small pill in the bottom-left so it
              never obscures the hero visual. */}
          <Link href={mapHref} className="hero-map-pivot" prefetch={false}>
            <MapPinIcon /> View on map
          </Link>
        </div>

        <div className="schedule">
          <table>
            <tbody>
              {/* Hide rows with null values — a schedule of "—"s reads as
                  noise. Empty fields = we don't know; better to omit them
                  than fill the plate with placeholders. */}
              {scheduleRows.filter((row) => row.value != null && row.value !== "").map((row) => (
                <tr key={row.key} className={row.breakBefore ? "schedule-break" : ""}>
                  <td className="k">{row.label}</td>
                  <td className={`v ${row.mono ? "mono" : ""}`}>
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Remaining photos — strip below (primary is up top in the hero visual).
          Absent entirely when there are no other photos. */}
      {remainingPhotos.length > 0 && (
        <div className="record-photos">
          <p className="record-photos-label">
            More photos · {remainingPhotos.length}
          </p>
          <div className="record-photos-strip">
            {remainingPhotos.slice(0, 8).map((p) =>
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
            {remainingPhotos.length > 8 && (
              <span className="record-photo-more">+{remainingPhotos.length - 8}</span>
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

// Map-pin glyph for the "View on map" pivot pill.
function MapPinIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8 1c-2.76 0-5 2.13-5 4.76 0 3.57 5 9.24 5 9.24s5-5.67 5-9.24C13 3.13 10.76 1 8 1zm0 6.5a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5z"
        fill="currentColor"
      />
    </svg>
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
