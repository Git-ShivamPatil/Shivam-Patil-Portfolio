import { isRedisConfigured, pipeline } from "./security/redis";

/**
 * Token-bucket rate limiter (the blueprint's edge TokenBucket stage, applied
 * in-app).
 *
 * **Two backends, one contract.** `takeToken` is the in-memory bucket: buckets
 * live per serverless instance, so a caller spread across instances gets a
 * higher effective ceiling than the nominal one. That was an accepted trade for
 * the endpoints it guards — chat sends, newsletter signups, typing pings —
 * where the goal is to stop a stuck client or a casual script from hammering
 * the database, not to be an authorization boundary.
 *
 * P13 adds `consume()`, which uses Redis when it is configured and falls back
 * to exactly that bucket when it is not. Shared state is what turns a
 * per-instance guard rail into a real global limit: the count no longer
 * multiplies by however many instances the platform happens to have warm.
 *
 * **It degrades, it does not fail closed.** If Redis is unreachable or slow,
 * `consume()` answers from memory rather than rejecting. A limiter that returns
 * 429 because its own dependency is down has converted someone else's outage
 * into ours, and the thing it was protecting — the database — is not even under
 * load in that scenario.
 */
interface Bucket {
  tokens: number;
  updatedAt: number;
}

const globalForBuckets = globalThis as unknown as { rateBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (globalForBuckets.rateBuckets ??= new Map());

/** Evict idle buckets so a long-lived instance doesn't grow unbounded. */
const SWEEP_AFTER_MS = 10 * 60 * 1000;
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_AFTER_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > SWEEP_AFTER_MS) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Whole seconds until at least one token is available again. */
  retryAfter: number;
}

/**
 * @param key       Identity to meter on (ip, conversation id, email...).
 * @param capacity  Burst size — how many requests can arrive back-to-back.
 * @param refillPerSecond  Sustained rate once the burst is spent.
 */
export function takeToken(key: string, capacity: number, refillPerSecond: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  const elapsedSeconds = (now - bucket.updatedAt) / 1000;
  const tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - tokens) / refillPerSecond)) };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { ok: true, retryAfter: 0 };
}

/**
 * Prefix for every limiter key in Redis, so the instance can be shared with
 * anything else without two features colliding on a bare `ip` key.
 */
const REDIS_PREFIX = "rl:";

/**
 * Distributed token bucket, in one round trip.
 *
 * The bucket is a Redis counter of *spent* tokens with a TTL equal to the time
 * a full bucket takes to refill. That is the trick that makes this a single
 * INCR rather than a read-modify-write: instead of storing a token count and a
 * timestamp and doing the refill arithmetic (which needs a transaction or a Lua
 * script to be safe under concurrency), the key's own expiry *is* the refill.
 * INCR is atomic, so two instances incrementing at once cannot both see the
 * same value.
 *
 * The trade this makes, stated honestly: it is a fixed window rather than a
 * true continuously-refilling bucket, so a caller can spend a full capacity at
 * the end of one window and another at the start of the next. For the endpoints
 * here — where capacity is tens of requests and the point is to stop a script,
 * not to bill anyone — a 2x burst at a window boundary is not worth a Lua
 * script and a second round trip.
 */
async function takeTokenRedis(
  key: string,
  capacity: number,
  refillPerSecond: number,
): Promise<RateLimitResult | null> {
  const windowSeconds = Math.max(1, Math.ceil(capacity / refillPerSecond));
  const redisKey = `${REDIS_PREFIX}${key}`;

  // INCR first, then EXPIRE with NX so the TTL is only set when the key is
  // fresh. Setting it unconditionally would slide the window forward on every
  // request and let a steady caller hold the key alive forever.
  const results = await pipeline([
    ["INCR", redisKey],
    ["EXPIRE", redisKey, windowSeconds, "NX"],
  ]);
  if (!results) return null;

  const used = Number(results[0]);
  if (!Number.isFinite(used)) return null;

  if (used > capacity) {
    return { ok: false, retryAfter: windowSeconds };
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * Meter a request, preferring shared state when it exists.
 *
 * Same signature and same meaning as `takeToken`, only async. Call sites should
 * use this; `takeToken` remains exported because it is the fallback, and
 * because a few paths (the SSE poll loop) meter inside code where an await per
 * tick would be worse than a per-instance count.
 */
export async function consume(
  key: string,
  capacity: number,
  refillPerSecond: number,
): Promise<RateLimitResult> {
  if (isRedisConfigured()) {
    const shared = await takeTokenRedis(key, capacity, refillPerSecond);
    if (shared) return shared;
    // Redis was configured but did not answer. Fall through to memory rather
    // than reject: see the note at the top of this file.
  }
  return takeToken(key, capacity, refillPerSecond);
}

/**
 * Best-effort client IP. Behind Vercel/Cloudflare the left-most
 * X-Forwarded-For entry is the real client; the header is spoofable in
 * general, which is another reason this limiter is a guard rail rather than a
 * security control.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
