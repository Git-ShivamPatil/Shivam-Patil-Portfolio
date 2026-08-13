import { prisma } from "../prisma";

/**
 * P20 — the ETL job, and why it is ELT.
 *
 * The blueprint says "ETL/ELT". What this actually is is **ELT**, and the
 * distinction is the design: the raw events are already loaded (P10 writes them
 * as they arrive), so there is nothing to extract-then-load. The transform runs
 * *after* the load, over data that is already in the warehouse — which is the
 * whole reason ELT displaced ETL once storage got cheap. Transforming on the
 * way in throws away the rows you did not know you would need.
 *
 * The output is a columnar-ish JSON export the browser can query with DuckDB.
 * Not Parquet, and that is a real trade rather than an oversight: writing
 * Parquet needs a writer library (~2MB, or a native binding) on a serverless
 * function, to serve a few thousand rows that gzip to a handful of kilobytes.
 * DuckDB-WASM reads JSON natively. At a hundred times this size Parquet's
 * column pruning and predicate pushdown would start to matter and that trade
 * flips — which is stated on the page rather than left as an implied claim that
 * this is what a real warehouse looks like.
 *
 * **Nothing here is per-visitor.** The export is aggregated by day, path,
 * country and device before it leaves the database, so the file a browser
 * downloads has no row that corresponds to a person. That is not a nicety: this
 * is a public endpoint, and P10's whole privacy stance would be undone by
 * publishing the ledger it was careful not to keep.
 */

export interface DailyFact {
  day: string;
  path: string;
  device: string;
  country: string | null;
  views: number;
  uniques: number;
  avgDurationMs: number;
  avgScroll: number;
}

export interface EventFact {
  day: string;
  type: string;
  target: string;
  device: string;
  events: number;
}

export interface Warehouse {
  generatedAt: string;
  /** The window covered, in days. */
  windowDays: number;
  facts: DailyFact[];
  events: EventFact[];
  /** Row counts, so the page can state what it is querying. */
  rows: { facts: number; events: number };
}

/** Matches the analytics retention window — exporting beyond it is inventing data. */
export const WINDOW_DAYS = 180;

/**
 * Build the export.
 *
 * Grouped in Postgres rather than pulled into the app and reduced in
 * JavaScript, for the reason P10 already established: the cost has to track the
 * number of distinct groups, not the volume of traffic. The `day` column exists
 * precisely so this can be a plain indexed groupBy.
 */
export async function buildWarehouse(now = Date.now()): Promise<Warehouse> {
  const since = new Date(now - WINDOW_DAYS * 86_400_000);

  const [pageRows, uniqueRows, eventRows] = await Promise.all([
    prisma.pageView.groupBy({
      by: ["day", "path", "device", "country"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { durationMs: true, scrollDepth: true },
    }),
    // Uniques cannot be summed out of the grouped counts above — a visitor seen
    // on two paths is one unique visitor and two rows — so they are counted
    // separately on the same grouping keys.
    prisma.pageView.groupBy({
      by: ["day", "path", "device", "country"],
      where: { createdAt: { gte: since }, isUnique: true },
      _count: { _all: true },
    }),
    prisma.analyticsEvent.groupBy({
      by: ["type", "target", "device"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const uniqueByKey = new Map(
    uniqueRows.map((row) => [`${row.day}|${row.path}|${row.device}|${row.country ?? ""}`, row._count._all]),
  );

  const facts: DailyFact[] = pageRows.map((row) => ({
    day: row.day,
    path: row.path,
    device: row.device,
    country: row.country,
    views: row._count._all,
    uniques: uniqueByKey.get(`${row.day}|${row.path}|${row.device}|${row.country ?? ""}`) ?? 0,
    avgDurationMs: Math.round(row._avg.durationMs ?? 0),
    avgScroll: Math.round(row._avg.scrollDepth ?? 0),
  }));

  // AnalyticsEvent has no materialised `day`, so the export uses the window as
  // a whole for events. Grouping them by day would mean either a raw
  // date_trunc query or pulling every row into the app — and the events table
  // is the one that grows fastest.
  const events: EventFact[] = eventRows.map((row) => ({
    day: "window",
    type: row.type,
    target: row.target,
    device: row.device,
    events: row._count._all,
  }));

  return {
    generatedAt: new Date(now).toISOString(),
    windowDays: WINDOW_DAYS,
    facts,
    events,
    rows: { facts: facts.length, events: events.length },
  };
}

/* ----------------------------------------------------- stream windows ---- */

export interface WindowPoint {
  /** Start of the window, ISO. */
  start: string;
  count: number;
}

/**
 * Tumbling-window aggregation over the event ledger.
 *
 * The blueprint names Flink. There is no stream processor here and there cannot
 * be one — a Flink job is a long-running process with checkpointed state, and
 * this runs on functions that live for seconds. What is genuinely available is
 * the *semantics*: fixed, non-overlapping windows over an ordered event stream,
 * computed on read.
 *
 * That is a real difference and it is worth naming rather than blurring: a true
 * streaming engine computes incrementally and holds state between events, so it
 * can answer in constant time regardless of history and can handle late
 * arrivals with watermarks. This recomputes from the ledger each time, which is
 * correct and gets slower as the ledger grows. At this size, correct-and-simple
 * wins; the shape is the same, and where it stops being enough is stated.
 */
export function tumblingWindows(
  timestamps: number[],
  windowMs: number,
  now: number,
  windows: number,
): WindowPoint[] {
  const points: WindowPoint[] = [];
  // Aligned to the epoch rather than to `now`, so consecutive calls produce the
  // same boundaries. Windows that shift under you make two readings
  // incomparable, which is the most common way a "real-time" chart lies.
  const currentStart = Math.floor(now / windowMs) * windowMs;

  for (let index = windows - 1; index >= 0; index--) {
    const start = currentStart - index * windowMs;
    const end = start + windowMs;
    points.push({
      start: new Date(start).toISOString(),
      count: timestamps.filter((time) => time >= start && time < end).length,
    });
  }
  return points;
}

/**
 * Event timestamps in the recent past, plus the clock they were read against.
 *
 * The reference time is returned rather than left for the caller to ask for,
 * because the caller is a server component and reading the clock in a render
 * body is an impure call the compiler rules reject — and rightly: a component
 * whose output depends on when React happened to render it is not a function of
 * its props. Reading it here, once, alongside the query it belongs to, is both
 * the correct place and the one that makes the windows line up with the data.
 */
export async function recentEventTimes(
  now = Date.now(),
  minutes = 120,
): Promise<{ times: number[]; now: number }> {
  const rows = await prisma.analyticsEvent.findMany({
    where: { createdAt: { gte: new Date(now - minutes * 60_000) } },
    select: { createdAt: true },
    // Bounded: this is the fastest-growing table, and an unbounded read of it
    // is the kind of query that works for a year and then does not.
    take: 5_000,
  });
  return { times: rows.map((row) => row.createdAt.getTime()), now };
}
