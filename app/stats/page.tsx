import { Suspense } from "react";
import type { Metadata } from "next";
import { GitHubPanel } from "../../components/stats/github-panel";
import { LeetCodePanel } from "../../components/stats/leetcode-panel";
import { ActivityPanel } from "../../components/devex/activity-panel";
import "./stats.css";

export const metadata: Metadata = {
  title: "Live stats — Shivam Patil",
  description:
    "Live GitHub and LeetCode activity, pulled from their public APIs and cached with a stale-on-error fallback.",
  alternates: { canonical: "/stats" },
};

// Both panels read through a TTL cache in Postgres, so rendering is cheap —
// but it is still I/O, and it must not be baked into a static build.
export const dynamic = "force-dynamic";

function PanelSkeleton({ label }: { label: string }) {
  return (
    <div className="stat-panel">
      <div className="stat-panel-head">
        <p className="eyebrow">{label}</p>
      </div>
      <div className="stat-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

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
          page degrades to the last good reading instead of an error.
        </p>
      </section>

      <section className="stat-grid shell">
        {/* Streamed independently: a slow or throttled LeetCode response
            shouldn't hold back the GitHub panel. */}
        <Suspense fallback={<PanelSkeleton label="GitHub" />}>
          <GitHubPanel />
        </Suspense>
        <Suspense fallback={<PanelSkeleton label="LeetCode" />}>
          <LeetCodePanel />
        </Suspense>
      </section>

      {/* P17. Streamed separately for the same reason the two panels above are:
          the events endpoint is the one most likely to be rate-limited, and a
          throttled heatmap must not delay the numbers beside it. */}
      <section className="shell pb-20" data-reveal>
        <Suspense fallback={<PanelSkeleton label="Activity" />}>
          <ActivityPanel />
        </Suspense>
      </section>
    </>
  );
}
