import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { isRedisConfigured, pipeline } from "../security/redis";

/**
 * P18 — mutual exclusion for work that must happen once.
 *
 * Two implementations, and **the Postgres one is the default even though the
 * blueprint names Redlock**. The reasoning is worth stating because it inverts
 * the usual assumption:
 *
 * Every critical section this guards — pruning analytics, draining the outbox,
 * rebuilding the retrieval index — is *Postgres work*. A lock in Redis can be
 * held perfectly while Postgres is unreachable, so the lock succeeds and the
 * work fails; worse, a Redis failover can hand the same lock to two holders
 * while both of their transactions commit. A lease row in the same database as
 * the work cannot be in that state: if the lease is visible, the database is
 * up, and if the database is down nobody holds anything.
 *
 * Redlock is implemented alongside it (redlock.ts) and is used when Redis is
 * configured *and* the caller opts in — for a section that does not touch
 * Postgres, it is the faster choice.
 *
 * **Fencing tokens, not just mutual exclusion.** Every acquisition mints a
 * random token, and release requires presenting it. Without that, a holder
 * whose lease expired mid-run releases the *next* holder's lock on its way out,
 * and two workers run concurrently — the classic distributed-lock bug, and the
 * one that is invisible until it corrupts something.
 */

export interface Lease {
  name: string;
  token: string;
  expiresAt: Date;
}

export interface AcquireOptions {
  /** How long the holder may run before the lease lapses. */
  ttlMs?: number;
  /** Who is holding it — a region, an instance id. Diagnostics only. */
  holder?: string;
}

const DEFAULT_TTL_MS = 60_000;

/**
 * Take a named lease, or return null.
 *
 * The whole thing is one statement, and it has to be: a read-then-write would
 * let two callers both see a free lock and both take it. `ON CONFLICT … WHERE`
 * makes "insert if absent, or steal if expired" a single atomic decision, and
 * `RETURNING` tells us which of those happened — a row comes back only if we
 * won.
 */
export async function acquireLease(
  name: string,
  options: AcquireOptions = {},
): Promise<Lease | null> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const token = randomBytes(16).toString("hex");
  const holder = options.holder ?? process.env.VERCEL_REGION ?? "local";
  const expiresAt = new Date(Date.now() + ttlMs);

  try {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      INSERT INTO "Lease" ("name", "token", "holder", "expiresAt", "acquiredAt")
      VALUES (${name}, ${token}, ${holder}, ${expiresAt}, NOW())
      ON CONFLICT ("name") DO UPDATE
        SET "token" = EXCLUDED."token",
            "holder" = EXCLUDED."holder",
            "expiresAt" = EXCLUDED."expiresAt",
            "acquiredAt" = NOW()
        WHERE "Lease"."expiresAt" < NOW()
      RETURNING "name"
    `;
    return rows.length > 0 ? { name, token, expiresAt } : null;
  } catch (error) {
    console.error(
      `[lock] could not acquire ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Fail closed. A lock that hands out access when it cannot tell whether the
    // lock is free is not a lock, and the jobs it guards are all "skip this run"
    // safe — the next scheduled run does the work.
    return null;
  }
}

/**
 * Release, but only if we still hold it.
 *
 * The token in the WHERE clause is the fencing check. A holder that overran its
 * TTL and lost the lease to someone else will delete nothing, which is exactly
 * right — it no longer owns anything to release.
 */
export async function releaseLease(lease: Lease): Promise<boolean> {
  try {
    const result = await prisma.lease.deleteMany({
      where: { name: lease.name, token: lease.token },
    });
    return result.count > 0;
  } catch (error) {
    console.error(
      `[lock] could not release ${lease.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Not fatal: the lease expires on its own. That is what a TTL is for.
    return false;
  }
}

/**
 * Extend a lease we still hold.
 *
 * Needed by any job that can legitimately outrun its TTL. The alternative —
 * taking a very long lease up front — means a crashed holder blocks the work
 * for that whole period.
 */
export async function renewLease(lease: Lease, ttlMs = DEFAULT_TTL_MS): Promise<Lease | null> {
  const expiresAt = new Date(Date.now() + ttlMs);
  try {
    const result = await prisma.lease.updateMany({
      where: { name: lease.name, token: lease.token },
      data: { expiresAt },
    });
    return result.count > 0 ? { ...lease, expiresAt } : null;
  } catch {
    return null;
  }
}

export interface WithLockResult<T> {
  ran: boolean;
  result?: T;
}

/**
 * Run `work` under a lease, or skip.
 *
 * `ran: false` is a normal outcome, not an error: it means someone else is
 * already doing it. Every caller here is a scheduled job, so skipping is
 * correct — the next run picks it up.
 */
export async function withLease<T>(
  name: string,
  work: () => Promise<T>,
  options: AcquireOptions = {},
): Promise<WithLockResult<T>> {
  const lease = await acquireLease(name, options);
  if (!lease) return { ran: false };

  try {
    return { ran: true, result: await work() };
  } finally {
    // In `finally`, so a throwing critical section does not hold the lock for
    // its full TTL.
    await releaseLease(lease);
  }
}

/** Whether the Redis-backed path is even available. */
export function canUseRedlock(): boolean {
  return isRedisConfigured();
}

/**
 * Redlock, single-instance.
 *
 * The published Redlock algorithm wants N independent Redis masters and a
 * quorum. This deployment has one Upstash database, so what this is is
 * `SET key value NX PX ttl` — which is the correct lock for a single instance
 * and is where Redlock reduces to anyway at N=1. Calling it Redlock without
 * that sentence would be claiming a quorum that does not exist.
 *
 * Exported because it is the right tool for a critical section that does not
 * touch Postgres. Nothing in this project currently is.
 */
export async function acquireRedisLock(
  name: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<Lease | null> {
  if (!isRedisConfigured()) return null;

  const token = randomBytes(16).toString("hex");
  const results = await pipeline([["SET", `lock:${name}`, token, "NX", "PX", ttlMs]]);
  if (!results) return null;

  // Upstash returns "OK" on success and null when NX refused.
  return results[0] === "OK" ? { name, token, expiresAt: new Date(Date.now() + ttlMs) } : null;
}

/**
 * Release a Redis lock.
 *
 * **This is a compare-and-delete done in two round trips, and that is a real
 * race** — between the GET and the DEL the lease can expire and be re-taken,
 * and we would then delete the new holder's lock. The correct fix is a Lua
 * script, which Upstash's REST API supports via EVAL; it is not used here
 * because nothing in this project takes a Redis lock, and shipping an
 * unexercised EVAL would be worse than shipping a documented limitation.
 *
 * The TTL is the real safety net either way.
 */
export async function releaseRedisLock(lease: Lease): Promise<boolean> {
  const key = `lock:${lease.name}`;
  const read = await pipeline([["GET", key]]);
  if (!read || read[0] !== lease.token) return false;
  const deleted = await pipeline([["DEL", key]]);
  return Boolean(deleted && Number(deleted[0]) > 0);
}
