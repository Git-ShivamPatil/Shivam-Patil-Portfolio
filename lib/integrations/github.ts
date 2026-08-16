import {
  cached,
  fetchWithTimeout,
  parseJson,
  isRecord,
  isFiniteNumber,
  type CachedResult,
} from "./cache";
import { pathSegment, resolveUsername } from "./env";

/**
 * Null when GITHUB_USERNAME is set to something unusable and there is no
 * fallback left — the panel then renders its empty state rather than building
 * a request URL out of a blank. See lib/integrations/env.ts for why `??` alone
 * was not enough.
 */
export const GITHUB_USERNAME = resolveUsername(process.env.GITHUB_USERNAME, "Git-ShivamPatil");

/**
 * `v2` is a schema version, not decoration.
 *
 * Rows in IntegrationCache are Postgres JSON and are deliberately never
 * deleted, so they outlive deploys. This release added ownedRepos,
 * languageTotal and totalForks to GitHubStats; without the bump, every row
 * written by the previous deploy would have been served for a full hour with
 * those three fields `undefined`, and the new stars chart divides by
 * totalForks. Bump this whenever GitHubStats changes shape — a stale-shape row
 * then key-misses instead of deserialising wrongly.
 */
const CACHE_KEY = `github:v2:${GITHUB_USERNAME ?? "unset"}`;
// GitHub allows 60 req/hr unauthenticated, 5000 authenticated. An hour of TTL
// keeps us far inside even the unauthenticated budget.
const TTL_SECONDS = 60 * 60;

export interface GitHubRepoSummary {
  name: string;
  description: string | null;
  url: string;
  stars: number;
  forks: number;
  language: string | null;
  pushedAt: string;
  topics: string[];
}

export interface GitHubStats {
  username: string;
  name: string | null;
  avatarUrl: string;
  profileUrl: string;
  bio: string | null;
  publicRepos: number;
  followers: number;
  totalStars: number;
  totalForks: number;
  /** Non-fork, non-archived repos — the denominator every chart here uses. */
  ownedRepos: number;
  /** [language, repoCount], most-used first, capped at 6. */
  languages: [string, number][];
  /**
   * Repos that declare a primary language, BEFORE the cap above. The
   * distribution chart needs this to show an honest "other" slice: summing the
   * six kept entries and calling that the total would silently rebase every
   * percentage on a subset and make a 40% language look like 60%.
   */
  languageTotal: number;
  topRepos: GitHubRepoSummary[];
  memberSince: string;
}

interface GitHubUserResponse {
  login: string;
  name?: string | null;
  avatar_url?: string;
  html_url?: string;
  bio?: string | null;
  public_repos?: number;
  followers?: number;
  created_at?: string;
}

interface GitHubRepoResponse {
  name: string;
  description?: string | null;
  html_url?: string;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
  pushed_at?: string;
  topics?: string[];
  fork?: boolean;
  archived?: boolean;
}

/**
 * The only fields worth asserting are the ones whose absence would throw
 * downstream. `login` is the identity the panel renders and the rest of this
 * function derives defaults, so a partial-but-recognisable user object still
 * produces a usable panel rather than a 503.
 */
const isUser = (value: unknown): value is GitHubUserResponse =>
  isRecord(value) && typeof value.login === "string";

/**
 * Array-ness is the assertion that matters here. GitHub answers
 * `{"message":"API rate limit exceeded for …"}` — sometimes with a 200 from an
 * edge node rather than a 403 — and the old `as GitHubRepoResponse[]` cast sent
 * that object into `.filter()`, which threw "filter is not a function" from
 * inside the fetcher. cached() caught it, so the page survived, but the log
 * named a TypeError instead of the throttling that caused it.
 */
const isRepoList = (value: unknown): value is GitHubRepoResponse[] =>
  Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.name === "string");

