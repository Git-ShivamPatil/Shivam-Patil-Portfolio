import { cached, fetchWithTimeout, parseJson, isRecord } from "./cache";
import { GITHUB_USERNAME } from "./github";
import { pathSegment } from "./env";

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

/**
 * The same resolved value github.ts uses, imported rather than re-read.
 *
 * This module used to do its own `process.env.GITHUB_USERNAME ?? ""`, with no
 * fallback, while github.ts defaulted to "Git-ShivamPatil". With the variable
 * unset that produced the worst possible page: the GitHub panel rendered real
 * data for the default account and the heatmap beside it silently rendered
 * nothing, so the site looked half-broken for a reason no log line mentioned.
 * One source of truth means the two features are always describing the same
 * person.
 */
const USERNAME = GITHUB_USERNAME;

/**
 * Keyed by username, and versioned.
 *
 * The flat "github:activity" key was the one cache entry not parameterised by
 * account. Changing GITHUB_USERNAME made the other two panels key-miss and
 * refetch immediately while the heatmap kept serving the previous account's
 * events under the new name for up to six hours.
 */
const CACHE_KEY = `github:activity:v2:${USERNAME ?? "unset"}`;

/**
 * Six hours. The upstream only updates when something is pushed, and this
 * endpoint is the one most likely to hit the 60-request unauthenticated hourly
 * limit — it is fetched alongside the two calls /stats already makes.
 */
const TTL_SECONDS = 6 * 60 * 60;

/** The window the events endpoint can actually cover. */
export const ACTIVITY_DAYS = 90;

/**
 * GitHub caps the public-events feed at 300 records, served as three pages of
 * 100. Fetching only page 1 covered roughly the last two to three weeks for an
 * active account, so about 70 of the 90 rendered cells were zero-filled by
 * `dayKeys` below — visually identical to genuine inactivity, and `total`,
 * `busiestDay` and `currentStreak` were all computed over that truncated set.
 * The file's own header argues a chart must not claim more than its data
 * supports; three pages is what makes the 90-day claim true.
 */
const MAX_PAGES = 3;
const PER_PAGE = 100;

/**
 * Paginating serially could stack three 8s timeouts onto one server render.
 * The budget caps the whole walk instead: whatever has been collected when it
 * expires is summarised, because a heatmap built from two pages is still a
 * better answer than a page that never finishes streaming.
 */
const PAGINATION_BUDGET_MS = 6000;
const PER_REQUEST_TIMEOUT_MS = 4000;

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

/**
 * A 200 carrying `{"message":"API rate limit exceeded"}` is a real GitHub
 * response, and `for (const event of events)` on an object throws
 * "events is not iterable" — an anonymous TypeError where the log should have
 * said "throttled". Records without a usable `created_at` are dropped rather
 * than rejected: one malformed event should not discard the other 299.
 */
const isEventList = (value: unknown): value is unknown[] => Array.isArray(value);

const isUsableEvent = (value: unknown): value is GitHubEvent =>
  isRecord(value) &&
  typeof value.type === "string" &&
  typeof value.created_at === "string" &&
  !Number.isNaN(Date.parse(value.created_at));

/** UTC day keys for the window, oldest first — gaps included. */
function dayKeys(days: number, now: number): string[] {
  const keys: string[] = [];
  for (let index = days - 1; index >= 0; index--) {
    keys.push(new Date(now - index * 86_400_000).toISOString().slice(0, 10));
  }
  return keys;
}

export function summariseEvents(
  events: GitHubEvent[],
  now = Date.now(),
): Omit<ActivityStats, "username"> {
  const counts = new Map<string, number>();
  const types = new Map<string, number>();

  for (const event of events) {
    const day = new Date(event.created_at).toISOString().slice(0, 10);
    // A push carrying five commits is more activity than a single star, and
    // counting both as "1" makes the map flat and uninformative. Commits are
    // the unit where they exist; everything else counts as one.
    const weight =
      event.type === "PushEvent" ? Math.max(1, event.payload?.commits?.length ?? 1) : 1;
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

async function fetchActivity(username: string): Promise<ActivityStats> {
  const deadline = Date.now() + PAGINATION_BUDGET_MS;
  const collected: GitHubEvent[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetchWithTimeout(
      `https://api.github.com/users/${pathSegment(username)}/events/public?per_page=${PER_PAGE}&page=${page}`,
      { headers: headers() },
      PER_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      // Page 1 failing is a real failure — there is nothing to show. A later
      // page failing is not: 200 events is a fine heatmap, and throwing would
      // discard them and write a two-minute tombstone over data we already
      // have in hand.
      if (page === 1) {
        throw new Error(`GitHub events request failed: ${response.status} ${response.statusText}`);
      }
      break;
    }

    const raw = await parseJson(response, `GitHub events for "${username}"`, isEventList);
    collected.push(...raw.filter(isUsableEvent));

    // A short page is the last page — GitHub has no more history to give.
    if (raw.length < PER_PAGE) break;
    if (Date.now() > deadline) break;
  }

  return { username, ...summariseEvents(collected) };
}

/** Guards the cached row — the fields activity-heatmap.tsx dereferences. */
const isActivityStats = (value: unknown): value is ActivityStats =>
  isRecord(value) &&
  typeof value.username === "string" &&
  Array.isArray(value.days) &&
  Array.isArray(value.eventTypes) &&
  typeof value.total === "number";

/**
 * Null when no username resolves — the panel then renders a labelled empty
 * state. See lib/integrations/env.ts for why the check is not `?? ""`.
 */
export async function getActivity() {
  const username = USERNAME;
  if (!username) return null;
  return cached(CACHE_KEY, TTL_SECONDS, () => fetchActivity(username), isActivityStats);
}
