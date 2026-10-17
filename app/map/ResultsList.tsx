"use client";

import { useEffect, useRef } from "react";
import { type MapListing, shortPrice, sqm, STATE_LABEL, TYPE_LABEL } from "./listing";
import { SOURCE_META } from "./sources";

// The list beside the map: what is in view, in step with the dots.
// Hovering a card lights its dot; clicking opens the panel and flies there.
// "N in view of M" stops the false sense of having seen everything.

export type SortKey = "ours" | "price_desc" | "price_asc";

export default function ResultsList({
  items,
  total,
  sort,
  setSort,
  hoverKey,
  selectedKey,
  onHover,
  onSelect,
}: {
  items: MapListing[];
  total: number;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  hoverKey: string | null;
  selectedKey: string | null;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // A dot clicked on the map scrolls its card into view.
  useEffect(() => {
    if (!selectedKey || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-key="${CSS.escape(selectedKey)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedKey]);

  const ours = items.filter((l) => l.kind === "ours").length;

  return (
    <div className="mx-results">
      <div className="mx-results-head">
        <p className="mx-results-count">
          <b>{items.length}</b> in view <span>of {total}</span>
          {ours > 0 && <span className="mx-results-ours"> · {ours} ours</span>}
        </p>
        <label className="mx-sort">
          <span className="sr-only">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="ours">Ours first</option>
            <option value="price_desc">Price, high to low</option>
            <option value="price_asc">Price, low to high</option>
          </select>
        </label>
      </div>
      <div className="mx-results-list" ref={listRef} onMouseLeave={() => onHover(null)}>
        {items.length === 0 && (
          <div className="mx-empty">
            <p>Nothing here matches.</p>
            <p>Zoom out, move the map, or clear a filter.</p>
          </div>
        )}
        {items.map((l) => (
          <button
            key={l.key}
            type="button"
            data-key={l.key}
            className={`mx-card${l.kind === "ours" ? " ours" : ""}${hoverKey === l.key ? " hover" : ""}${selectedKey === l.key ? " selected" : ""}`}
            onMouseEnter={() => onHover(l.key)}
            onFocus={() => onHover(l.key)}
            onClick={() => onSelect(l.key)}
          >
            <span className="mx-card-thumb">
              {l.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- portal images, not ours to optimise
                <img src={l.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <span className="mx-card-noimg" aria-hidden>
                  {l.type === "land" ? "Plot" : "No photo"}
                </span>
              )}
            </span>
            <span className="mx-card-body">
              <span className="mx-card-price">{shortPrice(l.price)}</span>
              <span className="mx-card-addr">{l.address}</span>
              <span className="mx-card-facts">{facts(l)}</span>
              <span className="mx-card-tags">
                {l.kind === "ours" && l.state ? (
                  <span className={`mx-tag state-${l.state}`}>{STATE_LABEL[l.state]}</span>
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
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function facts(l: MapListing): string {
  const parts: string[] = [];
  if (l.beds != null) parts.push(`${l.beds} bed`);
  if (l.baths != null) parts.push(`${l.baths} bath`);
  const size = l.type === "land" ? sqm(l.erfSqm) : sqm(l.floorSqm) ?? sqm(l.erfSqm);
  if (size) parts.push(size);
  if (!parts.length && l.type) parts.push(TYPE_LABEL[l.type]);
  if (l.suburb) parts.push(l.suburb);
  return parts.join(" · ");
}
