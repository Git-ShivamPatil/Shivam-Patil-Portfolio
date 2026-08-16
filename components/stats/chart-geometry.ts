/**
 * Geometry for the hand-written SVG on /stats.
 *
 * Pure arithmetic, no colour, no JSX — the same split lib/chart-path.ts uses
 * for the admin charts. Keeping it here rather than importing from there is
 * deliberate: that module is line/area geometry for a time series, this one is
 * sector geometry for part-of-whole, and merging them would give one file two
 * unrelated reasons to change.
 *
 * No charting library. This is ~40 lines of trigonometry; recharts is 500KB and
 * the Lighthouse budget in lighthouserc.json exists to keep it out.
 */

/** Angles run clockwise from 12 o'clock, which is how a reader scans a dial. */
const TWELVE_OCLOCK = -Math.PI / 2;

const point = (cx: number, cy: number, radius: number, angle: number): [number, number] => [
  cx + radius * Math.cos(angle),
  cy + radius * Math.sin(angle),
];

/** Trim to 2dp so the server and client render byte-identical path strings. */
const f = (n: number) => Math.round(n * 100) / 100;

/**
 * One ring sector — the building block of both the donut and the gauge.
 *
 * `sweep` is clamped just below a full turn. At exactly 2π the start and end
 * points coincide and the `A` command draws nothing at all, so a single
 * language at 100% would render an empty chart. Losing 0.06° instead produces
 * a hairline seam that is sub-pixel at the sizes used here.
 */
export function sectorPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startFraction: number,
  sweepFraction: number,
): string {
  const start = TWELVE_OCLOCK + startFraction * Math.PI * 2;
  const sweep = Math.min(sweepFraction, 0.9999) * Math.PI * 2;
  const end = start + sweep;
  const largeArc = sweep > Math.PI ? 1 : 0;

  const [ox0, oy0] = point(cx, cy, outerRadius, start);
  const [ox1, oy1] = point(cx, cy, outerRadius, end);
  const [ix1, iy1] = point(cx, cy, innerRadius, end);
  const [ix0, iy0] = point(cx, cy, innerRadius, start);

  return [
    `M ${f(ox0)} ${f(oy0)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${f(ox1)} ${f(oy1)}`,
    `L ${f(ix1)} ${f(iy1)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${f(ix0)} ${f(iy0)}`,
    "Z",
  ].join(" ");
}

/**
 * An open arc for the difficulty gauge — a dial, not a ring, so the eye reads
 * "how far along" rather than "what share".
 *
 * `startTurn`/`endTurn` are fractions of a full turn measured from 12 o'clock,
 * so a 240° dial centred on the bottom runs -0.333 to 0.333.
 */
export function gaugeSector(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startTurn: number,
  endTurn: number,
): string {
  return sectorPath(cx, cy, outerRadius, innerRadius, startTurn, Math.max(0, endTurn - startTurn));
}

/**
 * A point on a circle, in the same 12-o'clock-clockwise turn units as the
 * sector helpers. Used to place a label directly on its own arc, which is what
 * keeps the gauge readable when two series colours are 1.2:1 apart.
 */
export function polarPoint(cx: number, cy: number, radius: number, turn: number): [number, number] {
  const [x, y] = point(cx, cy, radius, TWELVE_OCLOCK + turn * Math.PI * 2);
  return [f(x), f(y)];
}

export interface Slice<T> {
  item: T;
  /** Share of the total, 0-1. */
  fraction: number;
  /** Cumulative share before this slice — the sector's start angle. */
  offset: number;
}

/**
 * Turns counts into cumulative fractions.
 *
 * The offset is a running sum rather than `index / length` because unequal
 * slices must abut exactly; recomputing each start from the item's own index
 * is the bug that leaves hairline gaps at every boundary. Same idempotent
 * prefix-sum the admin donuts use.
 */
export function toSlices<T>(items: T[], value: (item: T) => number): Slice<T>[] {
  const total = items.reduce((sum, item) => sum + Math.max(0, value(item)), 0);
  if (total <= 0) return [];
  let offset = 0;
  return items.map((item) => {
    const fraction = Math.max(0, value(item)) / total;
    const slice = { item, fraction, offset };
    offset += fraction;
    return slice;
  });
}

/** Percentages that always sum to 100 in the printed labels. */
export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
