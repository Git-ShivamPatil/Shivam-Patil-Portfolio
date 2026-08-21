import { NextResponse } from "next/server";
import { auth } from "../auth";
import type { Session } from "next-auth";
import { clientIp, consume } from "./rate-limit";
import {
  dailyUsage,
  recordUsage,
  resolveCaller,
  utcDay,
  type ApiCaller,
  type RouteBaseline,
} from "./api/metering";

/**
 * Use at the top of admin-only route handlers. Returns the session on
 * success, or a ready-to-return 403 NextResponse otherwise:
 *
 *   const guard = await requireAdminApi();
 *   if ("error" in guard) return guard.error;
 */
export async function requireAdminApi(): Promise<{ session: Session } | { error: NextResponse }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Not authorized." }, { status: 403 }) };
  }
  return { session };
}

/**
 * P27 — resolve the caller's tier and apply their budget, in one call.
 *
 * Sits at the top of a metered route the same way `requireAdminApi` sits at the
 * top of an admin one:
 *
 *   const gate = await meterApi(request, "/api/rpc");
 *   if ("error" in gate) return gate.error;
 *   // ... do the work ...
 *   gate.record();
 *
 * **`record()` is called by the handler, after the work, on success.** Metering
 * a request that then 500s would bill a caller for an outage. It is a plain
 * synchronous call because `recordUsage` is deliberately fire-and-forget — see
 * the note on it.
 *
 * The `Authorization: Bearer` header is read, but so is `X-API-Key`. Both are
 * in wide use and accepting one and not the other is a support burden with no
 * security benefit — the key is the same string either way.
 */
export async function meterApi(
  request: Request,
  route: string,
  /**
   * The route's own anonymous limit — the numbers it enforced before metering
   * existed. Passed in rather than looked up centrally so that adding a route
   * cannot silently inherit some other route's budget, and so an anonymous
   * caller provably keeps the limit they had. See TIER_MULTIPLIER.
   */
  baseline: RouteBaseline,
): Promise<
  { caller: ApiCaller; record: () => void; headers: HeadersInit } | { error: NextResponse }
> {
  const bearer = request.headers.get("Authorization");
  const presented =
    request.headers.get("X-API-Key") ??
    (bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null);

  const caller = await resolveCaller(presented, `ip:${clientIp(request)}`, baseline);

  // The daily ceiling is checked before the burst limiter, because the two
  // refusals mean different things and the caller needs to know which they hit:
  // a burst 429 clears in seconds, a daily cap does not clear until UTC
  // midnight, and telling someone to "try again shortly" when it is the latter
  // sends them into a retry loop that cannot succeed.
  const daily = await dailyUsage(caller);
  if (daily?.exceeded) {
    const resetsIn = Math.ceil(
      (utcDay(new Date(Date.now() + 86_400_000)).getTime() - Date.now()) / 1000,
    );
    return {
      error: NextResponse.json(
        {
          error: `Daily limit of ${daily.cap} requests reached for this key. It resets at UTC midnight.`,
          used: daily.used,
          limit: daily.cap,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(resetsIn),
            "X-RateLimit-Limit": String(daily.cap),
            "X-RateLimit-Remaining": "0",
          },
        },
      ),
    };
  }

  const budget = await consume(
    `api:${route}:${caller.identity}`,
    caller.budget.capacity,
    caller.budget.refillPerSecond,
  );

  if (!budget.ok) {
    return {
      error: NextResponse.json(
        {
          error: "Too many requests. Slow down, or use an API key for a higher limit.",
          tier: caller.tier,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(budget.retryAfter),
            "X-RateLimit-Limit": String(caller.budget.capacity),
            "X-RateLimit-Remaining": "0",
          },
        },
      ),
    };
  }

  return {
    caller,
    record: () => recordUsage(caller, route),
    /**
     * Echoed on the successful response so a caller can see what tier they are
     * being served at without guessing. `X-RateLimit-Remaining` is deliberately
     * absent: the token bucket's remaining count is per-instance unless Redis
     * is configured, so publishing it would be publishing a number that is
     * sometimes wrong. A tier and a limit are both always true.
     */
    headers: {
      "X-RateLimit-Tier": caller.tier,
      "X-RateLimit-Limit": String(caller.budget.capacity),
    },
  };
}
