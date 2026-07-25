"use client";

import { useCallback, useEffect, useState } from "react";

// Small photo gallery + lightbox. Renders one <img> per photo as a
// clickable thumbnail (matching the .doc-thumb style); on click, opens
// a full-screen overlay with prev/next controls and Esc-to-close.
//
// Kept dependency-free — the overlay is a plain fixed-position div with
// a couple of key handlers. Fits the "small studio, deliberate choices"
// tone without pulling in a modal library.
export type LightboxPhoto = {
  id: string;
  url: string;
  title: string;
};

export default function PhotoLightbox({ photos }: { photos: LightboxPhoto[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const prev = useCallback(
    () => setOpenIndex((i) => (i == null ? i : (i - 1 + photos.length) % photos.length)),
    [photos.length],
  );
  const next = useCallback(
    () => setOpenIndex((i) => (i == null ? i : (i + 1) % photos.length)),
    [photos.length],
  );

  useEffect(() => {
    if (openIndex == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    // Prevent background scroll while lightbox is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [openIndex, close, prev, next]);

  if (photos.length === 0) return null;

  const current = openIndex != null ? photos[openIndex] : null;

  return (
    <>
      {photos.map((p, i) => (
        <button
          key={p.id}
          type="button"
          className="doc-thumb"
          title={p.title}
          onClick={() => setOpenIndex(i)}
        >
          <img src={p.url} alt={p.title} loading="lazy" />
        </button>
      ))}

      {current && (
        <div
          className="lightbox-backdrop"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={current.title}
        >
          <img
            className="lightbox-image"
            src={current.url}
            alt={current.title}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="lightbox-caption"
            onClick={(e) => e.stopPropagation()}
          >
            {current.title}
            <span className="lightbox-counter">
              {openIndex! + 1} / {photos.length}
            </span>
          </div>
          <button
            type="button"
            className="lightbox-close"
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
          >
            ×
          </button>
          {photos.length > 1 && (
            <>
              <button
                type="button"
                className="lightbox-nav lightbox-prev"
                aria-label="Previous"
                onClick={(e) => {
                  e.stopPropagation();
                  prev();
                }}
              >
                ‹
              </button>
              <button
                type="button"
                className="lightbox-nav lightbox-next"
                aria-label="Next"
                onClick={(e) => {
                  e.stopPropagation();
                  next();
                }}
              >
                ›
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
