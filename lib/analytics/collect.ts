import { prisma } from "../prisma";
import { deviceFrom, visitorHashFor } from "../growth/links";
import type { GeoContext } from "./geo";
import type { CollectPayload } from "../validations/analytics";
import {
  clampCell,
  clampDepth,
  clampDuration,
  isExcludedPath,
  normalizePath,
  refererHost,
  sanitizeLabel,
  sanitizeTarget,
} from "./normalize";

/**
 * P10 — the write side.
 *
 * Everything here is called from `after()`, off the response path, and
 * **nothing here throws**. A visitor must never be able to tell that analytics
 * exists, let alone that it failed — the browser has already received its 204
 * by the time any of this runs.
 *
 * The visitor pseudonym and device classifier are P8's, reused rather than
 * reimplemented. That is not just DRY: it means a person shows up as the same
 * `visitorHash` in the referral ledger and the page-view ledger on the same
 * day, so a click on a short link and the visit it produced can be lined up —
 * and it means there is exactly one place where the privacy properties of that
 * hash are defined, instead of two that can drift apart.
 */

const EVENT_TYPES = {
  click: "CLICK",
  download: "DOWNLOAD",
  outbound: "OUTBOUND",
  rage: "RAGE",
} as const;

export interface RequestContext {
  ip: string;
  userAgent: string;
  geo: GeoContext;
  /** Our own hostname, so a same-site navigation isn't logged as a referral. */
  selfHost: string | null;
}

/** Counter kinds, kept as constants so the reader and writer cannot drift. */
export const COUNTER_KIND = {
  download: "download",
  outbound: "outbound",
  element: "element",
} as const;

function counterKindFor(type: keyof typeof EVENT_TYPES): string | null {
  if (type === "download") return COUNTER_KIND.download;
  if (type === "outbound") return COUNTER_KIND.outbound;
  if (type === "click") return COUNTER_KIND.element;
  // Rage clicks are a friction signal, not a tally worth ranking — they stay
  // in the ledger and are read from there.
  return null;
}

/**
 * Record one beacon.
 *
 * Returns quietly on anything malformed. The caller has already validated
 * shape; this re-derives every stored value from scratch anyway, because
 * "the schema accepted it" and "this is safe to store" are different claims.
 */
export async function recordVisit(payload: CollectPayload, context: RequestContext): Promise<void> {
  try {
    const path = normalizePath(payload.path);
    if (isExcludedPath(path)) return;

    const device = deviceFrom(context.userAgent);
    const visitorHash = visitorHashFor(context.ip, context.userAgent);
    const durationMs = clampDuration(payload.durationMs);
    const scrollDepth = clampDepth(payload.scrollDepth);

    await upsertPageView({
      viewId: payload.viewId,
      path,
      referrerHost: refererHost(payload.referrer, context.selfHost),
      device,
      geo: context.geo,
      browserTimezone: payload.timezone ?? null,
      visitorHash,
      durationMs,
      scrollDepth,
    });

    await Promise.all([
      recordCells(path, device, payload.cells ?? []),
      recordEvents(path, device, visitorHash, context.geo.country, payload.events ?? []),
    ]);
  } catch (error) {
    console.error("[analytics] recordVisit failed:", error);
  }
}

interface PageViewInput {
  viewId: string;
  path: string;
  referrerHost: string | null;
  device: string;
  geo: GeoContext;
  browserTimezone: string | null;
  visitorHash: string;
  durationMs: number;
  scrollDepth: number;
}

