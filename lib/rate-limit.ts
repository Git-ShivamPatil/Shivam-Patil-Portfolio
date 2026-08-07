/**
 * Token-bucket rate limiter (the blueprint's edge TokenBucket stage, applied
 * in-app).
 *
 * Deliberately in-memory: the buckets live per serverless instance, so a
 * determined attacker spread across instances gets a higher effective ceiling
 * than the nominal one. That is an accepted trade for the endpoints it guards
 * — chat sends, newsletter signups, typing pings — where the goal is to stop
 * a stuck client or a casual script from hammering the database, not to be an
 * authorization boundary. Anything that must be strictly enforced (payment
 * capture, admin writes) is guarded by auth and idempotency keys instead.
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
