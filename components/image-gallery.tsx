"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectImageItem } from "../app/projects";

// Plain <img> rather than next/image: gallery URLs are admin-pasted and can
// point at any host, so there's no fixed set to allowlist in
// next.config.ts's images.remotePatterns.

export function ImageGallery({ images }: { images: ProjectImageItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Remembered at open time so focus can go back where it came from — a
  // keyboard user who closes the lightbox should land on the thumbnail they
  // opened, not at the top of the document.
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (delta: number) => {
      setOpenIndex((current) => {
        if (current === null) return current;
        return (current + delta + images.length) % images.length;
      });
    },
    [images.length],
  );

  // `aria-modal="true"` is a promise to assistive tech that the rest of the
  // page is inert. Without focus management it was only a claim: Tab walked
  // straight out of the lightbox into the page behind it, so a screen-reader
  // user could be reading links they were told were unavailable. This effect
  // makes the claim true — move focus in, cycle it inside, put it back on
  // close, and stop the page underneath from scrolling.
  useEffect(() => {
    if (openIndex === null) return;

    const dialog = dialogRef.current;
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])") ??
          [],
      ).filter((element) => !element.hasAttribute("disabled"));

    focusables()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") return close();
      if (event.key === "ArrowRight") return step(1);
      if (event.key === "ArrowLeft") return step(-1);
      if (event.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends, and pull focus back in if it has already escaped.
      if (event.shiftKey && (active === first || !dialog?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
    // Only re-runs on open/close: `step` and `close` are stable, and keying
    // this on openIndex would steal focus back to the close button on every
    // arrow-key navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIndex === null]);

  return (
    <>
      <div className="image-gallery-grid">
        {images.map((image, index) => (
          <button
            key={image.url}
            type="button"
            className="image-gallery-thumb"
            onClick={(event) => {
              openerRef.current = event.currentTarget;
              setOpenIndex(index);
            }}
            aria-label={`Open image ${index + 1} of ${images.length}${image.alt ? `: ${image.alt}` : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={image.alt} loading="lazy" />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <div
          ref={dialogRef}
          className="image-gallery-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={close}
        >
          <button
            type="button"
            className="image-gallery-close"
            onClick={close}
            aria-label="Close preview"
          >
            ✕
          </button>
          {images.length > 1 && (
            <>
              <button
                type="button"
                className="image-gallery-nav image-gallery-prev"
                aria-label="Previous image"
                onClick={(event) => {
                  event.stopPropagation();
                  step(-1);
                }}
              >
                ←
              </button>
              <button
                type="button"
                className="image-gallery-nav image-gallery-next"
                aria-label="Next image"
                onClick={(event) => {
                  event.stopPropagation();
                  step(1);
                }}
              >
                →
              </button>
            </>
          )}
          <div
            className="image-gallery-lightbox-frame"
            onClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[openIndex].url}
              alt={images[openIndex].alt}
              className="image-gallery-lightbox-image"
            />
            {images[openIndex].alt && (
              <p className="image-gallery-caption">{images[openIndex].alt}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
