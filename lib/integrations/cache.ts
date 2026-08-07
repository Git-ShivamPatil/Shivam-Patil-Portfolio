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
    if (existing) {
      return { data: existing.payload as T, fetchedAt: existing.fetchedAt, stale: true };
    }
    return null;
  }
}

/**
 * fetch() with a hard timeout.
 *
 * Without this an unresponsive upstream would hold a serverless invocation
 * open until the platform kills it, turning a decorative panel into a page
 * that never finishes rendering.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