function headers(): HeadersInit {
  const base: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub rejects API requests without a User-Agent.
    "User-Agent": "shivamsfolio-portfolio",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

const count = (value: unknown): number => (isFiniteNumber(value) ? value : 0);

async function fetchGitHubStats(username: string): Promise<GitHubStats> {
  const slug = pathSegment(username);
  const [userRes, reposRes] = await Promise.all([
    fetchWithTimeout(`https://api.github.com/users/${slug}`, { headers: headers() }),
    fetchWithTimeout(`https://api.github.com/users/${slug}/repos?per_page=100&sort=pushed`, {
      headers: headers(),
    }),
  ]);

  if (!userRes.ok) {
    throw new Error(`GitHub user request failed: ${userRes.status} ${userRes.statusText}`);
  }
  if (!reposRes.ok) {
    throw new Error(`GitHub repos request failed: ${reposRes.status} ${reposRes.statusText}`);
  }

  const user = await parseJson(userRes, `GitHub user "${username}"`, isUser);
  const allRepos = await parseJson(reposRes, `GitHub repos for "${username}"`, isRepoList);

  // Forks and archived repos would inflate the counts without representing
  // work done here, so they're excluded from every aggregate below.
  const repos = allRepos.filter((repo) => !repo.fork && !repo.archived);

  const languageCounts = new Map<string, number>();
  let totalStars = 0;
  let totalForks = 0;
  let languageTotal = 0;
  for (const repo of repos) {
    totalStars += count(repo.stargazers_count);
    totalForks += count(repo.forks_count);
    if (typeof repo.language === "string" && repo.language) {
      languageTotal += 1;
      languageCounts.set(repo.language, (languageCounts.get(repo.language) ?? 0) + 1);
    }
  }

  const topRepos = [...repos]
    .sort(
      (a, b) =>
        count(b.stargazers_count) - count(a.stargazers_count) ||
        (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""),
    )
    .slice(0, 6)
    .map<GitHubRepoSummary>((repo) => ({
      name: repo.name,
      description: repo.description ?? null,
      url: repo.html_url ?? `https://github.com/${username}/${repo.name}`,
      stars: count(repo.stargazers_count),
      forks: count(repo.forks_count),
      language: repo.language ?? null,
      // The relative-time formatter parses this; an absent pushed_at would
      // render "NaNd ago", so fall back to a value that formats as "today".
      pushedAt: repo.pushed_at ?? new Date().toISOString(),
      topics: Array.isArray(repo.topics) ? repo.topics.filter((t) => typeof t === "string") : [],
    }));

  return {
    username: user.login,
    name: user.name ?? null,
    avatarUrl: user.avatar_url ?? "",
    profileUrl: user.html_url ?? `https://github.com/${user.login}`,
    bio: user.bio ?? null,
    publicRepos: count(user.public_repos),
    followers: count(user.followers),
    totalStars,
    totalForks,
    ownedRepos: repos.length,
    languages: [...languageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    languageTotal,
    topRepos,
    memberSince: user.created_at ?? "",
  };
}

/**
 * Guards the CACHED payload, not the upstream response — see cached().
 *
 * The three fields checked are exactly the ones a panel dereferences without a
 * fallback: `languages.map()`, `topRepos.length`, and the arithmetic on
 * `totalStars`. A row missing any of them would throw inside the server
 * component, past cached()'s try/catch, and take the whole page to
 * global-error.tsx.
 */
const isGitHubStats = (value: unknown): value is GitHubStats =>
  isRecord(value) &&
  typeof value.username === "string" &&
  Array.isArray(value.languages) &&
  Array.isArray(value.topRepos) &&
  isFiniteNumber(value.totalStars) &&
  isFiniteNumber(value.ownedRepos);

export function getGitHubStats(): Promise<CachedResult<GitHubStats> | null> {
  const username = GITHUB_USERNAME;
  // No username means no request. Returning null here — rather than fetching
  // /users/undefined and letting the 404 become a "transient upstream failure"
  // that is retried every two minutes forever — is what makes the panel's
  // empty state a deliberate configuration signal instead of a mystery.
  if (!username) return Promise.resolve(null);
  return cached(CACHE_KEY, TTL_SECONDS, () => fetchGitHubStats(username), isGitHubStats);
}