async function upsertPageView(input: PageViewInput): Promise<void> {
  const existing = await prisma.pageView.findUnique({
    where: { viewId: input.viewId },
    select: { id: true },
  });

  if (!existing) {
    // "First view by this visitor" — and because the hash already has the UTC
    // date mixed in, a bare existence check *is* a same-day check. No date
    // predicate is needed and yesterday's rows can never match.
    const seen = await prisma.pageView.findFirst({
      where: { visitorHash: input.visitorHash },
      select: { id: true },
    });

    try {
      await prisma.pageView.create({
        data: {
          viewId: input.viewId,
          path: input.path,
          referrerHost: input.referrerHost,
          device: input.device,
          country: input.geo.country,
          region: input.geo.region,
          city: input.geo.city,
          // Prefer what the edge resolved; fall back to what the browser
          // reports. The browser's zone is self-declared and trivially
          // spoofed, which is fine for a coarse "when are people reading
          // this" and is why it is only ever the fallback.
          timezone: input.geo.timezone ?? input.browserTimezone,
          visitorHash: input.visitorHash,
          isUnique: !seen,
          // Same UTC day the visitor hash is salted with, so the two always
          // agree about which day a view belongs to.
          day: new Date().toISOString().slice(0, 10),
          durationMs: input.durationMs,
          scrollDepth: input.scrollDepth,
        },
      });
      return;
    } catch {
      // Lost the race with a concurrent beacon for the same view. The row now
      // exists, so fall through and treat this as an update.
    }
  }

  // Engagement is monotonic. Both columns are cumulative counters held by the
  // browser, so a beacon can only ever report *more* — but beacons arrive out
  // of order (a periodic flush can land after the pagehide one on a slow
  // connection), and applying a stale one unconditionally would rewrite a
  // 90%-scrolled, two-minute read as a bounce. Guarding in the WHERE clause
  // makes the update a no-op instead, without a read-modify-write race.
  await prisma.$transaction([
    prisma.pageView.updateMany({
      where: { viewId: input.viewId, durationMs: { lt: input.durationMs } },
      data: { durationMs: input.durationMs },
    }),
    prisma.pageView.updateMany({
      where: { viewId: input.viewId, scrollDepth: { lt: input.scrollDepth } },
      data: { scrollDepth: input.scrollDepth },
    }),
  ]);
}

/**
 * Fold this batch's cells into the sparse grid.
 *
 * Upserts rather than inserts: a cell row is created the first time anyone
 * clicks there and only ever incremented afterwards, which is what keeps the
 * table's size proportional to *where people actually click* rather than to
 * how much traffic the site gets.
 */
async function recordCells(
  path: string,
  device: string,
  cells: NonNullable<CollectPayload["cells"]>,
): Promise<void> {
  if (cells.length === 0) return;
  // Bots inflate nothing here — they don't run the tracker — but a UA string
  // claiming to be one would otherwise get its own heatmap layer nobody reads.
  if (device === "bot" || device === "unknown") return;

  // Merge duplicates before writing. The client already aggregates, but two
  // entries for one cell in a single payload would otherwise become two
  // upserts against the same unique key inside one transaction.
  const merged = new Map<string, { x: number; y: number; n: number }>();
  for (const cell of cells) {
    const { x, y } = clampCell(cell.x, cell.y);
    const key = `${x},${y}`;
    const found = merged.get(key);
    if (found) found.n += cell.n;
    else merged.set(key, { x, y, n: cell.n });
  }

  await prisma.$transaction(
    [...merged.values()].map((cell) =>
      prisma.heatmapCell.upsert({
        where: { path_device_x_y: { path, device, x: cell.x, y: cell.y } },
        create: { path, device, x: cell.x, y: cell.y, count: cell.n },
        update: { count: { increment: cell.n } },
      }),
    ),
  );
}

