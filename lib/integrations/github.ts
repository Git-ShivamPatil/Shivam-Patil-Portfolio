import { cached, fetchWithTimeout, type CachedResult } from "./cache";

export const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? "Git-ShivamPatil";

const CACHE_KEY = `github:${GITHUB_USERNAME}`;
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
  /** [language, repoCount], most-used first, capped at 6. */
  languages: [string, number][];
  topRepos: GitHubRepoSummary[];
  memberSince: string;
}

interface GitHubUserResponse {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  bio: string | null;
  public_repos: number;
  followers: number;
  created_at: string;
}

interface GitHubRepoResponse {
  name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  pushed_at: string;
  topics?: string[];
  fork: boolean;
  archived: boolean;
}

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

async function fetchGitHubStats(): Promise<GitHubStats> {
  const [userRes, reposRes] = await Promise.all([
    fetchWithTimeout(`https://api.github.com/users/${GITHUB_USERNAME}`, { headers: headers() }),
    fetchWithTimeout(
      `https://api.github.com/users/${GITHUB_USERNAME}/repos?per_page=100&sort=pushed`,
      { headers: headers() },
    ),
  ]);

  if (!userRes.ok) {
    throw new Error(`GitHub user request failed: ${userRes.status} ${userRes.statusText}`);
  }
  if (!reposRes.ok) {
    throw new Error(`GitHub repos request failed: ${reposRes.status} ${reposRes.statusText}`);
  }

  const user = (await userRes.json()) as GitHubUserResponse;
  const allRepos = (await reposRes.json()) as GitHubRepoResponse[];

  // Forks and archived repos would inflate the counts without representing
  // work done here, so they're excluded from every aggregate below.
  const repos = allRepos.filter((repo) => !repo.fork && !repo.archived);

  const languageCounts = new Map<string, number>();
  let totalStars = 0;
  for (const repo of repos) {
    totalStars += repo.stargazers_count;
    if (repo.language) {
      languageCounts.set(repo.language, (languageCounts.get(repo.language) ?? 0) + 1);
    }
  }

  const topRepos = [...repos]
    .sort(
      (a, b) => b.stargazers_count - a.stargazers_count || b.pushed_at.localeCompare(a.pushed_at),
    )
    .slice(0, 6)
    .map<GitHubRepoSummary>((repo) => ({
      name: repo.name,
      description: repo.description,
      url: repo.html_url,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language,
      pushedAt: repo.pushed_at,
      topics: repo.topics ?? [],
    }));

  return {
    username: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    profileUrl: user.html_url,
    bio: user.bio,
    publicRepos: user.public_repos,
    followers: user.followers,
    totalStars,
    languages: [...languageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    topRepos,
    memberSince: user.created_at,
  };
}

export function getGitHubStats(): Promise<CachedResult<GitHubStats> | null> {
  return cached(CACHE_KEY, TTL_SECONDS, fetchGitHubStats);
}
