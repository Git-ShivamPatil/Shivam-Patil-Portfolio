import { gaugeSector, polarPoint, toSlices, percent } from "./chart-geometry";
import { ChartTextures, textureFill } from "./chart-textures";

const ID = "lc-difficulty";

/* A 240° dial opening at the bottom: from -1/3 of a turn to +1/3, measured
   clockwise from 12 o'clock. A full ring would say "share of what I solved",
   which is the same thing the bars below already say; a dial reads as
   progress along a difficulty axis, which is the question a visitor has. */
const START_TURN = -1 / 3;
const SPAN_TURNS = 2 / 3;
const CX = 120;
const CY = 112;
const OUTER = 96;
const INNER = 68;
/** Just outside the ring — far enough that a label never sits on its own arc. */
const LABEL_RADIUS = 108;

/**
 * Easy / Medium / Hard mapped to non-adjacent palette slots.
 *
 * 1, 3 and 5 rather than 1, 2, 3 because the scale is a lightness ramp:
 * neighbouring slots separate by ~1.2:1, every other slot by ~1.5:1. Their
 * textures (solid, dots, cross-hatch) are also the three most dissimilar of
 * the six.
 */
const SERIES = [1, 3, 5] as const;

export function DifficultyGauge({
  easy,
  medium,
  hard,
  total,
}: {
  easy: number;
  medium: number;
  hard: number;
  total: number;
}) {
  const buckets: [string, number][] = [
    ["Easy", easy],
    ["Medium", medium],
    ["Hard", hard],
  ];
  const slices = toSlices(buckets, ([, count]) => count);
  if (slices.length === 0) return null;

  const summary = slices
    .map(({ item: [label, count], fraction }) => `${label} ${count} (${percent(fraction)})`)
    .join(", ");

  return (
    <div className="chart-block">
      <p className="stat-subhead">Solved by difficulty</p>
      <svg
        className="chart-gauge"
        viewBox="0 0 240 178"
        role="img"
        aria-labelledby={`${ID}-title ${ID}-desc`}
      >
        <title id={`${ID}-title`}>Solved problems by difficulty</title>
        <desc id={`${ID}-desc`}>
          A 240 degree dial split in proportion to the three difficulty tiers. {summary}. Total
          solved: {total}.
        </desc>
        <ChartTextures idPrefix={ID} />

        {/* The unfilled dial. Without it a reader has no reference for how much
            of the arc the three segments actually cover. */}
        <path
          className="chart-gauge-rail"
          d={gaugeSector(CX, CY, OUTER, INNER, START_TURN, START_TURN + SPAN_TURNS)}
        />

        {slices.map(({ item: [label, count], fraction, offset }, index) => {
          const series = SERIES[index];
          const from = START_TURN + offset * SPAN_TURNS;
          const to = from + fraction * SPAN_TURNS;
          // A 0.006-turn (about 2°) gap, capped so a tiny segment is never
          // eaten by its own separator.
          const gap = Math.min(0.006, (to - from) / 3);
          const d = gaugeSector(CX, CY, OUTER, INNER, from + gap / 2, to - gap / 2);
          const [lx, ly] = polarPoint(CX, CY, LABEL_RADIUS, (from + to) / 2);
          const texture = textureFill(ID, series);
          return (
            <g key={label} className="chart-slice" data-series={series}>
              <path className="chart-slice-fill" d={d}>
                <title>{`${label} — ${count} solved, ${percent(fraction)}`}</title>
              </path>
              {texture ? <path className="chart-slice-texture" d={d} style={texture} /> : null}
              {/* The count printed on its own arc. This is what makes the chart
                  readable without colour at all — the legend below repeats it,
                  but a reader should not have to travel to match a segment to
                  a number. */}
              <text
                className="chart-arc-label"
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {count}
              </text>
            </g>
          );
        })}

        <text className="chart-centre-value" x={CX} y={CY - 4} textAnchor="middle">
          {total}
        </text>
        <text className="chart-centre-label" x={CX} y={CY + 12} textAnchor="middle">
          SOLVED
        </text>
      </svg>

      <ul className="chart-legend chart-legend-inline">
        {slices.map(({ item: [label, count], fraction }, index) => (
          <li key={label} className="chart-legend-row">
            <span className="chart-swatch" data-series={SERIES[index]} aria-hidden="true" />
            <span className="chart-legend-name">{label}</span>
            <span className="chart-legend-value">
              {count} · {percent(fraction)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