async function recordEvents(
  viewPath: string,
  device: string,
  visitorHash: string,
  country: string | null,
  events: NonNullable<CollectPayload["events"]>,
): Promise<void> {
  if (events.length === 0) return;

  const rows = events.flatMap((event) => {
    const target = sanitizeTarget(event.target);
    if (!target) return [];
    return [
      {
        type: EVENT_TYPES[event.type],
        path: event.path ? normalizePath(event.path) : viewPath,
        target,
        label: sanitizeLabel(event.label),
        device,
        country,
        visitorHash,
      },
    ];
  });
  if (rows.length === 0) return;

  // One counter per distinct (kind, key) in the batch — so ten clicks on the
  // same button are one upsert carrying +10, not ten upserts contending for
  // the same row.
  const counters = new Map<string, { kind: string; key: string; label: string; total: number }>();
  for (const event of events) {
    const kind = counterKindFor(event.type);
    if (!kind) continue;
    const target = sanitizeTarget(event.target);
    if (!target) continue;
    const id = `${kind}|${target}`;
    const found = counters.get(id);
    if (found) found.total += 1;
    else counters.set(id, { kind, key: target, label: sanitizeLabel(event.label) ?? "", total: 1 });
  }

  // Uniqueness has to be decided BEFORE the ledger rows land, or every event
  // would find its own freshly-written row and count as a repeat. Same
  // same-day semantics as isUnique above, for the same reason.
  const firstToday = await Promise.all(
    [...counters.entries()].map(async ([id, counter]) => {
      const seen = await prisma.analyticsEvent.findFirst({
        where: { target: counter.key, visitorHash },
        select: { id: true },
      });
      return [id, !seen] as [string, boolean];
    }),
  );
  const isFirst = new Map<string, boolean>(firstToday);

  await prisma.analyticsEvent.createMany({ data: rows });

  await prisma.$transaction(
    [...counters.entries()].map(([id, counter]) =>
      prisma.analyticsCounter.upsert({
        where: { kind_key: { kind: counter.kind, key: counter.key } },
        create: {
          kind: counter.kind,
          key: counter.key,
          label: counter.label,
          total: counter.total,
          uniqueTotal: isFirst.get(id) ? 1 : 0,
        },
        update: {
          total: { increment: counter.total },
          uniqueTotal: isFirst.get(id) ? { increment: 1 } : undefined,
          lastAt: new Date(),
          // Only fill a label in; never blank an existing one because this
          // particular batch happened not to carry it.
          label: counter.label || undefined,
        },
      }),
    ),
  );
}

/**
 * Server-side download record, used by `/d/<slug>`.
 *
 * This exists as a separate path from the browser beacon on purpose: a
 * download counted only by client JavaScript is a download that any content
 * blocker, any `Save link as…`, and any visitor with scripting off makes
 * invisible. The redirect route sees every one of them, so this is the number
 * that is actually true. Never throws — a broken counter must not cost anyone
 * their file.
 */
export async function recordDownload(
  slug: string,
  label: string,
  context: RequestContext,
  path = "/d",
): Promise<void> {
  try {
    const key = sanitizeTarget(slug);
    if (!key) return;

    const device = deviceFrom(context.userAgent);
    // Crawlers and link-preview fetchers follow this redirect too, and unlike
    // a page view a download is a headline number — "47 people took my
    // résumé" has to mean 47 people. Bots are dropped rather than recorded
    // and filtered later, because a counter that has to be mentally adjusted
    // before it can be trusted is not a counter.
    if (device === "bot") return;

    const visitorHash = visitorHashFor(context.ip, context.userAgent);

    const seen = await prisma.analyticsEvent.findFirst({
      where: { target: key, type: "DOWNLOAD", visitorHash },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.analyticsEvent.create({
        data: {
          type: "DOWNLOAD",
          path,
          target: key,
          label: sanitizeLabel(label),
          device,
          country: context.geo.country,
          visitorHash,
        },
      }),
      prisma.analyticsCounter.upsert({
        where: { kind_key: { kind: COUNTER_KIND.download, key } },
        create: {
          kind: COUNTER_KIND.download,
          key,
          label,
          total: 1,
          uniqueTotal: seen ? 0 : 1,
        },
        update: {
          total: { increment: 1 },
          uniqueTotal: seen ? undefined : { increment: 1 },
          lastAt: new Date(),
        },
      }),
    ]);
  } catch (error) {
    console.error("[analytics] recordDownload failed:", error);
  }
}
