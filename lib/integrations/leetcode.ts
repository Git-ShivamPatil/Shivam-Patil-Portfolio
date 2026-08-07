import { cached, fetchWithTimeout, type CachedResult } from "./cache";

export const LEETCODE_USERNAME = process.env.LEETCODE_USERNAME ?? "shivam2op";

const CACHE_KEY = `leetcode:${LEETCODE_USERNAME}`;
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

interface LeetCodeResponse {
  data?: {
    matchedUser: {
      username: string;
      profile: { ranking: number | null; reputation: number | null };
      submitStatsGlobal: {
        acSubmissionNum: { difficulty: string; count: number }[];
      };
    } | null;
    userContestRanking: {
      rating: number;
      globalRanking: number;
      attendedContestsCount: number;
      topPercentage: number;
    } | null;
  };
  errors?: { message: string }[];
}

async function fetchLeetCodeStats(): Promise<LeetCodeStats> {
  const response = await fetchWithTimeout(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // LeetCode's edge rejects requests that don't look browser-originated;
      // a Referer on its own origin is the part it actually checks.
      Referer: `https://leetcode.com/${LEETCODE_USERNAME}/`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
    body: JSON.stringify({ query: QUERY, variables: { username: LEETCODE_USERNAME } }),
  });

  if (!response.ok) {
    throw new Error(`LeetCode request failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as LeetCodeResponse;
  if (json.errors?.length) {
    throw new Error(`LeetCode GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }

  const user = json.data?.matchedUser;
  if (!user) {
    throw new Error(`LeetCode user "${LEETCODE_USERNAME}" not found`);
  }

  const byDifficulty = new Map(
    user.submitStatsGlobal.acSubmissionNum.map((entry) => [entry.difficulty, entry.count]),
  );

  const contest = json.data?.userContestRanking ?? null;

  return {
    username: user.username,
    profileUrl: `https://leetcode.com/u/${user.username}/`,
    ranking: user.profile.ranking,
    reputation: user.profile.reputation,
    solved: {
      easy: byDifficulty.get("Easy") ?? 0,
      medium: byDifficulty.get("Medium") ?? 0,
      hard: byDifficulty.get("Hard") ?? 0,
      // LeetCode returns an "All" bucket that already sums the other three —
      // preferred over adding them so the total can't drift from the source.
      total: byDifficulty.get("All") ?? 0,
    },
    contest: contest
      ? {
          rating: Math.round(contest.rating),
          globalRanking: contest.globalRanking,
          attended: contest.attendedContestsCount,
          topPercentage: contest.topPercentage,
        }
      : null,
  };
}

export function getLeetCodeStats(): Promise<CachedResult<LeetCodeStats> | null> {
  return cached(CACHE_KEY, TTL_SECONDS, fetchLeetCodeStats);
}
