import { prisma } from "../prisma";
import { countryFlag, countryName } from "./geo";
import { COUNTER_KIND } from "./collect";
import { GRID_X, GRID_Y, HEATMAP_DEVICES } from "./constants";

/**
 * P10 — the read side.
 *
 * This is the blueprint's CQRS split applied honestly: the ingest path writes
 * a ledger and never reads it back, and everything below reads and never
 * writes. Aggregation happens in Postgres via `groupBy` rather than by pulling
 * rows into the app, which is what the materialised `day` column on PageView
 * exists to make possible.
 *
 * Nothing here is wrapped in `readOrFallback`. That wrapper is for *public*
 * read paths, where an empty section beats a 500; an admin dashboard silently
 * rendering zeroes because the database is down is worse than an error page,
 * because it looks exactly like "nobody visited".
 */

export interface DailyPoint {
  date: string;
  views: number;
  uniques: number;
}

export interface PageRow {
  path: string;
  views: number;
  avgDurationMs: number;
  avgScroll: number;
}

export interface CountryRow {
  code: string | null;
  name: string;
  flag: string;
  views: number;
}

export interface CounterRow {
  key: string;
  label: string;
  total: number;
  uniqueTotal: number;
  lastAt: Date;
}

export interface FrictionRow {
  path: string;
  target: string;
  count: number;
}

export interface SiteAnalytics {
  days: number;
  totalViews: number;
  uniqueVisitors: number;
  avgDurationMs: number;
  avgScroll: number;
  totalDownloads: number;
  daily: DailyPoint[];
  pages: PageRow[];
  countries: CountryRow[];
  devices: { device: string; count: number }[];
  referrers: { source: string; count: number }[];
  downloads: CounterRow[];
  outbound: CounterRow[];
  elements: CounterRow[];
  friction: FrictionRow[];
}

/** UTC day keys for the window, oldest first — the x-axis, gaps included. */
function dayKeys(days: number): string[] {
  const keys: string[] = [];
  const today = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(today - i * 86_400_000).toISOString().slice(0, 10));
  }
  return keys;
}

/** `_avg` is null when the group is empty; every average here is a whole number. */
function avg(value: number | null | undefined): number {
  return Math.round(value ?? 0);
}

