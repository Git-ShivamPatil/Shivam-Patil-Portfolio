import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client";

export interface CachedResult<T> {
  data: T;
  fetchedAt: Date;
  /** True when the upstream refresh failed and this is a last-good payload. */
  stale: boolean;
}

/**
 * Read-through TTL cache with stale-on-error fallback, backed by
 * IntegrationCache.
 *
 * The important property is the failure path: when the upstream errors or
 * rate-limits, an expired-but-present row is returned with `stale: true`
 * rather than throwing. Both consumers (GitHub, LeetCode) are decorative
 * stats panels — a slightly old number is strictly better than an error
 * state, and LeetCode's unofficial endpoint throttles serverless IPs often
 * enough that this is the common case, not the edge case.
 *
 * Returns null only when there is no cached payload *and* the fetch failed.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<CachedResult<T> | null> {
  const now = new Date();

  let existing: { payload: Prisma.JsonValue; fetchedAt: Date; expiresAt: Date } | null = null;
  try {
    existing = await prisma.integrationCache.findUnique({ where: { key } });
  } catch (error) {
    // A cache-store outage must not take the fetch path down with it.
    console.error(`[integrations] cache read failed for "${key}":`, error);
  }

  if (existing && existing.expiresAt > now) {
    return { data: existing.payload as T, fetchedAt: existing.fetchedAt, stale: false };
  }

  // Negative caching. Without it, an upstream that is down or rate-limiting
  // gets a fresh request from every single page render — the exact traffic
  // pattern that keeps a 429 window open — and each one pays the full 8s
  // timeout before the page can finish. The tombstone is a separate row so
  // the payload column stays honestly typed as T.
  if (await failureTombstoneActive(key, now)) {
    if (existing) {
      return { data: existing.payload as T, fetchedAt: existing.fetchedAt, stale: true };
    }
    return null;
  }

  try {
    const fresh = await fetcher();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const payload = fresh as unknown as Prisma.InputJsonValue;

    try {
      await prisma.integrationCache.upsert({
        where: { key },
        create: { key, payload, fetchedAt: now, expiresAt },
        update: { payload, fetchedAt: now, expiresAt },
      });
    } catch (error) {
      // Persisting is best-effort — we already have the fresh data in hand.
      console.error(`[integrations] cache write failed for "${key}":`, error);
    }

    return { data: fresh, fetchedAt: now, stale: false };
  } catch (error) {
    console.error(`[integrations] refresh failed for "${key}":`, error);
    await writeFailureTombstone(key, now);
    if (existing) {
      return { data: existing.payload as T, fetchedAt: existing.fetchedAt, stale: true };
    }
    return null;
  }
}

/** How long a failed upstream is left alone before we try it again. */
const NEGATIVE_TTL_SECONDS = 120;

const tombstoneKey = (key: string) => `${key}::fail`;

async function failureTombstoneActive(key: string, now: Date): Promise<boolean> {
  try {
    const row = await prisma.integrationCache.findUnique({ where: { key: tombstoneKey(key) } });
    return !!row && row.expiresAt > now;
  } catch {
    // Can't read the tombstone — fall through and attempt the real fetch.
    // Skipping a refresh is the worse failure mode of the two.
    return false;
  }
}

async function writeFailureTombstone(key: string, now: Date): Promise<void> {
  const expiresAt = new Date(now.getTime() + NEGATIVE_TTL_SECONDS * 1000);
  try {
    await prisma.integrationCache.upsert({
      where: { key: tombstoneKey(key) },
      create: { key: tombstoneKey(key), payload: { failedAt: now.toISOString() }, expiresAt },
      update: { payload: { failedAt: now.toISOString() }, expiresAt },
    });
  } catch (error) {
    console.error(`[integrations] tombstone write failed for "${key}":`, error);
  }
}

/**
 * fetch() with a hard timeout that covers the body, not just the headers.
 *
 * Without this an unresponsive upstream would hold a serverless invocation
 * open until the platform kills it, turning a decorative panel into a page
 * that never finishes rendering.
 *
 * The body is buffered *inside* the timeout window and handed back as a fresh
 * Response. Returning the live one instead would leave the deadline covering
 * only the response headers: a server that sends `200 OK` and then trickles
 * bytes forever would sail past the abort, because by the time the caller
 * reaches `await res.json()` the timer has already been cleared. Callers see
 * an ordinary Response either way — `.ok`, `.status` and `.json()` all behave
 * the same.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timer);
  }
}
