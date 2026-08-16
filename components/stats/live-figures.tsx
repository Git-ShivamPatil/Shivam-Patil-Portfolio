"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { GitHubStats } from "../../lib/integrations/github";
import type { LeetCodeStats } from "../../lib/integrations/leetcode";
import { StaleNote } from "./stale-note";
import { useLiveData, type LiveSnapshot } from "./use-live-data";

/**
 * The client boundary on /stats, and deliberately the ONLY one.
 *
 * The server component renders the whole panel — figures, SVG charts, repo
 * list — and passes the charts down as `children`. React renders those on the
 * server and hands this component an already-rendered tree, so the first paint
 * is server HTML and the browser never receives the chart code. What crosses
 * the boundary is this file plus use-live-data.ts: three number tiles, a
 * provenance line and a poll.
 *
 * The charts intentionally do not re-render from the poll. Re-deriving a donut
 * client-side would mean shipping the geometry, the textures and the palette
 * mapping to the browser to redraw a chart whose input changes at most once an
 * hour. Instead, when the poll observes a genuinely newer `fetchedAt`, it asks
 * Next to re-run the server components — the SVGs come back regenerated, still
 * from the server, and the panel can never show tiles and a chart that
 * disagree.
 */

/** Both routes are behind a shared-cache s-maxage; poll no faster than that. */
const GITHUB_INTERVAL_MS = 5 * 60 * 1000; // route s-maxage is 60s, DB TTL 1h
const LEETCODE_INTERVAL_MS = 15 * 60 * 1000; // route s-maxage is 300s, DB TTL 6h

interface Tile {
  value: string;
  label: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isGitHubStats = (value: unknown): value is GitHubStats =>
  isRecord(value) && typeof value.username === "string" && Array.isArray(value.languages);

const isLeetCodeStats = (value: unknown): value is LeetCodeStats =>
  isRecord(value) && typeof value.username === "string" && isRecord(value.solved);

function Shell<T>({
  endpoint,
  intervalMs,
  initial,
  guard,
  tiles,
  children,
}: {
  endpoint: string;
  intervalMs: number;
  initial: LiveSnapshot<T>;
  guard: (value: unknown) => value is T;
  tiles: (data: T) => Tile[];
  children: ReactNode;
}) {
  const router = useRouter();
  const { snapshot, status, refresh } = useLiveData<T>({ endpoint, initial, intervalMs, guard });

  /**
   * Ask the server to re-render once the poll has moved past what the server
   * gave us. Guarded by a ref so this fires once per new reading: without it,
   * router.refresh() re-renders this component, the effect re-evaluates, and
   * the two chase each other in a loop for as long as the tab is open.
   */
  const refreshedFor = useRef(initial.fetchedAt);
  useEffect(() => {
    if (snapshot.fetchedAt === refreshedFor.current) return;
    if (Date.parse(snapshot.fetchedAt) <= Date.parse(initial.fetchedAt)) return;
    refreshedFor.current = snapshot.fetchedAt;
    router.refresh();
  }, [snapshot.fetchedAt, initial.fetchedAt, router]);

  return (
    <>
      <div className="stat-figures" data-live-status={status}>
        {tiles(snapshot.data).map((tile) => (
          <div key={tile.label}>
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
          </div>
        ))}
      </div>

      {children}

      <div className="stat-live-foot">
        <StaleNote fetchedAt={snapshot.fetchedAt} stale={snapshot.stale} />
        <button
          type="button"
          className="stat-refresh"
          onClick={() => void refresh()}
          disabled={status === "refreshing"}
          // The interval is minutes long by design; a reader who wants the
          // number NOW should not have to reload the page to get it.
          aria-label="Refresh this panel now"
        >
          <span className="stat-refresh-icon" aria-hidden="true" />
          {status === "refreshing" ? "Refreshing" : status === "error" ? "Retry" : "Refresh"}
        </button>
      </div>
      {/* Announced rather than shown: the visible state is carried by the
          button's own label, and a polite live region is how a screen-reader
          user learns a background poll changed the numbers above. */}
      <p className="stat-sr-only" role="status">
        {status === "error"
          ? "Live refresh failed; showing the last reading."
          : `Last updated ${snapshot.fetchedAt}.`}
      </p>
    </>
  );
}

export function LiveGitHubFigures({
  initial,
  children,
}: {
  initial: LiveSnapshot<GitHubStats>;
  children: ReactNode;
}) {
  return (
    <Shell
      endpoint="/api/integrations/github"
      intervalMs={GITHUB_INTERVAL_MS}
      initial={initial}
      guard={isGitHubStats}
      tiles={(data) => [
        { value: String(data.publicRepos), label: "public repos" },
        { value: String(data.totalStars), label: "stars earned" },
        { value: String(data.followers), label: "followers" },
      ]}
    >
      {children}
    </Shell>
  );
}

export function LiveLeetCodeFigures({
  initial,
  children,
}: {
  initial: LiveSnapshot<LeetCodeStats>;
  children: ReactNode;
}) {
  return (
    <Shell
      endpoint="/api/integrations/leetcode"
      intervalMs={LEETCODE_INTERVAL_MS}
      initial={initial}
      guard={isLeetCodeStats}
      tiles={(data) => [
        { value: String(data.solved.total), label: "problems solved" },
        data.contest
          ? { value: String(data.contest.rating), label: "contest rating" }
          : { value: String(data.solved.hard), label: "hard solved" },
        {
          value: data.ranking ? data.ranking.toLocaleString("en-US") : "—",
          label: "global rank",
        },
      ]}
    >
      {children}
    </Shell>
  );
}
