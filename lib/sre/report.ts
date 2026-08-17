import { prisma } from "../prisma";
import { clampQuantile, histogramQuantile } from "./histogram";
import { LATENCY_BUCKETS_MS } from "./red";

/**
 * P21 — reading RED back out.
 *
 * Every number here is a GROUP BY over RequestMetric, which is the read-side
 * cost of the append-only write design. It is paid on /reliability and on a
 * Prometheus scrape, both of which are rare, rather than on every request,
 * which is the trade the schema comment on RequestMetric argues for.
 *
 * The window is a parameter and not a constant because the two consumers want
 * different ones: a dashboard wants the last hour, a burn-rate alert wants five
 * minutes and an hour side by side.
 */

/** Summed histogram columns in boundary order, then +Inf. */
type SummedBuckets = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface RouteReport {
  route: string;
  method: string;
  /** Requests per minute across the window — the R. */
  rate: number;
  requests: number;
  /** 5xx as a fraction of requests — the E. */
  errorRate: number;
  errors: number;
  /** Milliseconds — the D. */
  p50: number | null;
  p95: number | null;
  p99: number | null;
  maxMs: number;
  meanMs: number | null;
}

export interface RedReport {
  windowMinutes: number;
  since: Date;
  routes: RouteReport[];
  totals: {
    requests: number;
    errors: number;
    errorRate: number;
    rate: number;
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  /** Distinct instances that reported in the window. */
  instances: number;
  /** True when no rows exist at all — a fresh deploy, not an outage. */
  empty: boolean;
}

function bucketsOf(sum: {
  le10: number | null;
  le25: number | null;
  le50: number | null;
  le100: number | null;
  le250: number | null;
  le500: number | null;
  le1000: number | null;
  le2500: number | null;
  le5000: number | null;
  leInf: number | null;
}): SummedBuckets {
  return [
    sum.le10 ?? 0,
    sum.le25 ?? 0,
    sum.le50 ?? 0,
    sum.le100 ?? 0,
    sum.le250 ?? 0,
    sum.le500 ?? 0,
    sum.le1000 ?? 0,
    sum.le2500 ?? 0,
    sum.le5000 ?? 0,
    sum.leInf ?? 0,
  ];
}

const BOUNDARIES = [...LATENCY_BUCKETS_MS];

/** See lib/sre/histogram.ts — a percentile must never exceed the observed max. */
const round = clampQuantile;

export async function redReport(windowMinutes = 60, now = Date.now()): Promise<RedReport> {
  const since = new Date(now - windowMinutes * 60_000);

  const grouped = await prisma.requestMetric.groupBy({
    by: ["route", "method"],
    where: { bucketStart: { gte: since } },
    _sum: {
      count: true,
      errors: true,
      durationSumMs: true,
      le10: true,
      le25: true,
      le50: true,
      le100: true,
      le250: true,
      le500: true,
      le1000: true,
      le2500: true,
      le5000: true,
      leInf: true,
    },
    _max: { durationMaxMs: true },
  });

  const routes: RouteReport[] = grouped
    .map((row) => {
      const requests = row._sum.count ?? 0;
      const errors = row._sum.errors ?? 0;
      const buckets = bucketsOf(row._sum);
      const durationSum = row._sum.durationSumMs ?? 0;
      const maxMs = row._max.durationMaxMs ?? 0;

      return {
        route: row.route,
        method: row.method,
        requests,
        rate: requests / windowMinutes,
        errors,
        errorRate: requests === 0 ? 0 : errors / requests,
        p50: round(histogramQuantile(buckets, BOUNDARIES, 0.5), maxMs),
        p95: round(histogramQuantile(buckets, BOUNDARIES, 0.95), maxMs),
        p99: round(histogramQuantile(buckets, BOUNDARIES, 0.99), maxMs),
        maxMs,
        meanMs: requests === 0 ? null : Math.round(durationSum / requests),
      };
    })
    // Busiest first: the route with the most traffic is the one whose latency
    // describes the site, and sorting by error rate would put a single failed
    // request on a dead route at the top of the page forever.
    .sort((a, b) => b.requests - a.requests);

  // Totals come from their own aggregate rather than from summing `routes`,
  // because percentiles do not add: averaging four routes' p95 is not the p95.
  // The buckets do add, so the total histogram is re-summed from scratch.
  const overall = await prisma.requestMetric.aggregate({
    where: { bucketStart: { gte: since } },
    _sum: {
      count: true,
      errors: true,
      le10: true,
      le25: true,
      le50: true,
      le100: true,
      le250: true,
      le500: true,
      le1000: true,
      le2500: true,
      le5000: true,
      leInf: true,
    },
    _max: { durationMaxMs: true },
  });

  const instanceRows = await prisma.requestMetric.findMany({
    where: { bucketStart: { gte: since } },
    select: { instance: true },
    distinct: ["instance"],
  });

  const totalRequests = overall._sum.count ?? 0;
  const totalErrors = overall._sum.errors ?? 0;
  const totalBuckets = bucketsOf(overall._sum);
  const overallMax = overall._max.durationMaxMs ?? 0;

  return {
    windowMinutes,
    since,
    routes,
    totals: {
      requests: totalRequests,
      errors: totalErrors,
      errorRate: totalRequests === 0 ? 0 : totalErrors / totalRequests,
      rate: totalRequests / windowMinutes,
      p50: round(histogramQuantile(totalBuckets, BOUNDARIES, 0.5), overallMax),
      p95: round(histogramQuantile(totalBuckets, BOUNDARIES, 0.95), overallMax),
      p99: round(histogramQuantile(totalBuckets, BOUNDARIES, 0.99), overallMax),
    },
    instances: instanceRows.length,
    empty: totalRequests === 0,
  };
}

export interface MinutePoint {
  at: Date;
  requests: number;
  errors: number;
}

/**
 * Per-minute totals, for the sparkline.
 *
 * Gaps are filled with zeros rather than left out. A chart that skips the
 * minutes with no traffic silently compresses the x-axis and turns an outage —
 * which looks exactly like "no rows" — into a flat healthy line.
 */
export async function redSeries(windowMinutes = 60, now = Date.now()): Promise<MinutePoint[]> {
  const since = new Date(Math.floor((now - windowMinutes * 60_000) / 60_000) * 60_000);

  const grouped = await prisma.requestMetric.groupBy({
    by: ["bucketStart"],
    where: { bucketStart: { gte: since } },
    _sum: { count: true, errors: true },
  });

  const byMinute = new Map(
    grouped.map((row) => [
      row.bucketStart.getTime(),
      { requests: row._sum.count ?? 0, errors: row._sum.errors ?? 0 },
    ]),
  );

  const points: MinutePoint[] = [];
  for (let index = 0; index < windowMinutes; index += 1) {
    const at = new Date(since.getTime() + index * 60_000);
    const found = byMinute.get(at.getTime());
    points.push({ at, requests: found?.requests ?? 0, errors: found?.errors ?? 0 });
  }
  return points;
}

export interface CumulativeSeries {
  route: string;
  method: string;
  statusClass: string;
  requests: number;
  errors: number;
  durationSumMs: number;
  /** Cumulative buckets in LATENCY_BUCKETS_MS order, then +Inf. */
  buckets: SummedBuckets;
}

/**
 * Totals over every retained row, for the Prometheus exposition.
 *
 * **Why this is legitimately a counter and not a windowed gauge.** A Prometheus
 * counter must only increase, and the retention sweep in
 * /api/cron/prune-analytics deletes old rows, so this number does drop —
 * roughly once a day, by whatever fell out of the window.
 *
 * That is a *counter reset*, which is a case `rate()` and `increase()` are
 * explicitly built to detect and correct for: it is indistinguishable from a
 * process restarting, which is the ordinary thing that happens to every counter
 * in every deployment. So the type is honest. What would not be honest is
 * exposing a 60-minute rolling sum under the same name — that decreases
 * continuously rather than at a reset, and `rate()` would read every downward
 * step as a reset and silently discard the interval.
 */
export async function redCumulative(): Promise<CumulativeSeries[]> {
  const grouped = await prisma.requestMetric.groupBy({
    by: ["route", "method", "statusClass"],
    _sum: {
      count: true,
      errors: true,
      durationSumMs: true,
      le10: true,
      le25: true,
      le50: true,
      le100: true,
      le250: true,
      le500: true,
      le1000: true,
      le2500: true,
      le5000: true,
      leInf: true,
    },
  });

  return grouped.map((row) => ({
    route: row.route,
    method: row.method,
    statusClass: row.statusClass,
    requests: row._sum.count ?? 0,
    errors: row._sum.errors ?? 0,
    durationSumMs: row._sum.durationSumMs ?? 0,
    buckets: bucketsOf(row._sum),
  }));
}

export interface TransitionRow {
  id: string;
  target: string;
  from: string;
  to: string;
  failures: number;
  samples: number;
  reason: string;
  createdAt: Date;
}

export async function breakerHistory(limit = 20): Promise<TransitionRow[]> {
  return prisma.breakerTransition.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
