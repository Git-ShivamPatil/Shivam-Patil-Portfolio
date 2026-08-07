"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

// Mumbai, India.
const LNG = 72.8777;
const LAT = 19.076;
const ZOOM = 10.5;

const MAPBOX_JS = "https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.js";
const MAPBOX_CSS = "https://api.mapbox.com/mapbox-gl-js/v3.9.0/mapbox-gl.css";

interface MapboxGL {
  accessToken: string;
  Map: new (options: Record<string, unknown>) => { remove: () => void };
  Marker: new (options?: Record<string, unknown>) => {
    setLngLat: (coords: [number, number]) => { addTo: (map: unknown) => void };
  };
}
declare global {
  interface Window {
    mapboxgl?: MapboxGL;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("script failed")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("script failed"));
    document.head.appendChild(script);
  });
}

/**
 * Location map with progressive enhancement.
 *
 * First paint is a single Static Images API request — one cached image, no
 * JavaScript. Mapbox GL JS is ~250KB gzipped plus a WebGL context, which is a
 * lot to spend on a decorative "I'm in Mumbai" panel that most visitors will
 * never interact with, so it is only fetched if someone actually asks for the
 * interactive version.
 *
 * With no token configured this falls back to a styled placeholder rather
 * than a broken image.
 */
export function LocationMap() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const { resolvedTheme } = useTheme();
  const [interactive, setInteractive] = useState(false);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const style = resolvedTheme === "dark" ? "dark-v11" : "light-v11";

  useEffect(() => {
    if (!interactive || !token || !containerRef.current) return;

    let map: { remove: () => void } | null = null;
    let cancelled = false;

    (async () => {
      try {
        if (!document.querySelector(`link[href="${MAPBOX_CSS}"]`)) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = MAPBOX_CSS;
          document.head.appendChild(link);
        }
        await loadScript(MAPBOX_JS);
        if (cancelled || !window.mapboxgl || !containerRef.current) return;

        window.mapboxgl.accessToken = token;
        map = new window.mapboxgl.Map({
          container: containerRef.current,
          style: `mapbox://styles/mapbox/${style}`,
          center: [LNG, LAT],
          zoom: ZOOM,
          attributionControl: true,
        });
        new window.mapboxgl.Marker({ color: "#8eba00" }).setLngLat([LNG, LAT]).addTo(map);
      } catch (error) {
        console.error("[map] interactive load failed:", error);
        if (!cancelled) {
          setInteractive(false);
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [interactive, token, style]);

  if (!token) {
    return (
      <div className="location-map location-map-fallback" aria-label="Based in Mumbai, India">
        <div>
          <p className="eyebrow">Based in</p>
          <strong>Mumbai, India</strong>
          <span>IST · UTC+5:30</span>
        </div>
      </div>
    );
  }

  const staticUrl =
    `https://api.mapbox.com/styles/v1/mapbox/${style}/static/` +
    `pin-l+8eba00(${LNG},${LAT})/${LNG},${LAT},${ZOOM},0/1000x460@2x` +
    `?access_token=${token}&logo=false`;

  return (
    <div className="location-map">
      {interactive ? (
        <div ref={containerRef} className="location-map-canvas" />
      ) : (
        <>
          {/* Intentionally a plain <img>: this is a remote, token-signed URL
              whose dimensions are already fixed by the request itself, so
              next/image would add a proxy hop and a remotePatterns entry for
              no benefit. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={staticUrl}
            alt="Map showing Mumbai, India"
            className="location-map-static"
            width={1000}
            height={460}
            loading="lazy"
            onError={() => setFailed(true)}
          />
          <button
            type="button"
            className="location-map-cta"
            onClick={() => setInteractive(true)}
            data-ripple
          >
            {failed ? "Retry interactive map" : "Explore the map"}
          </button>
        </>
      )}
      <p className="location-map-caption">
        <span className="live-dot" aria-hidden="true" />
        Mumbai, India · IST (UTC+5:30)
      </p>
    </div>
  );
}
