import {
  cached,
  fetchWithTimeout,
  parseJson,
  isRecord,
  isFiniteNumber,
  type CachedResult,
} from "./cache";
import { pathSegment, resolveUsername } from "./env";

/** Null when the env var is unusable and no fallback survives — see env.ts. */
export const LEETCODE_USERNAME = resolveUsername(process.env.LEETCODE_USERNAME, "shivam2op");

/** Schema version — same reasoning as github.ts. `solved.total` gained a
 *  computed fallback this release, so pre-existing rows must key-miss. */
const CACHE_KEY = `leetcode:v2:${LEETCODE_USERNAME ?? "unset"}`;
// Longer TTL than GitHub: this endpoint is unofficial and throttles serverless
// IPs, so the cheapest way to stay inside its tolerance is to ask rarely.
const TTL_SECONDS = 6 * 60 * 60;

const ENDPOINT = "https://leetcode.com/graphql";

export interface LeetCodeStats {
  username: string;
  profileUrl: string;
  ranking: number | null;
  reputation: number | null;
  solved: { easy: number; medium: number; hard: number; total: number };
  /** Null when the user has never entered a rated contest. */
  contest: {
    rating: number;
    globalRanking: number;
    attended: number;
    topPercentage: number;
  } | null;
}

const QUERY = `
  query portfolioUserStats($username: String!) {
    matchedUser(username: $username) {
      username
      profile { ranking reputation }
      submitStatsGlobal {
        acSubmissionNum { difficulty count }
      }
    }
    userContestRanking(username: $username) {
      rating
      globalRanking
      attendedContestsCount
      topPercentage
    }
  }
`;

/**
 * Every nested object here is optional, and that is the correction rather than
 * defensive noise.
 *
 * LeetCode's schema advertises `profile` and `submitStatsGlobal` as non-null,
 * and the previous interface believed it. In practice the endpoint really does
 * return `submitStatsGlobal: null` for an account whose profile visibility is
 * restricted, and `profile: null` behind its bot challenge. The old code then
 * hit `user.submitStatsGlobal.acSubmissionNum.map(...)`, threw a TypeError,
 * and cached() recorded that as a transient upstream failure — so a
 * permanently-wrong response shape was indistinguishable in the logs from rate
 * limiting, and was retried every two minutes indefinitely.
 */
interface LeetCodeResponse {
  data?: {
    matchedUser?: {
      username?: string;
      profile?: { ranking?: number | null; reputation?: number | null } | null;
      submitStatsGlobal?: {
        acSubmissionNum?: { difficulty?: string; count?: number }[] | null;
      } | null;
    } | null;
    userContestRanking?: {
      rating?: number;
      globalRanking?: number;
      attendedContestsCount?: number;
      topPercentage?: number;
    } | null;
  } | null;
  errors?: { message?: string }[];
}

/**
 * GraphQL always answers 200, including for errors, so status is not a signal
 * here — an object with a `data` or `errors` key is the weakest claim that
 * still proves we reached GraphQL rather than a Cloudflare interstitial. The
 * field-level checks live below, where a missing field can name itself.
 */
const isGraphQlEnvelope = (value: unknown): value is LeetCodeResponse =>
  isRecord(value) && ("data" in value || "errors" in value);

const num = (value: unknown): number | null => (isFiniteNumber(value) ? value : null);

async function fetchLeetCodeStats(username: string): Promise<LeetCodeStats> {
  const response = await fetchWithTimeout(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // LeetCode's edge rejects requests that don't look browser-originated;
      // a Referer on its own origin is the part it actually checks.
      Referer: `https://leetcode.com/${pathSegment(username)}/`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
    body: JSON.stringify({ query: QUERY, variables: { username } }),
  });

  if (!response.ok) {
    throw new Error(`LeetCode request failed: ${response.status} ${response.statusText}`);
  }

  const json = await parseJson(response, `LeetCode GraphQL for "${username}"`, isGraphQlEnvelope);
  if (json.errors?.length) {
    throw new Error(
      `LeetCode GraphQL error: ${json.errors.map((e) => e.message ?? "(no message)").join("; ")}`,
    );
  }

  const user = json.data?.matchedUser;
  if (!user) {
    throw new Error(`LeetCode user "${username}" not found`);
  }

  const submissions = user.submitStatsGlobal?.acSubmissionNum;
  if (!Array.isArray(submissions)) {
    // Named explicitly so the log distinguishes "this profile is private or the
    // shape changed" from "we were throttled". Both used to surface as the same
    // anonymous TypeError, and only one of them is worth retrying.
    throw new Error(
      `LeetCode returned no submitStatsGlobal for "${username}" — the profile is private or the schema changed`,
    );
  }

  const byDifficulty = new Map<string, number>();
  for (const entry of submissions) {
    if (typeof entry?.difficulty === "string") {
      byDifficulty.set(entry.difficulty, isFiniteNumber(entry.count) ? entry.count : 0);
    }
  }

  const easy = byDifficulty.get("Easy") ?? 0;
  const medium = byDifficulty.get("Medium") ?? 0;
  const hard = byDifficulty.get("Hard") ?? 0;
  const contest = json.data?.userContestRanking ?? null;
  const rating = num(contest?.rating);

  return {
    username: typeof user.username === "string" && user.username ? user.username : username,
    profileUrl: `https://leetcode.com/u/${pathSegment(user.username ?? username)}/`,
    ranking: num(user.profile?.ranking),
    reputation: num(user.profile?.reputation),
    solved: {
      easy,
      medium,
      hard,
      // LeetCode returns an "All" bucket that already sums the other three —
      // preferred over adding them so the total can't drift from the source.
      // The sum is the fallback rather than the default: when the "All" bucket
      // is missing the panel would otherwise print "0 problems solved" beside
      // three non-zero difficulty bars, which reads as a bug in the site.
      total: byDifficulty.get("All") ?? easy + medium + hard,
    },
    contest:
      contest && rating !== null
        ? {
            rating: Math.round(rating),
            globalRanking: num(contest.globalRanking) ?? 0,
            attended: num(contest.attendedContestsCount) ?? 0,
            topPercentage: num(contest.topPercentage) ?? 0,
          }
        : null,
  };
}

/** Guards the cached row — the fields leetcode-panel.tsx destructures. */
const isLeetCodeStats = (value: unknown): value is LeetCodeStats =>
  isRecord(value) &&
  typeof value.username === "string" &&
  isRecord(value.solved) &&
  isFiniteNumber(value.solved.easy) &&
  isFiniteNumber(value.solved.medium) &&
  isFiniteNumber(value.solved.hard) &&
  isFiniteNumber(value.solved.total);

export function getLeetCodeStats(): Promise<CachedResult<LeetCodeStats> | null> {
  const username = LEETCODE_USERNAME;
  if (!username) return Promise.resolve(null);
  return cached(CACHE_KEY, TTL_SECONDS, () => fetchLeetCodeStats(username), isLeetCodeStats);
}
