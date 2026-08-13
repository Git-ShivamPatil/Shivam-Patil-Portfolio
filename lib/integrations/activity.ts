import { cached, fetchWithTimeout } from "./cache";

/**
 * P17 — a real activity heatmap, from data that is actually available.
 *
 * **Why not the contribution graph everyone recognises.** GitHub's own
 * contribution calendar is only exposed through the GraphQL API, which requires
 * an authenticated token — and `GITHUB_TOKEN` is optional on this deployment by
 * design, so a feature that needs it would be dead for most of the site's life.
 * The public events endpoint needs no auth at all.
 *
 * **What that costs, stated rather than hidden.** `/users/{u}/events/public`
 * returns at most 300 events over at most 90 days, and it excludes private
 * activity entirely. So this is "public activity in the last 90 days", not
 * "contributions", and the UI says exactly that. A chart labelled as something
 * it is not is worse than no chart: the reader draws conclusions the data
 * cannot support.
 */

const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? "";
const CACHE_KEY = "github:activity";

/**
 * Six hours. The upstream only updates when something is pushed, and this
 * endpoint is the one most likely to hit the 60-request unauthenticated hourly
 * limit — it is fetched alongside the two calls /stats already makes.
 */
const TTL_SECONDS = 6 * 60 * 60;

/** The window the events endpoint can actually cover. */
export const ACTIVITY_DAYS = 90;

export interface ActivityDay {
  /** "YYYY-MM-DD", UTC. */
  date: string;
  count: number;
}

export interface ActivityStats {
  username: string;
  days: ActivityDay[];
  total: number;
  busiestDay: ActivityDay | null;
  /** Consecutive days with activity, counting back from the most recent day. */
  currentStreak: number;
  /** How many event types were folded in — for the caption. */
  eventTypes: [string, number][];
}

interface GitHubEvent {
  type: string;
  created_at: string;
  payload?: { commits?: unknown[] };
}

function headers(): HeadersInit {
  const base: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "shivamsfolio-portfolio",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

/** UTC day keys for the window, oldest first — gaps included. */
function dayKeys(days: number, now: number): string[] {
  const keys: string[] = [];
  for (let index = days - 1; index >= 0; index--) {
    keys.push(new Date(now - index * 86_400_000).toISOString().slice(0, 10));
  }
  return keys;
}

export function summariseEvents(events: GitHubEvent[], now = Date.now()): Omit<ActivityStats, "username"> {
  const counts = new Map<string, number>();
  const types = new Map<string, number>();

  for (const event of events) {
    const day = new Date(event.created_at).toISOString().slice(0, 10);
    // A push carrying five commits is more activity than a single star, and
    // counting both as "1" makes the map flat and uninformative. Commits are
    // the unit where they exist; everything else counts as one.
    const weight = event.type === "PushEvent" ? Math.max(1, event.payload?.commits?.length ?? 1) : 1;
    counts.set(day, (counts.get(day) ?? 0) + weight);
    types.set(event.type, (types.get(event.type) ?? 0) + 1);
  }

  const days = dayKeys(ACTIVITY_DAYS, now).map((date) => ({ date, count: counts.get(date) ?? 0 }));
  const total = days.reduce((sum, day) => sum + day.count, 0);

  const busiestDay = days.reduce<ActivityDay | null>(
    (best, day) => (day.count > (best?.count ?? 0) ? day : best),
    null,
  );

  // Counted backwards from the most recent day. Today being empty does not
  // break a streak — the day is not over, and a counter that resets at midnight
  // and recovers at the first commit is noise rather than a signal.
  let currentStreak = 0;
  for (let index = days.length - 1; index >= 0; index--) {
    if (days[index].count > 0) currentStreak += 1;
    else if (index !== days.length - 1) break;
  }

  return {
    days,
    total,
    busiestDay: busiestDay && busiestDay.count > 0 ? busiestDay : null,
    currentStreak,
    eventTypes: [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}

async function fetchActivity(): Promise<ActivityStats> {
  const response = await fetchWithTimeout(
    `https://api.github.com/users/${GITHUB_USERNAME}/events/public?per_page=100`,
    { headers: headers() },
  );
  if (!response.ok) {
    throw new Error(`GitHub events request failed: ${response.status} ${response.statusText}`);
  }
  const events = (await response.json()) as GitHubEvent[];
  return { username: GITHUB_USERNAME, ...summariseEvents(events) };
}

/** Null when the username is unset — the panel then renders nothing. */
export async function getActivity() {
  if (!GITHUB_USERNAME) return null;
  return cached(CACHE_KEY, TTL_SECONDS, fetchActivity);
}
