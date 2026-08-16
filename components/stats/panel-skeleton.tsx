/**
 * The Suspense fallback for each /stats panel.
 *
 * Built out of the REAL panel's containers — `.stat-panel`, `.stat-panel-head`,
 * `.stat-figures`, `.stat-bars`, `.stat-provenance` — with shimmer blocks
 * inside, rather than a generic stack of three grey bars. That is the whole
 * point: the previous skeleton was 3 × 20px in a flex column, roughly 90px
 * tall, and the panel that replaced it was 500-700px. Every swap shoved the
 * activity section and the footer down the page. This site's CLS is 0 and the
 * Lighthouse budget treats that as a gate, so a fallback whose geometry is
 * invented is a regression waiting for the next slow upstream.
 *
 * Reusing the actual layout classes means the padding, the 22px column gap,
 * the 3-up figures grid and the 1px rules are inherited rather than
 * re-estimated — they cannot drift when the panel is restyled. `shape` exists
 * because the two panels genuinely differ below the figures: GitHub has a
 * donut plus an impact chart plus a repo list, LeetCode has a gauge plus three
 * bar rows.
 *
 * Everything inside is aria-hidden. A screen reader is told the region is busy
 * by Suspense itself; reading out a description of grey rectangles is noise.
 */

type Shape = "github" | "leetcode" | "activity";

/** Matches `.stat-repos li a` — 13px padding, ~40px of content, 1px rule. */
const REPO_ROWS = 4;

export function PanelSkeleton({ label, shape = "github" }: { label: string; shape?: Shape }) {
  return (
    <div className="stat-panel stat-skeleton" data-shape={shape}>
      <div className="stat-panel-head">
        <p className="eyebrow">{label}</p>
        <span className="sk sk-link" aria-hidden="true" />
      </div>

      <div className="stat-figures" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div key={index}>
            <span className="sk sk-figure" />
            <span className="sk sk-figure-label" />
          </div>
        ))}
      </div>

      {shape === "github" && (
        <>
          <div className="chart-block" aria-hidden="true">
            <span className="sk sk-subhead" />
            <div className="chart-donut-layout">
              <span className="sk sk-donut" />
              <ul className="chart-legend">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <li key={index} className="chart-legend-row">
                    <span className="sk sk-row" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="chart-block" aria-hidden="true">
            <span className="sk sk-subhead" />
            <span className="sk sk-impact" />
          </div>
          <div className="stat-repos" aria-hidden="true">
            <span className="sk sk-subhead" />
            <ul>
              {Array.from({ length: REPO_ROWS }, (_, index) => (
                <li key={index}>
                  <span className="sk sk-repo" />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {shape === "leetcode" && (
        <>
          <div className="chart-block" aria-hidden="true">
            <span className="sk sk-subhead" />
            <span className="sk sk-gauge" />
          </div>
          <div className="stat-bars" aria-hidden="true">
            <span className="sk sk-subhead" />
            {[0, 1, 2].map((index) => (
              <div key={index} className="stat-bar-row">
                <span className="sk sk-row" />
                <div className="stat-bar-track" />
                <span className="sk sk-row" />
              </div>
            ))}
          </div>
        </>
      )}

      {shape === "activity" && (
        <div className="chart-block" aria-hidden="true">
          <span className="sk sk-subhead" />
          <span className="sk sk-heatmap" />
        </div>
      )}

      {/* The real footer is `.stat-live-foot`, not a bare provenance line —
          it also carries the refresh button, which is ~26px tall against the
          provenance line's 10px. Skipping the button here would under-reserve
          the panel by the exact amount that shifts the page. */}
      <div className="stat-live-foot" aria-hidden="true">
        <span className="sk sk-provenance" />
        <span className="sk sk-refresh" />
      </div>
    </div>
  );
}
