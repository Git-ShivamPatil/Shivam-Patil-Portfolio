import type { GitHubRepoSummary } from "../../lib/integrations/github";
import { ChartTextures, textureFill } from "./chart-textures";

const ID = "gh-impact";
const ROWS = 5;

/* viewBox geometry.

   The width is 260 for a reason that is easy to get wrong: SVG text scales with
   the viewBox, so the *ratio* of viewBox width to rendered width is what sets
   the effective font size. This panel is ~250px wide on a 375px phone and
   ~520px on desktop; pinning the viewBox near the narrow end and capping the
   rendered width in CSS keeps every label between roughly 10px and 16px
   instead of collapsing to 7px on mobile. */
const WIDTH = 260;
const GUTTER = 88; // right-aligned repo names live to the left of this
const PLOT_RIGHT = 238; // leaves room for the value label past the longest bar
const ROW_HEIGHT = 32;
const TOP = 8;
const AXIS_LABEL_ROW = 16;

/** Where a repo name has to be cut so it cannot run into the plot area. */
const NAME_LIMIT = 12;

/**
 * Stars and forks for the most-starred repositories.
 *
 * Two series on one row rather than two charts, because the question a reader
 * actually has is comparative — "is this starred but never used, or forked and
 * built on?" — and that comparison is only free when the bars share a baseline
 * and a scale.
 *
 * Server-rendered; there is nothing interactive here beyond native tooltips.
 */
export function RepoImpactChart({ repos }: { repos: GitHubRepoSummary[] }) {
  const shown = repos.slice(0, ROWS);
  const max = Math.max(...shown.map((r) => Math.max(r.stars, r.forks)), 0);

  // A chart of five zero-length bars states nothing and still occupies 200px.
  // The repo list underneath already carries the names.
  if (shown.length === 0 || max === 0) return null;

  const height = TOP + shown.length * ROW_HEIGHT + AXIS_LABEL_ROW;
  const scale = (value: number) => (value / max) * (PLOT_RIGHT - GUTTER);
  const ticks = [0, 0.5, 1].map((t) => ({ at: t, value: Math.round(max * t) }));

  const summary = shown.map((r) => `${r.name}: ${r.stars} stars, ${r.forks} forks`).join("; ");

  return (
    <div className="chart-block">
      <p className="stat-subhead">Stars and forks, most-starred first</p>
      <svg
        className="chart-impact"
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-labelledby={`${ID}-title ${ID}-desc`}
      >
        <title id={`${ID}-title`}>Stars and forks by repository</title>
        <desc id={`${ID}-desc`}>
          Two bars per repository, sharing one scale that tops out at {max}. {summary}.
        </desc>
        <ChartTextures idPrefix={ID} />

        {ticks.map((tick) => (
          <g key={tick.at}>
            <line
              className={tick.at === 0 ? "chart-axis-line" : "chart-grid-line"}
              x1={GUTTER + scale(max * tick.at)}
              y1={TOP - 4}
              x2={GUTTER + scale(max * tick.at)}
              y2={TOP + shown.length * ROW_HEIGHT}
            />
            <text
              className="chart-tick"
              x={GUTTER + scale(max * tick.at)}
              y={height - 4}
              textAnchor={tick.at === 0 ? "start" : tick.at === 1 ? "end" : "middle"}
            >
              {tick.value}
            </text>
          </g>
        ))}

        {shown.map((repo, index) => {
          const y = TOP + index * ROW_HEIGHT;
          const name =
            repo.name.length > NAME_LIMIT ? `${repo.name.slice(0, NAME_LIMIT - 1)}…` : repo.name;
          return (
            <g key={repo.name}>
              <text className="chart-row-name" x={GUTTER - 10} y={y + 15} textAnchor="end">
                {name}
                <title>{repo.name}</title>
              </text>

              <rect
                className="chart-bar"
                data-series="2"
                x={GUTTER}
                y={y + 1}
                width={Math.max(1, scale(repo.stars))}
                height="10"
                rx="2"
              >
                <title>{`${repo.name} — ${repo.stars} stars`}</title>
              </rect>
              <text className="chart-bar-value" x={GUTTER + scale(repo.stars) + 6} y={y + 10}>
                {repo.stars}
              </text>

              <rect
                className="chart-bar"
                data-series="5"
                x={GUTTER}
                y={y + 14}
                width={Math.max(1, scale(repo.forks))}
                height="10"
                rx="2"
              />
              {/* The texture is a second rect over the first: a patterned fill
                  on its own would show the panel through the gaps and lose the
                  series colour entirely. */}
              <rect
                className="chart-bar-texture"
                x={GUTTER}
                y={y + 14}
                width={Math.max(1, scale(repo.forks))}
                height="10"
                rx="2"
                style={textureFill(ID, 5)}
              >
                <title>{`${repo.name} — ${repo.forks} forks`}</title>
              </rect>
              <text className="chart-bar-value" x={GUTTER + scale(repo.forks) + 6} y={y + 23}>
                {repo.forks}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="chart-legend chart-legend-inline">
        <li className="chart-legend-row">
          <span className="chart-swatch" data-series="2" aria-hidden="true" />
          <span className="chart-legend-name">Stars</span>
        </li>
        <li className="chart-legend-row">
          <span className="chart-swatch" data-series="5" aria-hidden="true" />
          <span className="chart-legend-name">Forks</span>
        </li>
      </ul>
    </div>
  );
}
