import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";

export const metadata: Metadata = {
  title: "Admin · Analytics — Shivam Patil",
  robots: { index: false, follow: false },
};

const DAYS = 30;

function statCard(label: string, value: number | string) {
  return (
    <div key={label} className="border-app-line rounded-2xl border p-5">
      <p className="text-app-muted text-xs font-semibold tracking-wide uppercase">{label}</p>
      <p className="text-app-fg mt-2 text-3xl font-bold tracking-tight">{value}</p>
    </div>
  );
}

export default async function AdminAnalyticsPage() {
  await requireAdmin("/admin/analytics");

  const since = new Date();
  since.setDate(since.getDate() - DAYS);

  const [
    messageTotal,
    statusCounts,
    referralCounts,
    recentMessages,
    projectCount,
    publishedProjectCount,
    blogCount,
    publishedBlogCount,
    skillCount,
    userCount,
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

  // Bucket the last DAYS days of messages by date for a simple bar chart —
  // no charting library, this dataset is small enough that plain divs suffice.
  const buckets = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    buckets.set(date.toISOString().slice(0, 10), 0);
  }
  for (const message of recentMessages) {
    const key = message.createdAt.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const maxCount = Math.max(1, ...buckets.values());

  const statusMap = Object.fromEntries(statusCounts.map((row) => [row.status, row._count]));

  return (
    <div className="shell py-10">
      <div className="mb-8">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Admin
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="text-app-muted mt-2 text-sm">
          Inbox and content stats — for page-view traffic, see Vercel Analytics.
        </p>
      </div>

      <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {statCard("Messages", messageTotal)}
        {statCard("Unread", statusMap.UNREAD ?? 0)}
        {statCard("Published projects", `${publishedProjectCount}/${projectCount}`)}
        {statCard("Published posts", `${publishedBlogCount}/${blogCount}`)}
        {statCard("Skills", skillCount)}
        {statCard("Users", userCount)}
        {statCard("Read", statusMap.READ ?? 0)}
        {statCard("Archived", statusMap.ARCHIVED ?? 0)}
      </div>

      <section className="mb-10">
        <h2 className="text-app-fg mb-4 text-sm font-bold">Messages, last {DAYS} days</h2>
        <div className="border-app-line flex h-32 items-end gap-[3px] rounded-2xl border p-4">
          {Array.from(buckets.entries()).map(([date, count]) => (
            <div
              key={date}
              title={`${date}: ${count}`}
              className="bg-app-lime/70 min-h-[2px] flex-1 rounded-t"
              style={{ height: `${(count / maxCount) * 100}%` }}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-app-fg mb-4 text-sm font-bold">Top referral sources</h2>
        {referralCounts.length === 0 ? (
          <p className="text-app-muted text-sm">
            No referral-tagged leads yet — share links with <code>?ref=source</code> to track them.
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
                {referralCounts.map((row) => (
                  <tr key={row.referralRef} className="border-app-line border-b last:border-0">
                    <td className="text-app-fg px-4 py-2.5 font-medium">{row.referralRef}</td>
                    <td className="text-app-muted px-4 py-2.5">{row._count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
