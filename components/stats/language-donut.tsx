import { sectorPath, toSlices, percent } from "./chart-geometry";
import { ChartTextures, textureFill } from "./chart-textures";

/** Five named languages plus an honest "Other" — six series, six palette slots. */
const NAMED = 5;
const ID = "gh-lang";

/**
 * Share of repositories by primary language.
 *
 * Server-rendered: the data is in hand at render time and none of this needs
 * to be interactive, so shipping a chart runtime to the browser would buy
 * nothing. The whole component is markup — no client boundary, no hydration.
 */
export function LanguageDonut({
  languages,
  languageTotal,
}: {
  languages: [string, number][];
  /** Repos with a primary language, BEFORE the six-entry cap — see github.ts. */
  languageTotal: number;
}) {
  const named = languages.slice(0, NAMED);
  const namedSum = named.reduce((sum, [, count]) => sum + count, 0);
  const other = Math.max(0, languageTotal - namedSum);

  // "Other" is not decoration. `languages` is capped upstream, so summing the
  // kept entries and calling that the total would rebase every percentage on a
  // subset — a language holding 40% of the repos would print as 60%.
  const entries: [string, number][] = other > 0 ? [...named, ["Other", other]] : named;
  if (entries.length === 0 || languageTotal === 0) return null;

  const slices = toSlices(entries, ([, count]) => count);
  const summary = slices
    .map(({ item: [name, count], fraction }) => `${name} ${percent(fraction)} (${count})`)
    .join(", ");

  return (
    <div className="chart-block">
      <p className="stat-subhead">Repositories by primary language</p>
      <div className="chart-donut-layout">
        <svg
          className="chart-donut"
          viewBox="0 0 120 120"
          role="img"
          aria-labelledby={`${ID}-title ${ID}-desc`}
        >
          <title id={`${ID}-title`}>Repositories by primary language</title>
          <desc id={`${ID}-desc`}>
            {languageTotal} repositories carry a primary language. By share: {summary}.
          </desc>
          <ChartTextures idPrefix={ID} />

          {slices.map(({ item: [name, count], fraction, offset }, index) => {
            const series = index + 1;
            // A 1.5% gap between sectors. Two adjacent slices of a
            // lightness-only ramp separate by as little as 1.18:1, which is
            // below the threshold at which an eye finds an edge — the gap is
            // what makes the boundary visible, not the colour change.
            const gap = Math.min(0.015, fraction / 3);
            const d = sectorPath(60, 60, 54, 34, offset + gap / 2, fraction - gap);
            const texture = textureFill(ID, series);
            return (
              <g key={name} className="chart-slice" data-series={series}>
                <path className="chart-slice-fill" d={d}>
                  <title>{`${name} — ${count} ${count === 1 ? "repo" : "repos"}, ${percent(fraction)}`}</title>
                </path>
                {texture ? <path className="chart-slice-texture" d={d} style={texture} /> : null}
              </g>
            );
          })}

          <text className="chart-centre-value" x="60" y="59" textAnchor="middle">
            {languageTotal}
          </text>
          <text className="chart-centre-label" x="60" y="72" textAnchor="middle">
            REPOS
          </text>
        </svg>

        {/* The legend is HTML, not SVG text. SVG text scales with the viewBox,
            so on a 320px phone the labels would shrink below the size the rest
            of the page respects, and it cannot be selected or read by the
            browser's own find-in-page. */}
        <ul className="chart-legend">
          {slices.map(({ item: [name, count], fraction }, index) => (
            <li key={name} className="chart-legend-row">
              <span className="chart-swatch" data-series={index + 1} aria-hidden="true" />
              <span className="chart-legend-name">{name}</span>
              <span className="chart-legend-value">
                {count} · {percent(fraction)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
