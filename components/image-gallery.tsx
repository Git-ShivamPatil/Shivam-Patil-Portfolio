"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectImageItem } from "../app/projects";

// Plain <img> rather than next/image: gallery URLs are admin-pasted and can
// point at any host, so there's no fixed set to allowlist in
// next.config.ts's images.remotePatterns.

export function ImageGallery({ images }: { images: ProjectImageItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

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

  useEffect(() => {
    if (openIndex === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openIndex, close, step]);

  return (
    <>
      <div className="image-gallery-grid">
        {images.map((image, index) => (
          <button
            key={image.url}
            type="button"
            className="image-gallery-thumb"
            onClick={() => setOpenIndex(index)}
            aria-label={`Open image ${index + 1} of ${images.length}${image.alt ? `: ${image.alt}` : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={image.alt} loading="lazy" />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <div
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
