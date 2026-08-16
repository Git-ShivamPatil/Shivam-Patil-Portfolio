import { Suspense } from "react";
import type { Metadata } from "next";
import { GitHubPanel } from "../../components/stats/github-panel";
import { LeetCodePanel } from "../../components/stats/leetcode-panel";
import { PanelSkeleton } from "../../components/stats/panel-skeleton";
import { ActivityPanel } from "../../components/devex/activity-panel";
import "./stats.css";

export const metadata: Metadata = {
  title: "Live stats — Shivam Patil",
  description:
    "Live GitHub and LeetCode activity, pulled from their public APIs and cached with a stale-on-error fallback.",
  alternates: { canonical: "/stats" },
};

// Both panels read through a TTL cache in Postgres, so rendering is cheap —
// but it is still I/O, and it must not be baked into a static build. It also
// has to stay dynamic for the stale-on-error contract to mean anything: a
// statically rendered page would freeze whichever reading happened to be in
// the cache at build time and never notice the upstream recovering.
export const dynamic = "force-dynamic";

export default function StatsPage() {
  return (
    <>
      <section className="page-hero shell" data-reveal>
        <p className="eyebrow">Live signal</p>
        <h1 data-split>
          Numbers that
          <br />
          <em>update themselves.</em>
        </h1>
        <p>
          Pulled straight from the GitHub REST API and LeetCode&apos;s public GraphQL endpoint,
          cached server-side with a stale-on-error fallback — so when an upstream rate-limits, this
          page degrades to the last good reading instead of an error. Each panel says which of the
          two it is showing you, and refreshes itself while you read.
        </p>
      </section>

      <section className="stat-grid shell">
        {/* Streamed independently: a slow or throttled LeetCode response
            shouldn't hold back the GitHub panel. Each fallback mirrors the
            geometry of the panel it stands in for — see panel-skeleton.tsx for
            why a generic three-bar skeleton was a CLS bug. */}
        <Suspense fallback={<PanelSkeleton label="GitHub" shape="github" />}>
          <GitHubPanel />
        </Suspense>
        <Suspense fallback={<PanelSkeleton label="LeetCode" shape="leetcode" />}>
          <LeetCodePanel />
        </Suspense>
      </section>

      {/* P17. Streamed separately for the same reason the two panels above are:
          the events endpoint is the one most likely to be rate-limited, and a
          throttled heatmap must not delay the numbers beside it. */}
      <section className="shell pb-20" data-reveal>
        <Suspense fallback={<PanelSkeleton label="Activity" shape="activity" />}>
          <ActivityPanel />
        </Suspense>
      </section>
    </>
  );
}
