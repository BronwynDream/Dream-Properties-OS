"use client";

import Link from "next/link";
import MarketListingAttach from "./MarketListingAttach";
import RegeocodeListingButton from "./RegeocodeListingButton";
import type { MergedPin, SourceKey } from "./MapView";
import { SOURCE_META } from "./sources";

// The listing panel that slides in when a dot is clicked: our record, every
// portal it appears on (with a price-mismatch flag), and the admin tools —
// move pin, attach a market listing, re-geocode. Moved out of MapView.tsx
// unchanged in behaviour for the 2026-10-17 map redesign.

function formatFullPrice(n: number | null): string {
  if (n == null) return "Price on application";
  return `R ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

export default function PreviewPanel({
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
                fontFamily: "var(--font-mono)",
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
                      fontFamily: "var(--font-mono)",
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
                  fontFamily: "var(--font-mono)",
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
                  fontFamily: "var(--font-mono)",
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
                    fontFamily: "var(--font-mono)",
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
                  className="btn-secondary"
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
                  className="btn-primary"
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
