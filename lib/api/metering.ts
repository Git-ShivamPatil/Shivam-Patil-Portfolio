import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma";
import type { ApiKeyTier } from "../generated/prisma/enums";

/**
 * P27 — API keys and usage metering.
 *
 * ### The rule this is built to, and it is not the obvious one
 *
 * **A key raises a limit. It never opens a door.** Every endpoint that is
 * public today stays public, anonymous, and free — `/api/openapi`, `/api/rpc`,
 * `/api/graphql` and `/api/ai/ask` answer an unauthenticated caller exactly as
 * they did before this file existed. What a key buys is a bigger budget and an
 * identity on the usage record.
 *
 * That is a deliberate inversion of how API metering is normally introduced,
 * and it is the right one here for two reasons. The site's standing constraint
 * is that everything on it is free to use, so a paywall would be a regression
 * dressed as a feature. And gating a working public endpoint is the one change
 * that can break an existing caller — there are no existing callers to break,
 * but designing as though there were is what keeps this honest.
 *
 * ### Why the aggregate, not a log
 *
 * `UsageRecord` is one row per key per route per UTC day. At request
 * granularity the table is the largest in the database inside a week and every
 * billing question becomes a scan. The unique constraint on
 * `(apiKeyId, route, day)` also makes the increment a single atomic upsert —
 * no read-modify-write, so two concurrent requests cannot lose a count between
 * them.
 *
 * ### Why the secret is never stored
 *
 * Only its SHA-256 is. The secret is shown once, at creation, and cannot be
 * recovered — the same discipline `PasswordResetToken` already follows. A
 * leaked database dump has to be a set of hashes, not a set of working
 * credentials.
 */

/** Prefix, so a key is recognisable in a log without being usable from one. */
const KEY_PREFIX = "sfk";

/**
 * 32 bytes.
 *
 * Not a compromise between length and convenience: this is copied once into an
 * environment variable and never typed, so there is no usability cost to make
 * it shorter for. 256 bits puts brute force beyond the point where the rate
 * limiter is even the relevant defence.
 */
const SECRET_BYTES = 32;

export interface GeneratedKey {
  /** Shown to the owner once. Never stored, never recoverable. */
  secret: string;
  /** The non-secret half, stored and displayed. */
  prefix: string;
  /** What goes in the database. */
  hash: string;
}

/** Mint a key. The caller must persist `prefix` and `hash` and show `secret` once. */
export function generateApiKey(): GeneratedKey {
  const random = randomBytes(SECRET_BYTES).toString("base64url");
  // The prefix is part of the presented secret, so a caller pastes one string.
  // Splitting them would double the number of things someone can paste wrong.
  const publicId = randomBytes(4).toString("hex");
  const secret = `${KEY_PREFIX}_${publicId}_${random}`;

  return { secret, prefix: `${KEY_PREFIX}_${publicId}`, hash: hashSecret(secret) };
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Compare two hex hashes without leaking where they diverge.
 *
 * The lookup below is by hash and therefore already constant-ish, but this is
 * used wherever a hash is compared directly, and `===` on a secret-derived
 * value is the habit worth not having.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  // timingSafeEqual throws on a length mismatch, which is itself a leak of one
  // bit. Length is not secret here (both are SHA-256), but returning false is
  // the correct answer and throwing is not.
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * A resolved budget: what this caller may actually spend on this route.
 *
 * `capacity` is burst; `refillPerSecond` is the sustained rate. Both feed the
 * token bucket in lib/rate-limit.ts, which already has the Redis-backed shared
 * implementation — this only decides which numbers it is given.
 */
export interface Budget {
  capacity: number;
  refillPerSecond: number;
  /** Requests per UTC day. Null means no daily ceiling. */
  dailyCap: number | null;
}

/** A route's existing anonymous limit — the numbers it already enforces today. */
export interface RouteBaseline {
  capacity: number;
  refillPerSecond: number;
}

/**
 * How much a tier multiplies a route's own anonymous limit.
 *
 * **A multiplier, not a table of absolute numbers, and the difference is a bug
 * that was nearly shipped.** The first version of this file had one budget per
 * tier for the whole API. But the routes do not share a limit: `/api/rpc`
 * allows 30 burst, `/api/graphql` 20, `/api/ai/ask` 12 — each sized for what
 * that route actually costs. A single `ANONYMOUS` budget would have replaced
 * all three with the smallest, quietly cutting the RPC endpoint's burst by
 * more than half for every anonymous caller.
 *
 * That would have broken the one rule this feature has: **a key raises a
 * limit, it never lowers one.** With a multiplier, `ANONYMOUS` is `×1` — the
 * route's own number, unchanged — and there is no arithmetic that can make a
 * tier worse than having no key.
 */
export const TIER_MULTIPLIER: Record<ApiKeyTier, number> = {
  ANONYMOUS: 1,
  FREE: 5,
  PRO: 20,
};

/**
 * Daily ceilings, by tier.
 *
 * `ANONYMOUS` is `null` deliberately. No daily cap exists on this site today,
 * so introducing one for callers without a key would be exactly the
 * regression the multiplier above exists to prevent — a metering feature
 * making the unmetered case worse.
 */
export const DAILY_CAP: Record<ApiKeyTier, number | null> = {
  ANONYMOUS: null,
  FREE: 10_000,
  PRO: null,
};

/** A route's baseline scaled by the caller's tier. */
export function budgetFor(baseline: RouteBaseline, tier: ApiKeyTier): Budget {
  const multiplier = TIER_MULTIPLIER[tier];
  return {
    capacity: Math.ceil(baseline.capacity * multiplier),
    refillPerSecond: baseline.refillPerSecond * multiplier,
    dailyCap: DAILY_CAP[tier],
  };
}

/**
 * What a request costs in billable units.
 *
 * Not one unit per request, because the routes are not the same size.
 * `/api/ai/ask` runs an embedding plus two database queries — the route its own
 * source calls the slowest on the site — while `/api/openapi` returns a cached
 * pure function of the deployed code. Charging them alike would either make the
 * cheap routes subsidise the expensive one or price the expensive one at the
 * cheap one's cost.
 *
 * These are relative weights, not currency. Nothing here is billed to anyone
 * today; see the note at the top of this file.
 */
const UNIT_COST: Record<string, number> = {
  "/api/ai/ask": 10,
  "/api/graphql": 3,
  "/api/rpc": 2,
  "/api/search": 2,
};

export function unitsFor(route: string): number {
  return UNIT_COST[route] ?? 1;
}

export interface ApiCaller {
  tier: ApiKeyTier;
  /** Null for an anonymous caller — there is no key to attribute usage to. */
  keyId: string | null;
  /** What to meter the rate limiter on: a key id, or the client IP. */
  identity: string;
  budget: Budget;
}

/** The UTC midnight of `when`. The day boundary a UsageRecord row is keyed on. */
export function utcDay(when: Date = new Date()): Date {
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));
}

