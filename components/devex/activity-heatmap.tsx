import { ACTIVITY_DAYS, type ActivityStats } from "../../lib/integrations/activity";

/**
 * P17 — the activity heatmap.
 *
 * A **server component** drawing a plain CSS grid: no chart library, nothing
 * hydrates, and it arrives in the initial HTML.
 *
 * **The label is the honest part.** This is public GitHub activity over the
 * last 90 days, which is what the unauthenticated events endpoint can actually
 * see — not "contributions", which would include private work and a full year.
 * Calling it the wrong thing would let a reader draw a conclusion the data
 * cannot support, which is a worse failure than not drawing it.
 */

/** Five buckets. More levels than the eye can distinguish is decoration. */
function level(count: number, max: number): number {
  if (count === 0) return 0;
  if (max <= 1) return 1;
  // Quartiles of the observed maximum rather than fixed thresholds: a fixed
  // scale renders a quiet period as entirely empty and a busy one as entirely
  // saturated, which is the same picture twice.
  const ratio = count / max;
  if (ratio > 0.66) return 4;
  if (ratio > 0.33) return 3;
  if (ratio > 0.12) return 2;
  return 1;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ActivityHeatmap({ activity, stale }: { activity: ActivityStats; stale: boolean }) {
  const max = Math.max(1, ...activity.days.map((day) => day.count));

  return (
    <section className="activity-panel" data-reveal>
      <header className="activity-head">
        <div>
          <h2>Public activity</h2>
          <p className="activity-sub">
            Last {ACTIVITY_DAYS} days of public GitHub events for{" "}
            <code>@{activity.username}</code>. Pushes count their commits; everything else counts
            once. Private work is not in here — the unauthenticated events API cannot see it, and
            calling this a contribution graph would claim otherwise.
          </p>
        </div>
        <dl className="activity-figures">
          <div>
            <dt>Events</dt>
            <dd>{activity.total}</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>{activity.currentStreak}d</dd>
          </div>
          {activity.busiestDay && (
            <div>
              <dt>Busiest</dt>
              <dd>{activity.busiestDay.count}</dd>
            </div>
          )}
        </dl>
      </header>

      {/* The grid is decorative for a screen reader — the same information is
          in the figures above and the summary below — so it is hidden rather
          than read out as 90 unlabelled cells. */}
      <ol className="activity-grid" aria-hidden="true">
        {activity.days.map((day) => (
          <li
            key={day.date}
            data-level={level(day.count, max)}
            title={`${formatDate(day.date)} — ${day.count} event${day.count === 1 ? "" : "s"}`}
          />
        ))}
      </ol>

      <footer className="activity-foot">
        <span className="activity-legend">
          Less
          {[0, 1, 2, 3, 4].map((value) => (
            <i key={value} data-level={value} />
          ))}
          More
        </span>
        {activity.eventTypes.length > 0 && (
          <span className="activity-types">
            {activity.eventTypes
              .map(([type, count]) => `${type.replace(/Event$/, "")} ×${count}`)
              .join(" · ")}
          </span>
        )}
        {stale && (
          <span className="activity-stale">
            Showing the last good reading — GitHub is rate-limiting or unavailable.
          </span>
        )}
      </footer>
    </section>
  );
}