export async function getSiteAnalytics(days = 30): Promise<SiteAnalytics> {
  const keys = dayKeys(days);
  const since = new Date(`${keys[0]}T00:00:00.000Z`);
  const window = { createdAt: { gte: since } };

  const [
    totalViews,
    uniqueVisitors,
    averages,
    viewsPerDay,
    uniquesPerDay,
    pages,
    countries,
    devices,
    referrers,
    counters,
    friction,
  ] = await Promise.all([
    prisma.pageView.count({ where: window }),
    prisma.pageView.count({ where: { ...window, isUnique: true } }),
    prisma.pageView.aggregate({
      where: window,
      _avg: { durationMs: true, scrollDepth: true },
    }),
    prisma.pageView.groupBy({ by: ["day"], where: window, _count: { _all: true } }),
    prisma.pageView.groupBy({
      by: ["day"],
      where: { ...window, isUnique: true },
      _count: { _all: true },
    }),
    prisma.pageView.groupBy({
      by: ["path"],
      where: window,
      _count: { _all: true },
      _avg: { durationMs: true, scrollDepth: true },
      orderBy: { _count: { path: "desc" } },
      take: 12,
    }),
    prisma.pageView.groupBy({
      by: ["country"],
      where: window,
      _count: { _all: true },
      orderBy: { _count: { country: "desc" } },
      take: 12,
    }),
    prisma.pageView.groupBy({ by: ["device"], where: window, _count: { _all: true } }),
    prisma.pageView.groupBy({
      by: ["referrerHost"],
      where: { ...window, referrerHost: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { referrerHost: "desc" } },
      take: 8,
    }),
    // Counters are all-time by design. "How many people have ever taken my
    // résumé" is the question worth asking; scoping it to a 30-day window
    // would make the headline number shrink every time the window moved.
    prisma.analyticsCounter.findMany({ orderBy: { total: "desc" }, take: 60 }),
    prisma.analyticsEvent.groupBy({
      by: ["path", "target"],
      where: { ...window, type: "RAGE" },
      _count: { _all: true },
      orderBy: { _count: { target: "desc" } },
      take: 8,
    }),
  ]);

  const viewsByDay = new Map(viewsPerDay.map((row) => [row.day, row._count._all]));
  const uniquesByDay = new Map(uniquesPerDay.map((row) => [row.day, row._count._all]));

  const byKind = (kind: string): CounterRow[] =>
    counters
      .filter((counter) => counter.kind === kind)
      .map((counter) => ({
        key: counter.key,
        label: counter.label,
        total: counter.total,
        uniqueTotal: counter.uniqueTotal,
        lastAt: counter.lastAt,
      }));

  const downloads = byKind(COUNTER_KIND.download);

  return {
    days,
    totalViews,
    uniqueVisitors,
    avgDurationMs: avg(averages._avg.durationMs),
    avgScroll: avg(averages._avg.scrollDepth),
    totalDownloads: downloads.reduce((sum, row) => sum + row.total, 0),
    daily: keys.map((date) => ({
      date,
      views: viewsByDay.get(date) ?? 0,
      uniques: uniquesByDay.get(date) ?? 0,
    })),
    pages: pages.map((row) => ({
      path: row.path,
      views: row._count._all,
      avgDurationMs: avg(row._avg.durationMs),
      avgScroll: avg(row._avg.scrollDepth),
    })),
    countries: countries.map((row) => ({
      code: row.country,
      name: countryName(row.country),
      flag: countryFlag(row.country),
      views: row._count._all,
    })),
    devices: devices
      .map((row) => ({ device: row.device, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    referrers: referrers.map((row) => ({
      source: row.referrerHost ?? "direct",
      count: row._count._all,
    })),
    downloads,
    outbound: byKind(COUNTER_KIND.outbound),
    elements: byKind(COUNTER_KIND.element),
    friction: friction.map((row) => ({
      path: row.path,
      target: row.target,
      count: row._count._all,
    })),
  };
}

export interface HeatmapCellPoint {
  x: number;
  y: number;
  count: number;
}

export interface HeatmapData {
  path: string;
  device: string;
  gridX: number;
  gridY: number;
  max: number;
  total: number;
  cells: HeatmapCellPoint[];
}

/** Which (path, device) pairs actually have a map worth opening. */
export interface HeatmapTarget {
  path: string;
  device: string;
  clicks: number;
}

export async function getHeatmapTargets(): Promise<HeatmapTarget[]> {
  const rows = await prisma.heatmapCell.groupBy({
    by: ["path", "device"],
    _sum: { count: true },
    orderBy: { _sum: { count: "desc" } },
    take: 40,
  });
  return rows.map((row) => ({
    path: row.path,
    device: row.device,
    clicks: row._sum.count ?? 0,
  }));
}

export async function getHeatmap(path: string, device: string): Promise<HeatmapData> {
  // The grid is bounded at GRID_X * GRID_Y cells, so this is a whole-map read
  // with a hard ceiling rather than an unbounded query.
  const cells = await prisma.heatmapCell.findMany({
    where: { path, device },
    select: { x: true, y: true, count: true },
    take: GRID_X * GRID_Y,
  });

  return {
    path,
    device,
    gridX: GRID_X,
    gridY: GRID_Y,
    max: Math.max(1, ...cells.map((cell) => cell.count)),
    total: cells.reduce((sum, cell) => sum + cell.count, 0),
    cells,
  };
}

/** Guard for a device value arriving from a query string. */
export function isHeatmapDevice(value: string): boolean {
  return (HEATMAP_DEVICES as readonly string[]).includes(value);
}
