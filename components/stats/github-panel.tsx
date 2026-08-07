import { getGitHubStats, GITHUB_USERNAME } from "../../lib/integrations/github";
import { ArrowUpRight } from "../icons";
import { StaleNote } from "./stale-note";

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
    return (
      <div className="stat-panel" data-reveal>
        <div className="stat-panel-head">
          <p className="eyebrow">GitHub</p>
          <a
            href={`https://github.com/${GITHUB_USERNAME}`}
            target="_blank"
            rel="noreferrer"
            className="stat-panel-link"
          >
            @{GITHUB_USERNAME} <ArrowUpRight />
          </a>
        </div>
        <p className="stat-panel-empty">
          Live GitHub data isn&apos;t reachable right now. The profile is still at{" "}
          <a href={`https://github.com/${GITHUB_USERNAME}`} target="_blank" rel="noreferrer">
            github.com/{GITHUB_USERNAME}
          </a>
          .
        </p>
      </div>
    );
  }

  const { data } = result;
  const maxLanguage = Math.max(...data.languages.map(([, count]) => count), 1);

  return (
    <div className="stat-panel" data-reveal>
      <div className="stat-panel-head">
        <p className="eyebrow">GitHub</p>
        <a href={data.profileUrl} target="_blank" rel="noreferrer" className="stat-panel-link">
          @{data.username} <ArrowUpRight />
        </a>
      </div>

      <div className="stat-figures">
        <div>
          <strong>{data.publicRepos}</strong>
          <span>public repos</span>
        </div>
        <div>
          <strong>{data.totalStars}</strong>
          <span>stars earned</span>
        </div>
        <div>
          <strong>{data.followers}</strong>
          <span>followers</span>
        </div>
      </div>

      {data.languages.length > 0 && (
        <div className="stat-bars">
          <p className="stat-subhead">Languages by repo count</p>
          {data.languages.map(([language, count]) => (
            <div key={language} className="stat-bar-row">
              <span>{language}</span>
              <div className="stat-bar-track">
                <i style={{ width: `${Math.round((count / maxLanguage) * 100)}%` }} />
              </div>
              <b>{count}</b>
            </div>
          ))}
        </div>
      )}

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

      <StaleNote fetchedAt={result.fetchedAt} stale={result.stale} />
    </div>
  );
}
