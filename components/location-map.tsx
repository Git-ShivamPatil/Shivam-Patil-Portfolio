"use client";

import { useState } from "react";

// Mumbai, India.
const LAT = 19.076;
const LNG = 72.8777;
// Bounding box the embed opens at — roughly greater Mumbai.
const BBOX = "72.70,18.88,73.12,19.32";

/**
 * OpenStreetMap embed, loaded on demand.
 *
 * Chosen over Mapbox deliberately: OSM's embed needs no account, no API key,
 * and no payment method on file, where Mapbox is a metered service that bills
 * past a free allowance. Nothing here can ever generate a charge.
 *
 * The iframe is only mounted after a click. That keeps a third-party frame
 * (and its tile requests) off the page for the majority of visitors who never
 * interact with it, and means the panel costs nothing on first paint.
 */
export function LocationMap() {
  const [showMap, setShowMap] = useState(false);

  const embedUrl =
    `https://www.openstreetmap.org/export/embed.html` +
    `?bbox=${encodeURIComponent(BBOX)}&layer=mapnik&marker=${LAT}%2C${LNG}`;
  const fullUrl = `https://www.openstreetmap.org/?mlat=${LAT}&mlon=${LNG}#map=11/${LAT}/${LNG}`;

  return (
    <div className="location-map">
      {showMap ? (
        <iframe
          className="location-map-frame"
          src={embedUrl}
          title="Map showing Mumbai, India"
          loading="lazy"
          // The embed is a static tile view; it needs no privileges at all.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="location-map-placeholder">
          {/* A hand-drawn coastline suggestion rather than a real tile —
              free, instant, and themed, with the real map one click away. */}
          <svg viewBox="0 0 400 220" aria-hidden="true" focusable="false">
            <defs>
              <pattern id="map-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                <path d="M28 0H0v28" fill="none" stroke="currentColor" strokeOpacity="0.13" />
              </pattern>
            </defs>
            <rect width="400" height="220" fill="url(#map-grid)" />
            <path
              d="M96 -10c14 44 2 70 22 104 16 27 8 52 26 84 8 15 6 30 2 46"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.28"
              strokeWidth="1.5"
            />
            <path
              d="M0 150c56 8 92-14 128-6 40 9 78-6 120 4 34 8 60 2 92-10"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.2"
              strokeWidth="1.5"
            />
            <circle cx="150" cy="118" r="6" className="location-map-pin" />
            <circle cx="150" cy="118" r="15" className="location-map-pin-halo" />
          </svg>
          <div className="location-map-placeholder-copy">
            <strong>Mumbai, India</strong>
            <span>19.076° N, 72.878° E</span>
          </div>
          <button
            type="button"
            className="location-map-cta"
            onClick={() => setShowMap(true)}
            data-ripple
          >
            Load map
          </button>
        </div>
      )}

      <p className="location-map-caption">
        <span className="live-dot" aria-hidden="true" />
        Mumbai · IST (UTC+5:30)
        <a href={fullUrl} target="_blank" rel="noreferrer">
          Open in OpenStreetMap ↗
        </a>
      </p>
    </div>
  );
}
