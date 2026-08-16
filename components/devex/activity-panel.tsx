import { getActivity } from "../../lib/integrations/activity";
import { GITHUB_USERNAME } from "../../lib/integrations/github";
import { ActivityHeatmap } from "./activity-heatmap";
import "./terminal.css";

/**
 * P17 — the async boundary for the activity heatmap.
 *
 * Split from the presentational component so /stats can stream it inside its
 * own `<Suspense>`, exactly as the GitHub and LeetCode panels already are: a
 * throttled events endpoint must not hold back the two panels beside it.
 *
 * It used to `return null` when there was nothing to show. That looked tidy and
 * was not: /stats wraps this in `<section className="shell pb-20" data-reveal>`,
 * so a null panel left a 5rem empty band at the foot of the page and handed
 * ScrollReveal a `data-reveal` target with no content to reveal. It also hid
 * the most likely cause — an unset GITHUB_USERNAME — behind a page that simply
 * looked short. The empty state now says which of the two things happened, in
 * the same `.stat-panel-empty` treatment the other two panels use.
 */
export async function ActivityPanel() {
  const result = await getActivity();

  if (!result) {
    return (
      <div className="stat-panel" data-reveal>
        <div className="stat-panel-head">
          <p className="eyebrow">Activity</p>
        </div>
        <p className="stat-panel-empty">
          {GITHUB_USERNAME
            ? "GitHub's public events feed isn't responding right now. The heatmap fills in on the next successful fetch."
            : "No GitHub account is configured for this deployment, so there is no public event feed to chart."}
        </p>
      </div>
    );
  }

  return <ActivityHeatmap activity={result.data} stale={result.stale} />;
}
