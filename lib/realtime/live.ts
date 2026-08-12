import { prisma } from "../prisma";
import { getPresence } from "./presence";
import type { LiveSnapshot } from "./constants";

/**
 * P11 — the live dashboard's read model.
 *
 * Everything here reads the ledgers P10 already writes. That is the whole
 * argument for building this on top of the analytics phase rather than beside
 * it: "live" is not a different kind of data, it is the same ledger with a
 * narrow `createdAt` window, so there is no second ingest path to keep correct
 * and no chance of the live number and the daily number disagreeing.
 *
 * Nothing is wrapped in `readOrFallback`, for the reason stated in
 * lib/analytics/report.ts — an admin screen quietly rendering zeroes because
 * the database is down looks exactly like "nobody is here", which is the one
 * answer this page must never give incorrectly.
 */

/** Minutes covered by the sparkline. */
const SPARK_MINUTES = 30;

/** Ceiling on rows pulled for the sparkline; 30 minutes of real traffic is far below it. */
const SPARK_TAKE = 2_000;

export async function getLiveSnapshot(now = Date.now()): Promise<LiveSnapshot> {
  const since5m = new Date(now - 5 * 60_000);
  const since60m = new Date(now - 60 * 60_000);
  const sinceSpark = new Date(now - SPARK_MINUTES * 60_000);

  const [presence, viewsLast5m, viewsLast60m, eventsLast60m, recentEvents, recentViews, sparkRows] =
    await Promise.all([
      getPresence(now),
      prisma.pageView.count({ where: { createdAt: { gte: since5m } } }),
      prisma.pageView.count({ where: { createdAt: { gte: since60m } } }),
      prisma.analyticsEvent.count({ where: { createdAt: { gte: since60m } } }),
      prisma.analyticsEvent.findMany({
        where: { createdAt: { gte: since60m } },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          type: true,
          path: true,
          target: true,
          device: true,
          country: true,
          createdAt: true,
        },
      }),
      prisma.pageView.findMany({
        where: { createdAt: { gte: since60m } },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, path: true, device: true, country: true, createdAt: true },
      }),
      prisma.pageView.findMany({
        where: { createdAt: { gte: sinceSpark } },
        select: { createdAt: true },
        take: SPARK_TAKE,
      }),
    ]);

  // Bucketed in JS rather than in SQL. Postgres could do it with date_trunc,
  // but that needs raw SQL, and the row set here is one window of one site's
  // traffic — bounded by SPARK_TAKE and typically a few dozen rows. This is the
  // opposite trade from the daily chart, where the row count grows without
  // bound and the materialised `day` column earns its 10 bytes.
  const perMinute = new Array<number>(SPARK_MINUTES).fill(0);
  for (const row of sparkRows) {
    const minutesAgo = Math.floor((now - row.createdAt.getTime()) / 60_000);
    if (minutesAgo < 0 || minutesAgo >= SPARK_MINUTES) continue;
    perMinute[SPARK_MINUTES - 1 - minutesAgo] += 1;
  }

  return {
    presence,
    viewsLast5m,
    viewsLast60m,
    eventsLast60m,
    recentEvents: recentEvents.map((row) => ({
      id: row.id,
      type: row.type,
      path: row.path,
      target: row.target,
      device: row.device,
      country: row.country,
      at: row.createdAt.toISOString(),
    })),
    recentViews: recentViews.map((row) => ({
      id: row.id,
      path: row.path,
      device: row.device,
      country: row.country,
      at: row.createdAt.toISOString(),
    })),
    perMinute,
  };
}
