import type { Prisma } from "../generated/prisma/client";

export interface CachedResult<T> {
  data: T;
  fetchedAt: Date;
  /** True when the upstream refresh failed and this is a last-good payload. */
  stale: boolean;
}

interface CacheRow {
  payload: Prisma.JsonValue;
  fetchedAt: Date;
  expiresAt: Date;
}

/**
 * A shape guard for a cached payload. Optional, but see `cached()` below for
 * why every caller here supplies one.
 */
export type Guard<T> = (value: unknown) => value is T;

/**
 * The Prisma client is reached through a DYNAMIC import, deliberately.
 *
 * lib/prisma.ts builds its client at module scope and throws there when
 * DATABASE_URL is unset. Under a static `import { prisma } from "../prisma"`
 * that throw fires while *this* module is being evaluated — before any of the
 * try/catch below exists — so the "a cache-store outage must not take the
 * fetch path down with it" guarantee was never in force for the one failure it
 * most needed to cover. And /stats has no error.tsx (the app has only
 * app/global-error.tsx), so the throw escaped both Suspense boundaries and
 * replaced the whole page, layout included, over two decorative panels.
 * Deferring the import moves the throw inside the caller's try/catch, where it
 * is handled like any other store outage: log it, fetch anyway, render.
 *
 * A database that is merely *unreachable* already degraded correctly — Prisma's
 * Neon adapter does not connect eagerly — so this only changes the missing-env
 * case, which is exactly the case that was broken.
 */
async function cacheTable() {
  const { prisma } = await import("../prisma");
  return prisma.integrationCache;
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
 * `guard` is what makes the fallback path safe rather than merely present.
 * Rows are stored as Postgres JSON and were previously handed to the panel as
 * `payload as T` — an unchecked cast. Add one field to GitHubStats and every
 * row written before that deploy serves it as `undefined` for a full TTL, at
 * which point `Math.max(...data.languages.map(…))` in github-panel.tsx throws
 * INSIDE the panel, past this function's try/catch, and lands on
 * global-error.tsx instead of the panel's designed empty state. A row that no
 * longer matches the interface is treated as a miss, which is the same
 * outcome the cache-key version suffix produces and costs one predicate.
 *
 * Returns null only when there is no usable cached payload *and* the fetch
 * failed.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  guard?: Guard<T>,
): Promise<CachedResult<T> | null> {
  const now = new Date();

  let existing: CacheRow | null = null;
  try {
    existing = await (await cacheTable()).findUnique({ where: { key } });
  } catch (error) {
    // A cache-store outage must not take the fetch path down with it.
    console.error(`[integrations] cache read failed for "${key}":`, error);
  }

  const usable = existing && (!guard || guard(existing.payload)) ? existing : null;
  if (existing && !usable) {
    console.error(
      `[integrations] cached payload for "${key}" no longer matches its interface — treating as a miss`,
    );
  }

  if (usable && usable.expiresAt > now) {
    return { data: usable.payload as T, fetchedAt: usable.fetchedAt, stale: false };
  }

  // Negative caching. Without it, an upstream that is down or rate-limiting
  // gets a fresh request from every single page render — the exact traffic
  // pattern that keeps a 429 window open — and each one pays the full 8s
  // timeout before the page can finish. The tombstone is a separate row so
  // the payload column stays honestly typed as T.
  if (await failureTombstoneActive(key, now)) {
    if (usable) {
      return { data: usable.payload as T, fetchedAt: usable.fetchedAt, stale: true };
    }
    return null;
  }

  try {
    const fresh = await fetcher();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const payload = fresh as unknown as Prisma.InputJsonValue;

    try {
      await (
        await cacheTable()
      ).upsert({
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
    if (usable) {
      return { data: usable.payload as T, fetchedAt: usable.fetchedAt, stale: true };
    }
    return null;
  }
}

/** How long a failed upstream is left alone before we try it again. */
const NEGATIVE_TTL_SECONDS = 120;

const tombstoneKey = (key: string) => `${key}::fail`;

async function failureTombstoneActive(key: string, now: Date): Promise<boolean> {
  try {
    const row = await (await cacheTable()).findUnique({ where: { key: tombstoneKey(key) } });
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
    await (
      await cacheTable()
    ).upsert({
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
 * The deadline is `AbortSignal.timeout()` rather than a hand-rolled
 * AbortController plus clearTimeout: Node's implementation backs it with an
 * unref'd timer, so a request that resolves in 40ms cannot leave a live 8s
 * handle referencing the event loop, which is the failure mode that keeps a
 * serverless invocation billable after its response has been sent.
 *
 * What must NOT be simplified away is the buffering. The body is read *inside*
 * the timeout window and handed back as a fresh Response; returning the live
 * one would leave the deadline covering only the response headers, so a server
 * that sends `200 OK` and then trickles bytes forever would sail past the
 * abort — by the time the caller reached `await res.json()` the signal is no
 * longer attached to anything. Callers see an ordinary Response either way:
 * `.ok`, `.status` and `.json()` all behave the same.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Parse a response body and check its shape before anything reads a field off
 * it.
 *
 * `(await res.json()) as GitHubUserResponse` is a lie the compiler cannot
 * catch. Both upstreams here answer **200 with a completely different body**
 * in their most common failure modes: GitHub returns
 * `{"message":"API rate limit exceeded"}` with a 200 from some edge nodes, and
 * an HTML interstitial when a serverless IP is challenged. Cast blindly, the
 * repos call then reached `allRepos.filter(…)` on an object and threw
 * `filter is not a function` — which cached() does catch, so the page survived,
 * but the log line named a TypeError rather than "the upstream is throttling
 * us". Failing here instead turns an unexpected body into the stale-data
 * fallback with a message that says what actually arrived.
 */
export async function parseJson<T>(response: Response, label: string, guard: Guard<T>): Promise<T> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${label} returned ${response.status} with a body that is not JSON: ${text.slice(0, 140)}`,
    );
  }
  if (!guard(parsed)) {
    throw new Error(
      `${label} returned ${response.status} with an unexpected shape: ${JSON.stringify(parsed).slice(0, 140)}`,
    );
  }
  return parsed;
}

/** Narrowing helpers, shared so each integration's guard stays one expression. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