/**
 * Resolve who is calling.
 *
 * **Degrades to anonymous on every failure path**, including a database error.
 * A key lookup that throws must not turn into a 500 on a public endpoint: the
 * caller loses their raised limit and gets the anonymous one, which is the
 * limit the endpoint would have applied if keys had never been built. Failing
 * closed here would mean an outage in a feature nobody is required to use took
 * down the endpoints everybody uses.
 */
export async function resolveCaller(
  presented: string | null,
  fallbackIdentity: string,
  baseline: RouteBaseline,
): Promise<ApiCaller> {
  const anonymous: ApiCaller = {
    tier: "ANONYMOUS",
    keyId: null,
    identity: fallbackIdentity,
    budget: budgetFor(baseline, "ANONYMOUS"),
  };

  if (!presented || !presented.startsWith(`${KEY_PREFIX}_`)) return anonymous;

  try {
    const key = await prisma.apiKey.findUnique({
      where: { hash: hashSecret(presented) },
      select: { id: true, tier: true, status: true, expiresAt: true },
    });

    if (!key) return anonymous;
    if (key.status !== "ACTIVE") return anonymous;
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return anonymous;

    return {
      tier: key.tier,
      keyId: key.id,
      // Metered on the key, not the IP: that is the point of having one. A team
      // behind one NAT gets its own budget instead of sharing an address's.
      identity: `key:${key.id}`,
      budget: budgetFor(baseline, key.tier),
    };
  } catch (error) {
    console.error(
      `[metering] key lookup failed, serving as anonymous: ${error instanceof Error ? error.message : String(error)}`,
    );
    return anonymous;
  }
}

/**
 * Record one served request.
 *
 * **Fire-and-forget, and never awaited by a route handler.** Metering is
 * bookkeeping; making a caller wait on it — or fail because of it — would let
 * the accounting take down the thing being accounted for. The `.catch` is not
 * defensive padding: without it this is an unhandled rejection that can take
 * the process down in Node.
 *
 * A single upsert, atomic on the unique constraint. Two concurrent requests
 * increment rather than one overwriting the other's read.
 */
export function recordUsage(caller: ApiCaller, route: string): void {
  if (!caller.keyId) return; // Nothing to attribute anonymous traffic to.

  const day = utcDay();
  const units = unitsFor(route);

  void prisma.usageRecord
    .upsert({
      where: { apiKeyId_route_day: { apiKeyId: caller.keyId, route, day } },
      create: { apiKeyId: caller.keyId, route, day, count: 1, units },
      update: { count: { increment: 1 }, units: { increment: units } },
    })
    .catch((error: unknown) => {
      console.error(
        `[metering] usage write failed for ${route}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

/**
 * Today's usage for a key, against its daily cap.
 *
 * Returns `null` when the tier has no cap, so a caller can skip the check
 * entirely rather than comparing against Infinity.
 */
export async function dailyUsage(
  caller: ApiCaller,
): Promise<{ used: number; cap: number; exceeded: boolean } | null> {
  const cap = caller.budget.dailyCap;
  if (cap === null || !caller.keyId) return null;

  try {
    const rows = await prisma.usageRecord.aggregate({
      where: { apiKeyId: caller.keyId, day: utcDay() },
      _sum: { count: true },
    });
    const used = rows._sum.count ?? 0;
    return { used, cap, exceeded: used >= cap };
  } catch {
    // Same reasoning as resolveCaller: a failed read must not become a refusal.
    return null;
  }
}
