import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";
import { LinkManager } from "../../../components/admin/link-manager";
import { getGrowthAnalytics } from "../../../lib/growth/links";
import { GrowthCharts } from "../../../components/admin/growth-charts";

export const metadata: Metadata = {
  title: "Admin · Growth",
  robots: { index: false, follow: false },
};

export default async function AdminLinksPage() {
  await requireAdmin("/admin/links");

  const [links, analytics] = await Promise.all([
    prisma.referralLink.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    getGrowthAnalytics(30),
  ]);

  // Prefer the configured origin so a copied link is the canonical one, but
  // fall back to the request host so this still works on a preview deploy or
  // in local dev where NEXT_PUBLIC_SITE_URL isn't set.
  const requestHost = (await headers()).get("host");
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    (requestHost ? `https://${requestHost}` : "");

  return (
    <div className="shell py-10">
      <div className="mb-8">
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Admin
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">Growth</h1>
        <p className="text-app-muted mt-2 text-sm">
          {links.length} link{links.length === 1 ? "" : "s"} · {analytics.totalClicks} clicks ·{" "}
          {analytics.totalConversions} attributed conversions
        </p>
      </div>

      <GrowthCharts analytics={analytics} />
      <div className="mt-10">
        <LinkManager initialLinks={links} origin={origin} />
      </div>
    </div>
  );
}
