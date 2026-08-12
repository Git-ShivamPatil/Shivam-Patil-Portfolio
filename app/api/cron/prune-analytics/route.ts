import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { auth } from "../../../../auth";
import { prisma } from "../../../../lib/prisma";
import { RETENTION_DAYS } from "../../../../lib/analytics/constants";
import { prunePresence } from "../../../../lib/realtime/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P10 — retention.
 *
 * Analytics tables are the only ones in this schema that grow with traffic
 * rather than with content, so they are the only ones that need a scheduled
 * delete. Two reasons, and the second is the real one:
 *
 * 1. The database is a free Neon tier. An unbounded ledger eventually is the
 *    outage.
 * 2. Keeping behavioural rows forever because nobody wrote the delete is not a
 *    retention policy. A stated window that is actually enforced is.
 *
 * Aggregates are kept. HeatmapCell and AnalyticsCounter hold counts with no
 * timestamp attached to any individual person, which is precisely the shape
 * data should be reduced *to* — deleting them would throw away the safe form
 * and keep nothing.
 */

const BATCH = 5_000;
/** Stop well inside the platform's function timeout; the next run continues. */
const MAX_BATCHES = 8;

function authorized(request: Request, isAdmin: boolean): boolean {
  if (isAdmin) return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Constant-time, and length-guarded first because timingSafeEqual throws on
  // a length mismatch rather than returning false.
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

/**
 * Delete in bounded batches rather than one `deleteMany`.
 *
 * A single unbounded delete over months of rows is a long-held lock and a
 * likely statement timeout — and a timed-out delete rolls back entirely, so
 * the job would make no progress at all while appearing to run.
 */
async function pruneInBatches(
  label: string,
  deleteBatch: (ids: string[]) => Promise<{ count: number }>,
  findIds: () => Promise<{ id: string }[]>,
): Promise<number> {
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await findIds();
    if (rows.length === 0) break;
    const result = await deleteBatch(rows.map((row) => row.id));
    removed += result.count;
    if (rows.length < BATCH) break;
  }
  if (removed > 0) console.log(`[analytics] pruned ${removed} ${label} rows`);
  return removed;
}

export async function GET(request: Request) {
  const session = await auth().catch(() => null);
  if (!authorized(request, session?.user?.role === "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);

  try {
    const views = await pruneInBatches(
      "page view",
      (ids) => prisma.pageView.deleteMany({ where: { id: { in: ids } } }),
      () =>
        prisma.pageView.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: BATCH,
        }),
    );

    const events = await pruneInBatches(
      "event",
      (ids) => prisma.analyticsEvent.deleteMany({ where: { id: { in: ids } } }),
      () =>
        prisma.analyticsEvent.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          take: BATCH,
        }),
    );

    // P11 presence rows expire on a window of minutes, not days, so they are
    // pruned on their own cutoff rather than the retention one. They are swept
    // opportunistically by the heartbeat too; this is the guarantee that the
    // sweep happens even during a stretch with no traffic at all.
    const presence = await prunePresence(Date.now());

    return NextResponse.json({
      retentionDays: RETENTION_DAYS,
      cutoff: cutoff.toISOString(),
      pruned: { pageViews: views, events, presence },
    });
  } catch (error) {
    console.error("GET /api/cron/prune-analytics failed:", error);
    return NextResponse.json({ error: "Prune failed." }, { status: 500 });
  }
}
