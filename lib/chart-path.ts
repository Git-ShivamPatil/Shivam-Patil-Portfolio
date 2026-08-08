/**
 * Shared SVG path maths for the hand-drawn admin charts.
 *
 * Extracted when P10's traffic chart needed the same curve P8's clicks chart
 * already had. Both are server components drawing a few hundred points; a
 * charting library would ship ~50KB of client JS to replace twenty lines that
 * render in the initial HTML.
 */

/** Catmull-Rom → cubic Bézier, so a trend line curves instead of zig-zagging. */
export function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return "";
  if (points.length < 3) return `M ${points.map((p) => p.join(" ")).join(" L ")}`;

  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    // 1/6 is the standard Catmull-Rom tension; higher overshoots on spikes,
    // which on a counts chart would draw negative values.
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return path;
}
