import { getGitHubStats, GITHUB_USERNAME } from "../../lib/integrations/github";
import { ArrowUpRight } from "../icons";
import { LanguageDonut } from "./language-donut";
import { RepoImpactChart } from "./repo-impact-chart";
import { LiveGitHubFigures } from "./live-figures";

function relativeTime(iso: string): string {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

export async function GitHubPanel() {
  const result = await getGitHubStats();

  if (!result) {
    // Two distinct causes, one state, and the copy has to cover both: either
    // GITHUB_USERNAME resolved to nothing (configuration) or there is no cached
    // row and the fetch failed (upstream). A missing username also means there
    // is no profile URL to offer, so the link is conditional rather than
    // interpolated into "github.com/null".
    return (
      <div className="stat-panel" data-reveal>
        <div className="stat-panel-head">
          <p className="eyebrow">GitHub</p>
          {GITHUB_USERNAME && (
            <a
              href={`https://github.com/${GITHUB_USERNAME}`}
              target="_blank"
              rel="noreferrer"
              className="stat-panel-link"
            >
              @{GITHUB_USERNAME} <ArrowUpRight />
            </a>
          )}
        </div>
        <p className="stat-panel-empty">
          {GITHUB_USERNAME ? (
            <>
              Live GitHub data isn&apos;t reachable right now. The profile is still at{" "}
              <a href={`https://github.com/${GITHUB_USERNAME}`} target="_blank" rel="noreferrer">
                github.com/{GITHUB_USERNAME}
              </a>
              .
            </>
          ) : (
            <>
              No GitHub account is configured for this deployment, so this panel has nothing to
              read.
            </>
          )}
        </p>
      </div>
    );
  }

  const { data } = result;

  return (
    <div className="stat-panel" data-reveal>
      <div className="stat-panel-head">
        <p className="eyebrow">GitHub</p>
        <a href={data.profileUrl} target="_blank" rel="noreferrer" className="stat-panel-link">
          @{data.username} <ArrowUpRight />
        </a>
      </div>

      {/* Everything between the figures and the provenance line is passed
          through LiveGitHubFigures as children, which means it renders on the
          server and never reaches the browser as code. See live-figures.tsx. */}
      <LiveGitHubFigures
        initial={{
          data,
          fetchedAt: result.fetchedAt.toISOString(),
          stale: result.stale,
        }}
      >
        <LanguageDonut languages={data.languages} languageTotal={data.languageTotal} />
        <RepoImpactChart repos={data.topRepos} />

        {data.topRepos.length > 0 && (
          <div className="stat-repos">
            <p className="stat-subhead">Most-starred repositories</p>
            <ul>
              {data.topRepos.map((repo) => (
                <li key={repo.name}>
                  <a href={repo.url} target="_blank" rel="noreferrer">
                    <div>
                      <strong>{repo.name}</strong>
                      {repo.description && <p>{repo.description}</p>}
                    </div>
                    <span>
                      ★ {repo.stars} · {relativeTime(repo.pushedAt)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </LiveGitHubFigures>
    </div>
  );
}
