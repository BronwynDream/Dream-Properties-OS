"use client";

import { type MapListing, fullPrice, STATE_LABEL, TYPE_LABEL } from "./listing";
import { facts } from "./ResultsList";
import { SOURCE_META } from "./sources";

// The card that appears over a dot on hover: enough to decide whether to
// click — photo, price, rooms and size, where, and whose listing it is.
// Placed above the dot, or below it when the dot is near the top edge.

export default function HoverCard({ listing, x, y, stageW }: { listing: MapListing; x: number; y: number; stageW: number }) {
  const W = 264;
  const below = y < 230;
  const left = Math.min(Math.max(8, x - W / 2), Math.max(8, stageW - W - 8));
  const style: React.CSSProperties = below ? { left, top: y + 16, width: W } : { left, top: y - 16, width: W, transform: "translateY(-100%)" };
  const l = listing;
  return (
    <div className={`mx-hover${l.kind === "ours" ? " ours" : ""}`} style={style} role="tooltip">
      {l.image && (
        // eslint-disable-next-line @next/next/no-img-element -- portal images, not ours to optimise
        <img className="mx-hover-img" src={l.image} alt="" referrerPolicy="no-referrer" />
      )}
      <div className="mx-hover-body">
        <p className={`mx-hover-price${l.price == null ? " poa" : ""}`}>{fullPrice(l.price)}</p>
        <p className="mx-hover-addr">{l.address}</p>
        {l.areaOnly && <p className="mx-hover-area">Area only: the exact spot isn&rsquo;t published</p>}
        <p className="mx-hover-facts">{facts(l) || (l.type ? TYPE_LABEL[l.type] : "")}</p>
        <p className="mx-hover-who">
          {l.kind === "ours" ? (
            <span className={`mx-tag state-${l.state}`}>{l.state ? STATE_LABEL[l.state] : "Our listing"}</span>
          ) : (
            <span className="mx-tag">{l.agency ?? "Other agency"}</span>
          )}
          {l.sources
            .filter((s) => s !== "dream_os")
            .map((s) => (
              <span key={s} className="mx-src">
                {SOURCE_META[s].code}
              </span>
            ))}
        </p>
      </div>
    </div>
  );
}
