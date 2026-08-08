"use client";

import { useEffect, useState } from "react";
import { HEATMAP_DEVICES } from "../../lib/analytics/constants";
import type { HeatmapData, HeatmapTarget } from "../../lib/analytics/report";

/**
 * P10 — the click heatmap.
 *
 * A client component because switching maps is a filter, not a navigation:
 * re-rendering the whole dashboard to change one dropdown would throw away
 * every other panel to redraw a grid that is at most 1,152 cells.
 *
 * What is drawn is a *density grid*, not a screenshot overlay. There is no
 * stored screenshot to overlay — capturing one would mean rendering and
 * storing an image of every page, which is a large amount of machinery and
 * storage for a portfolio. The grid answers the question that actually
 * matters: which bands of the page get attention, and which do not.
 */

/**
 * Sequential heat ramp: cold → hot.
 *
 * Deliberately not the brand accents. A sequential scale has to be
 * monotonically increasing in perceived intensity or the reader cannot rank
 * two cells by looking at them, and the site's pastels are all of similar
 * lightness — pretty, and unreadable as data. The cool end borrows --cyan so
 * the panel still sits in the palette.
 */
const RAMP: [number, [number, number, number]][] = [
  [0.0, [96, 234, 216]],
  [0.35, [216, 254, 103]],
  [0.7, [255, 173, 116]],
  [1.0, [239, 83, 80]],
];

function heatColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 0; i < RAMP.length - 1; i++) {
    const [t0, c0] = RAMP[i];
    const [t1, c1] = RAMP[i + 1];
    if (clamped <= t1) {
      const span = t1 - t0 || 1;
      const k = (clamped - t0) / span;
      const mix = c0.map((channel, index) => Math.round(channel + (c1[index] - channel) * k));
      return `rgb(${mix[0]} ${mix[1]} ${mix[2]})`;
    }
  }
  const last = RAMP[RAMP.length - 1][1];
  return `rgb(${last[0]} ${last[1]} ${last[2]})`;
}

/**
 * Compress the scale.
 *
 * Click distributions are extremely long-tailed — one nav link can hold ten
 * times the clicks of everything else on the page. On a linear scale that
 * single cell is red and every other cell is indistinguishable from empty,
 * which hides exactly the mid-range detail the map exists to show.
 */
function intensity(count: number, max: number): number {
  if (max <= 1) return count > 0 ? 1 : 0;
  return Math.log(1 + count) / Math.log(1 + max);
}

async function fetchHeatmap(
  path: string,
  device: string,
  signal: AbortSignal,
): Promise<HeatmapData> {
  const response = await fetch(
    `/api/admin/analytics/heatmap?path=${encodeURIComponent(path)}&device=${encodeURIComponent(device)}`,
    { signal },
  );
  if (!response.ok) throw new Error(`Heatmap request failed: ${response.status}`);
  const body = (await response.json()) as { heatmap: HeatmapData };
  return body.heatmap;
}

