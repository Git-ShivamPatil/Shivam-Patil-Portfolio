/**
 * Six textures, one per chart-series slot.
 *
 * These are the WCAG 1.4.1 answer, and on this site they are not optional.
 * Light theme is a strict two-colour system, so a categorical scale can only
 * vary *lightness* within one hue — measured, adjacent steps of --chart-1…6
 * separate by 1.18-1.27:1 (see the palette comment in app/stats/stats.css).
 * That is enough to see an edge and nowhere near enough to match an arc to its
 * legend entry. Texture does that job, and it survives greyscale printing,
 * every form of colour-vision deficiency, and a phone in direct sunlight.
 *
 * Slot 1 is deliberately untextured: a solid mark is itself a distinguishing
 * pattern, and it keeps the largest slice — which is slot 1 by construction —
 * clean.
 *
 * The strokes are painted in `var(--surface)`, the panel's own background, so
 * a texture reads as material cut away from the series colour rather than as a
 * seventh colour. That also means the textures re-derive themselves on theme
 * change with no dark-theme overrides at all.
 */
export function ChartTextures({ idPrefix }: { idPrefix: string }) {
  return (
    <defs>
      {/* 2 — diagonal, leaning right. */}
      <pattern
        id={`${idPrefix}-tex-2`}
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <line className="chart-texture" x1="0" y1="0" x2="0" y2="6" />
      </pattern>
      {/* 3 — dots. */}
      <pattern id={`${idPrefix}-tex-3`} width="6" height="6" patternUnits="userSpaceOnUse">
        <circle className="chart-texture-dot" cx="3" cy="3" r="1.4" />
      </pattern>
      {/* 4 — horizontal rules. */}
      <pattern id={`${idPrefix}-tex-4`} width="5" height="5" patternUnits="userSpaceOnUse">
        <line className="chart-texture" x1="0" y1="2.5" x2="5" y2="2.5" />
      </pattern>
      {/* 5 — cross-hatch. */}
      <pattern
        id={`${idPrefix}-tex-5`}
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <line className="chart-texture" x1="0" y1="0" x2="0" y2="6" />
        <line className="chart-texture" x1="0" y1="0" x2="6" y2="0" />
      </pattern>
      {/* 6 — diagonal, leaning left. */}
      <pattern
        id={`${idPrefix}-tex-6`}
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(-45)"
      >
        <line className="chart-texture" x1="0" y1="0" x2="0" y2="6" />
      </pattern>
    </defs>
  );
}

/**
 * The overlay fill for a series slot, or undefined for the solid one.
 *
 * Returned as a `style` value rather than a `fill` attribute, and that is not
 * a preference: an SVG presentation attribute loses to *any* CSS declaration,
 * so the day someone adds `fill: none` to `.chart-slice-texture` in stats.css
 * — a reasonable-looking reset — every texture on the page would silently
 * vanish and the charts would go back to being distinguished by a 1.2:1 colour
 * step. An inline style cannot be outranked that way.
 *
 * `idPrefix` must be unique per rendered chart: SVG pattern ids are
 * document-global, and two charts on the same page sharing an id means the
 * second one silently paints with the first one's defs — which on /stats,
 * where three charts sit in one document, is a guaranteed collision rather
 * than a theoretical one.
 */
export function textureFill(idPrefix: string, series: number): { fill: string } | undefined {
  return series <= 1 || series > 6 ? undefined : { fill: `url(#${idPrefix}-tex-${series})` };
}
