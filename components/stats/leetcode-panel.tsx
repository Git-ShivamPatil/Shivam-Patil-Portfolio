import { getLeetCodeStats, LEETCODE_USERNAME } from "../../lib/integrations/leetcode";
import { ArrowUpRight } from "../icons";
import { DifficultyGauge } from "./difficulty-gauge";
import { LiveLeetCodeFigures } from "./live-figures";

export async function LeetCodePanel() {
  const result = await getLeetCodeStats();

  if (!result) {
    return (
      <div className="stat-panel" data-reveal data-reveal-delay="2">
        <div className="stat-panel-head">
          <p className="eyebrow">LeetCode</p>
        </div>
        <p className="stat-panel-empty">
          {LEETCODE_USERNAME
            ? "LeetCode's public endpoint isn't responding right now — it rate-limits server traffic. This panel fills in on the next successful fetch."
            : "No LeetCode account is configured for this deployment, so this panel has nothing to read."}
        </p>
      </div>
    );
  }

  const { data } = result;
  const { easy, medium, hard, total } = data.solved;
  const widest = Math.max(easy, medium, hard, 1);

  // The tone suffixes map to .stat-bar-easy/-medium/-hard, which stats.css
  // pins to chart slots 1/3/5 — the same three difficulty-gauge.tsx uses, so
  // the dial and the bars beneath it are never two different colour schemes.
  const buckets: [string, number, "easy" | "medium" | "hard"][] = [
    ["Easy", easy, "easy"],
    ["Medium", medium, "medium"],
    ["Hard", hard, "hard"],
  ];

  return (
    <div className="stat-panel" data-reveal data-reveal-delay="2">
      <div className="stat-panel-head">
        <p className="eyebrow">LeetCode</p>
        <a href={data.profileUrl} target="_blank" rel="noreferrer" className="stat-panel-link">
          @{data.username} <ArrowUpRight />
        </a>
      </div>

      <LiveLeetCodeFigures
        initial={{
          data,
          fetchedAt: result.fetchedAt.toISOString(),
          stale: result.stale,
        }}
      >
        <DifficultyGauge easy={easy} medium={medium} hard={hard} total={total} />

        {/* The dial answers "what share"; these answer "how many". Keeping both
            is not duplication — a dial cannot show that Hard is 41 rather than
            4 without printing the number, and a bar row cannot show that Hard
            is a sixth of the total without arithmetic. */}
        <div className="stat-bars">
          <p className="stat-subhead">Counts by difficulty</p>
          {buckets.map(([label, count, tone]) => (
            <div key={label} className="stat-bar-row">
              <span>{label}</span>
              <div className="stat-bar-track">
                <i
                  className={`stat-bar-${tone}`}
                  style={{ width: `${Math.round((count / widest) * 100)}%` }}
                />
              </div>
              <b>{count}</b>
            </div>
          ))}
        </div>

        {data.contest && (
          <p className="stat-footnote">
            {data.contest.attended} rated contests · top {data.contest.topPercentage.toFixed(1)}%
            worldwide
          </p>
        )}
      </LiveLeetCodeFigures>
    </div>
  );
}
