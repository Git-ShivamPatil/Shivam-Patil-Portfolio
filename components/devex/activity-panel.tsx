import { getActivity } from "../../lib/integrations/activity";
import { ActivityHeatmap } from "./activity-heatmap";
import "./terminal.css";

/**
 * P17 — the async boundary for the activity heatmap.
 *
 * Split from the presentational component so /stats can stream it inside its
 * own `<Suspense>`, exactly as the GitHub and LeetCode panels already are: a
 * throttled events endpoint must not hold back the two panels beside it.
 *
 * Renders nothing at all when there is no username configured or the fetch has
 * never succeeded. That is the same contract every other integration here
 * honours — an absent key disables a feature rather than showing a broken one.
 */
export async function ActivityPanel() {
  const result = await getActivity();
  if (!result) return null;

  return <ActivityHeatmap activity={result.data} stale={result.stale} />;
}
