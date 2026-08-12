import { prisma } from "../prisma";
import {
  PRESENCE_EXPIRY_MS,
  PRESENCE_TTL_MS,
  type PresenceRole,
  type PresenceSnapshot,
} from "./constants";

/**
 * P11 — presence, the server half.
 *
 * "Who is on the site right now" on a platform where nothing is shared between
 * requests. Every fact here comes from a freshness window over PresenceSession
 * rows rather than from a connection count, because there is no connection to
 * count: the instance serving a heartbeat and the instance rendering the
 * dashboard are different processes, and an SSE stream can be reaped by the
 * platform without either side being told.
 *
 * The ceiling worth stating plainly: presence is correct to within one TTL.
 * Someone who shuts their laptop shows as online for up to PRESENCE_TTL_MS
 * afterwards. That is inherent to a heartbeat model, and it is why the client
 * beats twice per window — one dropped request must not make a present visitor
 * blink out.
 */

export interface TouchInput {
  token: string;
  role: PresenceRole;
  path: string;
  device: string;
  country: string | null;
  userId: string | null;
}

/** The cutoff a row must be newer than to count as present. */
export function freshSince(now = Date.now()): Date {
  return new Date(now - PRESENCE_TTL_MS);
}

/**
 * Record one heartbeat.
 *
 * Upsert on the token, so a tab occupies exactly one row for its whole life no
 * matter how many beats it sends. `startedAt` is set on create only — updating
 * it every beat would reset the visit clock and make every session look zero
 * seconds long.
 */
export async function touchPresence(input: TouchInput): Promise<void> {
  await prisma.presenceSession.upsert({
    where: { token: input.token },
    create: {
      token: input.token,
      role: input.role,
      path: input.path,
      device: input.device,
      country: input.country,
      userId: input.userId,
    },
    update: {
      path: input.path,
      country: input.country,
      lastSeenAt: new Date(),
      // Re-asserted on update because a visitor who signs in as the owner
      // mid-session keeps the same tab token, and their row has to follow.
      role: input.role,
      userId: input.userId,
    },
  });
}

/** Drop a tab immediately, on `pagehide` — better than waiting out the TTL. */
export async function releasePresence(token: string): Promise<void> {
  await prisma.presenceSession.deleteMany({ where: { token } });
}

/**
 * The whole picture in one round trip.
 *
 * Three aggregates rather than a `findMany` plus JavaScript: the dashboard
 * re-reads this every few seconds, so the cost has to track the number of
 * distinct *paths* people are on, not the number of people.
 */
export async function getPresence(now = Date.now()): Promise<PresenceSnapshot> {
  const since = freshSince(now);

  const [ownerCount, byPath, byCountry] = await Promise.all([
    prisma.presenceSession.count({ where: { role: "OWNER", lastSeenAt: { gte: since } } }),
    prisma.presenceSession.groupBy({
      by: ["path"],
      where: { role: "VISITOR", lastSeenAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { path: "desc" } },
      take: 12,
    }),
    prisma.presenceSession.groupBy({
      by: ["country"],
      where: { role: "VISITOR", lastSeenAt: { gte: since }, country: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { country: "desc" } },
      take: 8,
    }),
  ]);

  const paths = byPath.map((row) => ({ path: row.path, count: row._count._all }));

  return {
    ownerOnline: ownerCount > 0,
    // Summed from the grouped counts rather than a fourth query. The groupBy is
    // capped at twelve paths, so this undercounts only when visitors are spread
    // across more than twelve pages at once — at which point the headline
    // number is the least interesting thing on the dashboard.
    visitors: paths.reduce((total, row) => total + row.count, 0),
    paths,
    countries: byCountry.flatMap((row) => (row.country ? [row.country] : [])),
    at: new Date(now).toISOString(),
  };
}

/**
 * Is the owner around?
 *
 * The cheapest presence question and the only one the public chat widget may
 * ask — a visitor learning "three other people are here" publishes other
 * visitors' behaviour, however small, and this site does not make that trade
 * for a badge.
 */
export async function isOwnerOnline(now = Date.now()): Promise<boolean> {
  const count = await prisma.presenceSession.count({
    where: { role: "OWNER", lastSeenAt: { gte: freshSince(now) } },
  });
  return count > 0;
}

/**
 * Delete rows nobody will look at again.
 *
 * Bounded like the analytics prune, for the same reason: an unbounded delete
 * over a table that grows with traffic is a statement timeout, and a timed-out
 * delete rolls back whole — so the job makes no progress while appearing to run.
 */
export async function prunePresence(now = Date.now(), batch = 5_000): Promise<number> {
  const cutoff = new Date(now - PRESENCE_EXPIRY_MS);
  const stale = await prisma.presenceSession.findMany({
    where: { lastSeenAt: { lt: cutoff } },
    select: { id: true },
    take: batch,
  });
  if (stale.length === 0) return 0;
  const result = await prisma.presenceSession.deleteMany({
    where: { id: { in: stale.map((row) => row.id) } },
  });
  return result.count;
}