export function HeatmapViewer({
  targets,
  initial,
}: {
  targets: HeatmapTarget[];
  initial: HeatmapData | null;
}) {
  const [path, setPath] = useState(initial?.path ?? targets[0]?.path ?? "/");
  const [device, setDevice] = useState(initial?.device ?? targets[0]?.device ?? "desktop");
  /** Last successfully fetched map, for any selection. */
  const [fetched, setFetched] = useState<HeatmapData | null>(null);
  /**
   * Failures are stored *with the selection that produced them*, so changing
   * the dropdown clears the message without a second piece of state to reset —
   * and a stale error can never sit above a map that loaded fine.
   */
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const paths = [...new Set(targets.map((target) => target.path))];
  const selection = `${path}|${device}`;

  const matches = (candidate: HeatmapData | null) =>
    candidate?.path === path && candidate?.device === device;

  /**
   * Everything below is *derived* from the selection rather than copied into
   * state. Copying would mean the rendered map and the dropdowns can disagree
   * for a render — which is exactly how a viewer ends up showing one page's
   * clicks under another page's label — and it is what would force a setState
   * into the effect body.
   *
   * "Loading" therefore needs no flag of its own: it is simply the state of
   * having neither data nor an error for what is currently selected.
   */
  const data = matches(initial) ? initial : matches(fetched) ? fetched : null;
  const error = failure?.key === selection ? failure.message : null;
  const loading = !data && !error;

  useEffect(() => {
    // Already have it: either the server rendered this selection or a previous
    // fetch did. Compared inline rather than through the helper above so every
    // value the effect reads is also in its dependency list.
    const have =
      (initial?.path === path && initial?.device === device) ||
      (fetched?.path === path && fetched?.device === device);
    if (have) return;

    const controller = new AbortController();
    // State is set from the promise's callbacks, never in the effect body —
    // the fetcher itself is a plain module-scope function that knows nothing
    // about React.
    fetchHeatmap(path, device, controller.signal)
      .then(setFetched)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[analytics] heatmap load failed:", cause);
        setFailure({ key: `${path}|${device}`, message: "Could not load that map." });
      });
    // Aborting matters: switching selections quickly would otherwise let an
    // earlier, slower response land after a later one and show the wrong map.
    return () => controller.abort();
  }, [path, device, initial, fetched]);

  if (targets.length === 0) {
    return (
      <div className="border-app-line rounded-2xl border p-5">
        <h2 className="text-app-fg mb-2 text-sm font-bold">Click heatmap</h2>
        <p className="text-app-muted text-sm">
          No clicks recorded yet. Cells appear here once visitors start clicking — the grid is
          sparse, so it only ever holds the spots people actually touched.
        </p>
      </div>
    );
  }

  const gridX = data?.gridX ?? 24;
  const gridY = data?.gridY ?? 48;
  const max = data?.max ?? 1;
  const devicesWithData = new Set(
    targets.filter((target) => target.path === path).map((target) => target.device),
  );

  return (
    <section className="border-app-line rounded-2xl border p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-app-fg text-sm font-bold">Click heatmap</h2>
          <p className="text-app-muted mt-1 text-xs">
            {data ? `${data.total} clicks across ${data.cells.length} cells` : "—"} · horizontal
            position is measured against the centred content column, vertical against full page
            height
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="heatmap-path">
            Page
          </label>
          <select
            id="heatmap-path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            className="border-app-line text-app-fg rounded-full border bg-transparent px-3 py-1.5 font-mono text-xs"
          >
            {paths.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <div className="border-app-line flex gap-1 rounded-full border p-1">
            {HEATMAP_DEVICES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDevice(option)}
                aria-pressed={device === option}
                // Dimmed rather than hidden: "this page has no mobile clicks"
                // is itself worth seeing, and a control that disappears makes
                // the reader wonder whether it ever existed.
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  device === option
                    ? "bg-app-fg text-app-bg"
                    : devicesWithData.has(option)
                      ? "text-app-muted hover:text-app-fg"
                      : "text-app-muted/50 hover:text-app-muted"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      <div className="flex flex-col gap-4 md:flex-row">
        <div
          className={`border-app-line relative mx-auto w-full max-w-sm overflow-hidden rounded-xl border transition-opacity ${
            loading ? "opacity-50" : "opacity-100"
          }`}
          style={{ background: "var(--warm)" }}
        >
          <svg
            viewBox={`0 0 ${gridX} ${gridY}`}
            className="block w-full"
            role="img"
            aria-label={
              loading
                ? `Loading click density for ${path} on ${device}`
                : data && data.cells.length > 0
                  ? `Click density for ${path} on ${device}: ${data.total} clicks, hottest cell ${max}`
                  : `No clicks recorded for ${path} on ${device}`
            }
          >
            <defs>
              {/* One blur over the whole layer turns discrete cells into the
                  continuous blobs a heatmap is read as. Applied to the group,
                  not per cell, so overlapping neighbours actually blend. */}
              <filter id="heat-blur" x="-15%" y="-8%" width="130%" height="116%">
                <feGaussianBlur stdDeviation="0.9" />
              </filter>
            </defs>

            {/* Column guides at the thirds — enough to locate a cell
                horizontally without drawing a grid over the data. */}
            {[1 / 3, 2 / 3].map((fraction) => (
              <line
                key={fraction}
                x1={gridX * fraction}
                x2={gridX * fraction}
                y1="0"
                y2={gridY}
                stroke="var(--line)"
                strokeWidth="0.06"
                strokeDasharray="0.4 0.6"
              />
            ))}
            {/* Fold lines: roughly one viewport-height apart on a typical
                desktop page, so "above the fold" is readable off the map. */}
            {[0.25, 0.5, 0.75].map((fraction) => (
              <line
                key={fraction}
                x1="0"
                x2={gridX}
                y1={gridY * fraction}
                y2={gridY * fraction}
                stroke="var(--line)"
                strokeWidth="0.06"
                strokeDasharray="0.4 0.6"
              />
            ))}

            <g filter="url(#heat-blur)">
              {data?.cells.map((cell) => {
                const t = intensity(cell.count, max);
                return (
                  <circle
                    key={`${cell.x},${cell.y}`}
                    cx={cell.x + 0.5}
                    cy={cell.y + 0.5}
                    // Slightly larger than a cell so adjacent hits merge into
                    // one blob rather than reading as separate dots.
                    r={0.75 + t * 0.75}
                    fill={heatColor(t)}
                    fillOpacity={0.35 + t * 0.5}
                  />
                );
              })}
            </g>

            {/* Hit targets carrying the tooltips, drawn above the blurred
                layer so the title is reachable and the visual stays soft. */}
            {data?.cells.map((cell) => (
              <rect
                key={`hit-${cell.x},${cell.y}`}
                x={cell.x}
                y={cell.y}
                width="1"
                height="1"
                fill="transparent"
              >
                <title>{`col ${cell.x + 1}, band ${cell.y + 1}: ${cell.count} clicks`}</title>
              </rect>
            ))}
          </svg>
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <div>
            <p className="text-app-muted mb-1.5 text-xs font-semibold tracking-wide uppercase">
              Intensity
            </p>
            <div
              className="h-2.5 w-full rounded-full"
              style={{
                background: `linear-gradient(90deg, ${RAMP.map(
                  ([stop, rgb]) => `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]}) ${stop * 100}%`,
                ).join(", ")})`,
              }}
            />
            <div className="text-app-muted mt-1 flex justify-between text-xs tabular-nums">
              <span>1</span>
              <span>{max} clicks (log scale)</span>
            </div>
          </div>

          <div>
            <p className="text-app-muted mb-1.5 text-xs font-semibold tracking-wide uppercase">
              Hottest cells
            </p>
            {data && data.cells.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm">
                {[...data.cells]
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 6)
                  .map((cell) => (
                    <li key={`top-${cell.x},${cell.y}`} className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: heatColor(intensity(cell.count, max)) }}
                      />
                      <span className="text-app-fg tabular-nums">
                        col {cell.x + 1}, band {cell.y + 1}
                      </span>
                      <span className="text-app-muted tabular-nums">{cell.count}</span>
                      <span className="text-app-muted text-xs">
                        ({Math.round(((cell.y + 0.5) / gridY) * 100)}% down)
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-app-muted text-sm">
                {loading ? "Loading…" : `No clicks recorded for this page on ${device}.`}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
