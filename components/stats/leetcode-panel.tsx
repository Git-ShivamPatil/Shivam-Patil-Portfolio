import { getLeetCodeStats } from "../../lib/integrations/leetcode";
import { ArrowUpRight } from "../icons";
import { StaleNote } from "./stale-note";

export async function LeetCodePanel() {
  const result = await getLeetCodeStats();

  if (!result) {
    return (
      <div className="stat-panel" data-reveal data-reveal-delay="2">
        <div className="stat-panel-head">
          <p className="eyebrow">LeetCode</p>
        </div>
        <p className="stat-panel-empty">
          LeetCode&apos;s public endpoint isn&apos;t responding right now — it rate-limits server
          traffic. This panel fills in on the next successful fetch.
        </p>
      </div>
    );
  }

  const { data } = result;
  const { easy, medium, hard, total } = data.solved;
  const widest = Math.max(easy, medium, hard, 1);

  const buckets: [string, number, string][] = [
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

      <div className="stat-figures">
        <div>
          <strong>{total}</strong>
          <span>problems solved</span>
        </div>
        {data.contest ? (
          <div>
            <strong>{data.contest.rating}</strong>
            <span>contest rating</span>
          </div>
        ) : (
          <div>
            <strong>{hard}</strong>
            <span>hard solved</span>
          </div>
        )}
        <div>
          <strong>{data.ranking ? data.ranking.toLocaleString("en-US") : "—"}</strong>
          <span>global rank</span>
        </div>
      </div>

      <div className="stat-bars">
        <p className="stat-subhead">Solved by difficulty</p>
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

      <StaleNote fetchedAt={result.fetchedAt} stale={result.stale} />
    </div>
  );
}
