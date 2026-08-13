"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * P17 — the theme customiser.
 *
 * **It cannot produce a third hue, and that constraint is the design.** The
 * handoff is unambiguous: light is pink + cream, dark is neon green + black,
 * and a third hue anywhere is a defect. A free colour picker would let any
 * visitor break that in one drag, and every contrast guarantee in the palette
 * with it. So what it offers is a *hue shift within the theme's own band*, plus
 * corner radius and density — three axes that change how the site feels without
 * touching what makes it readable.
 *
 * The accent lightness is never touched either, because the 7:1 contrast floor
 * is a function of lightness against the surface. Rotating hue at fixed
 * lightness and saturation keeps every measured ratio where it was.
 *
 * Everything is stored in `localStorage` and applied as CSS custom properties
 * on `<html>`. Nothing is sent anywhere: this is a preference about how one
 * person's browser draws a page, and it has no business being on a server.
 */

const STORAGE_KEY = "sf_theme_prefs";

interface Preferences {
  /** Degrees of hue rotation, clamped to the band the theme allows. */
  hueShift: number;
  /** Corner radius in pixels. */
  radius: number;
  /** Layout density multiplier. */
  density: number;
}

const DEFAULTS: Preferences = { hueShift: 0, radius: 18, density: 1 };

/**
 * How far the accent may rotate.
 *
 * ±18° keeps light inside its 337–341° text band's neighbourhood and dark
 * inside 120–130° — pink stays pink and neon green stays neon green. Wider and
 * the light theme starts arriving at orange, which is the third hue the brief
 * forbids.
 */
const MAX_HUE_SHIFT = 18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitise(raw: unknown): Preferences {
  const input = (raw ?? {}) as Partial<Preferences>;
  return {
    hueShift: clamp(Number(input.hueShift ?? 0) || 0, -MAX_HUE_SHIFT, MAX_HUE_SHIFT),
    radius: clamp(Number(input.radius ?? DEFAULTS.radius) || DEFAULTS.radius, 0, 28),
    density: clamp(Number(input.density ?? 1) || 1, 0.85, 1.25),
  };
}

/** Write the preferences onto the document. */
function apply(preferences: Preferences): void {
  const root = document.documentElement;
  // A filter on the root would rotate *everything*, including the photograph
  // and the project card illustrations. Custom properties let only the tokens
  // that opt in respond.
  root.style.setProperty("--accent-hue-shift", `${preferences.hueShift}deg`);
  root.style.setProperty("--radius", `${preferences.radius}px`);
  root.style.setProperty("--density", String(preferences.density));
}

export function ThemeCustomizer() {
  const [open, setOpen] = useState(false);
  // Read from storage in a lazy initialiser rather than in a mount effect.
  //
  // The effect version renders the defaults, then setState, then renders again
  // — a visible flash of the unpersonalised page and the cascading-render
  // pattern the compiler rules reject. This component is loaded with
  // `ssr: false`, so the initialiser only ever runs in a browser and
  // localStorage is safe to touch here.
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? sanitise(JSON.parse(stored)) : DEFAULTS;
    } catch {
      // Corrupt value or storage disabled — the defaults are already correct.
      return DEFAULTS;
    }
  });

  // Applying to the DOM *is* the effect: it synchronises React state with an
  // external system, which is what an effect is for.
  useEffect(() => {
    apply(preferences);
    // Once, on mount. Every later change applies through `update`, which has
    // to write storage as well and would double-apply from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("sf:open-theme-customizer", onOpen);
    return () => window.removeEventListener("sf:open-theme-customizer", onOpen);
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = sanitise({ ...current, ...patch });
      apply(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private mode. The change still applies for this session.
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPreferences(DEFAULTS);
    apply(DEFAULTS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clean up */
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="customizer"
      role="dialog"
      aria-label="Theme customiser"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <header>
        <h2>Appearance</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close">
          ✕
        </button>
      </header>

      <label>
        <span>
          Accent hue <em>{preferences.hueShift > 0 ? `+${preferences.hueShift}` : preferences.hueShift}°</em>
        </span>
        <input
          type="range"
          min={-MAX_HUE_SHIFT}
          max={MAX_HUE_SHIFT}
          step={1}
          value={preferences.hueShift}
          onChange={(event) => update({ hueShift: Number(event.target.value) })}
        />
      </label>

      <label>
        <span>
          Corner radius <em>{preferences.radius}px</em>
        </span>
        <input
          type="range"
          min={0}
          max={28}
          step={2}
          value={preferences.radius}
          onChange={(event) => update({ radius: Number(event.target.value) })}
        />
      </label>

      <label>
        <span>
          Density <em>{preferences.density.toFixed(2)}×</em>
        </span>
        <input
          type="range"
          min={0.85}
          max={1.25}
          step={0.05}
          value={preferences.density}
          onChange={(event) => update({ density: Number(event.target.value) })}
        />
      </label>

      <p className="customizer-note">
        Hue is clamped to ±{MAX_HUE_SHIFT}° so the palette stays two-colour and every contrast
        ratio holds — lightness is never touched, which is what the 7:1 floor depends on. Stored in
        this browser only.
      </p>

      <button type="button" className="customizer-reset" onClick={reset}>
        Reset to defaults
      </button>
    </div>
  );
}
