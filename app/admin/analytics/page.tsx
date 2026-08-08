import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";
import { getHeatmap, getHeatmapTargets, getSiteAnalytics } from "../../../lib/analytics/report";
import { AnalyticsCharts } from "../../../components/admin/analytics-charts";
import { HeatmapViewer } from "../../../components/admin/heatmap-viewer";
import { RETENTION_DAYS } from "../../../lib/analytics/constants";

export const metadata: Metadata = {
  title: "Admin · Analytics — Shivam Patil",
  robots: { index: false, follow: false },
};

/** Windows offered by the range switcher. */
const RANGES = [7, 30, 90] as const;
const DEFAULT_RANGE = 30;

function statCard(label: string, value: number | string) {
  return (
    <div key={label} className="border-app-line rounded-2xl border p-5">
      <p className="text-app-muted text-xs font-semibold tracking-wide uppercase">{label}</p>
      <p className="text-app-fg mt-2 text-3xl font-bold tracking-tight">{value}</p>
    </div>
  );
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireAdmin("/admin/analytics");

  const requested = Number((await searchParams).days);
  const days = (RANGES as readonly number[]).includes(requested) ? requested : DEFAULT_RANGE;

  const [analytics, heatmapTargets, contentStats] = await Promise.all([
    getSiteAnalytics(days),
    getHeatmapTargets(),
    contentAndInboxStats(days),
  ]);

  // Render the busiest map server-side so the panel arrives populated rather
  // than fetching itself into existence after hydration.
  const first = heatmapTargets[0];
  const initialHeatmap = first ? await getHeatmap(first.path, first.device) : null;

  return (
    <div className="shell py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
            Admin
          </p>
          <h1 className="text-app-fg text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-app-muted mt-2 text-sm">
            First-party, cookieless, and opt-out aware. No IP address is ever stored — visitors are
            counted by a salted hash that rotates every UTC day, so it can tell two people apart
            today and cannot link either of them to yesterday. Rows are pruned after{" "}
            {RETENTION_DAYS} days.
          </p>
        </div>

        <div className="border-app-line flex gap-1 rounded-full border p-1">
          {RANGES.map((range) => (
            <Link
              key={range}
              href={`/admin/analytics?days=${range}`}
              aria-current={range === days ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                range === days ? "bg-app-fg text-app-bg" : "text-app-muted hover:text-app-fg"
              }`}
            >
              {range}d
            </Link>
          ))}
        </div>
      </div>

      <AnalyticsCharts analytics={analytics} />

      <div className="mt-6">
        <HeatmapViewer targets={heatmapTargets} initial={initialHeatmap} />
      </div>

      <section className="mt-12">
        <h2 className="text-app-fg mb-1 text-lg font-bold tracking-tight">Content &amp; inbox</h2>
        <p className="text-app-muted mb-5 text-sm">
          What exists and what has come in — the counterpart to the traffic above.
        </p>

        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {statCard("Messages", contentStats.messageTotal)}
          {statCard("Unread", contentStats.status.UNREAD ?? 0)}
          {statCard(
            "Published projects",
            `${contentStats.publishedProjects}/${contentStats.projects}`,
          )}
          {statCard("Published posts", `${contentStats.publishedBlogs}/${contentStats.blogs}`)}
          {statCard("Skills", contentStats.skills)}
          {statCard("Users", contentStats.users)}
          {statCard("Read", contentStats.status.READ ?? 0)}
          {statCard("Archived", contentStats.status.ARCHIVED ?? 0)}
        </div>

        <div className="mb-10">
          <h3 className="text-app-fg mb-4 text-sm font-bold">Messages, last {days} days</h3>
          <div className="border-app-line flex h-32 items-end gap-[3px] rounded-2xl border p-4">
            {contentStats.messagesByDay.map(([date, count]) => (
              <div
                key={date}
                title={`${date}: ${count}`}
                className="bg-app-lime/70 min-h-[2px] flex-1 rounded-t"
                style={{ height: `${(count / contentStats.maxMessages) * 100}%` }}
              />
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-app-fg mb-4 text-sm font-bold">Top referral sources (leads)</h3>
          {contentStats.referralCounts.length === 0 ? (
            <p className="text-app-muted text-sm">
              No referral-tagged leads yet — share links with <code>?ref=source</code> to track
              them.
            </p>
          ) : (
            <div className="border-app-line overflow-hidden rounded-2xl border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-app-line text-app-muted border-b text-xs tracking-wide uppercase">
                    <th className="px-4 py-3 font-semibold">Source</th>
                    <th className="px-4 py-3 font-semibold">Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {contentStats.referralCounts.map((row) => (
                    <tr key={row.referralRef} className="border-app-line border-b last:border-0">
                      <td className="text-app-fg px-4 py-2.5 font-medium">{row.referralRef}</td>
                      <td className="text-app-muted px-4 py-2.5">{row._count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The pre-P10 half of this page: inbox and content counts.
 *
 * Kept as it was, including the JS-side day bucketing. ContactMessage has no
 * materialised `day` column and does not need one — leads arrive in the tens,
 * not the tens of thousands, so the reason PageView got one does not apply.
 */
async function contentAndInboxStats(days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [
    messageTotal,
    statusCounts,
    referralCounts,
    recentMessages,
    projects,
    publishedProjects,
    blogs,
    publishedBlogs,
    skills,
    users,
  ] = await Promise.all([
    prisma.contactMessage.count(),
    prisma.contactMessage.groupBy({ by: ["status"], _count: true }),
    prisma.contactMessage.groupBy({
      by: ["referralRef"],
      _count: true,
      where: { referralRef: { not: null } },
      orderBy: { _count: { referralRef: "desc" } },
      take: 10,
    }),
    prisma.contactMessage.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.project.count(),
    prisma.project.count({ where: { published: true } }),
    prisma.blogPost.count(),
    prisma.blogPost.count({ where: { published: true } }),
    prisma.skill.count(),
    prisma.user.count(),
  ]);

  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    buckets.set(date.toISOString().slice(0, 10), 0);
  }
  for (const message of recentMessages) {
    const key = message.createdAt.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return {
    messageTotal,
    status: Object.fromEntries(statusCounts.map((row) => [row.status, row._count])) as Record<
      string,
      number
    >,
    referralCounts,
    messagesByDay: [...buckets.entries()],
    maxMessages: Math.max(1, ...buckets.values()),
    projects,
    publishedProjects,
    blogs,
    publishedBlogs,
    skills,
    users,
  };
}
