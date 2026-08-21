import { describe, expect, it, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const upsert = vi.fn();
const aggregate = vi.fn();

vi.mock("../lib/prisma", () => ({
  prisma: {
    apiKey: { findUnique },
    usageRecord: { upsert, aggregate },
  },
}));

const {
  generateApiKey,
  hashSecret,
  hashesMatch,
  budgetFor,
  unitsFor,
  utcDay,
  resolveCaller,
  recordUsage,
  dailyUsage,
  TIER_MULTIPLIER,
  DAILY_CAP,
} = await import("../lib/api/metering");

/**
 * P27 — API metering.
 *
 * The feature has exactly one rule and most of this file exists to hold it:
 * **a key raises a limit, it never lowers one.** Everything on this site is
 * free to use, so a metering layer that could make the unmetered case worse
 * would be a regression wearing a feature's clothes.
 *
 * That rule was nearly broken during implementation. The first design had one
 * absolute budget per tier for the whole API — but the routes do not share a
 * limit (`/api/rpc` allows 30 burst, `/api/graphql` 20, `/api/ai/ask` 12), so a
 * single ANONYMOUS budget would have replaced all three with the smallest and
 * silently cut the RPC endpoint's burst by more than half for every anonymous
 * caller. The multiplier design is the fix; `budgetFor` below is where it is
 * pinned.
 */

const RPC = { capacity: 30, refillPerSecond: 0.5 };
const ASK = { capacity: 12, refillPerSecond: 1 / 3 };

beforeEach(() => {
  findUnique.mockReset();
  upsert.mockReset().mockResolvedValue({});
  aggregate.mockReset();
});

describe("budgetFor — a key raises a limit and never lowers one", () => {
  it("leaves an anonymous caller on the route's own numbers, exactly", () => {
    // The regression this pins: if ANONYMOUS ever stops being x1, every
    // unauthenticated visitor's limit changes site-wide.
    expect(budgetFor(RPC, "ANONYMOUS")).toMatchObject({ capacity: 30, refillPerSecond: 0.5 });
    expect(budgetFor(ASK, "ANONYMOUS")).toMatchObject({ capacity: 12 });
  });

  it("gives no tier a smaller budget than anonymous, on any route", () => {
    for (const baseline of [RPC, ASK, { capacity: 1, refillPerSecond: 0.01 }]) {
      const floor = budgetFor(baseline, "ANONYMOUS");
      for (const tier of ["FREE", "PRO"] as const) {
        const budget = budgetFor(baseline, tier);
        expect(budget.capacity).toBeGreaterThanOrEqual(floor.capacity);
        expect(budget.refillPerSecond).toBeGreaterThanOrEqual(floor.refillPerSecond);
      }
    }
  });

  it("never issues a fractional burst capacity", () => {
    // A token bucket compares against capacity; a capacity of 2.5 means the
    // third token is unreachable and the limit is really 2.
    for (const tier of ["ANONYMOUS", "FREE", "PRO"] as const) {
      expect(
        Number.isInteger(budgetFor({ capacity: 3, refillPerSecond: 0.1 }, tier).capacity),
      ).toBe(true);
    }
  });

  it("does not impose a daily cap on anonymous callers", () => {
    // No daily cap exists on this site today. Introducing one for people
    // without a key is the exact regression this whole design avoids.
    expect(DAILY_CAP.ANONYMOUS).toBeNull();
    expect(budgetFor(RPC, "ANONYMOUS").dailyCap).toBeNull();
  });

  it("orders the tiers as advertised", () => {
    expect(TIER_MULTIPLIER.ANONYMOUS).toBe(1);
    expect(TIER_MULTIPLIER.FREE).toBeGreaterThan(TIER_MULTIPLIER.ANONYMOUS);
    expect(TIER_MULTIPLIER.PRO).toBeGreaterThan(TIER_MULTIPLIER.FREE);
  });
});

describe("generateApiKey", () => {
  it("returns a secret that hashes to the stored hash", () => {
    const key = generateApiKey();
    expect(hashSecret(key.secret)).toBe(key.hash);
  });

  it("stores a hash, never the secret", () => {
    const key = generateApiKey();
    // The property that makes a leaked dump useless. If the secret ever
    // appears in the persisted fields, that is gone.
    expect(key.hash).not.toContain(key.secret);
    expect(key.prefix).not.toContain(key.secret);
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("embeds the displayable prefix in the secret, so one string is pasted", () => {
    const key = generateApiKey();
    expect(key.secret.startsWith(key.prefix)).toBe(true);
  });

  it("does not repeat", () => {
    const keys = Array.from({ length: 500 }, () => generateApiKey());
    expect(new Set(keys.map((key) => key.secret)).size).toBe(500);
    expect(new Set(keys.map((key) => key.prefix)).size).toBe(500);
  });
});

describe("hashesMatch", () => {
  it("matches identical hashes and rejects different ones", () => {
    const a = hashSecret("one");
    expect(hashesMatch(a, hashSecret("one"))).toBe(true);
    expect(hashesMatch(a, hashSecret("two"))).toBe(false);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    // timingSafeEqual throws when lengths differ. Throwing from a comparison
    // is both a crash and a signal about the input.
    expect(hashesMatch(hashSecret("one"), "abcd")).toBe(false);
    expect(hashesMatch("", "")).toBe(false);
  });
});

describe("resolveCaller", () => {
  it("is anonymous when no key is presented, without touching the database", async () => {
    const caller = await resolveCaller(null, "ip:1.2.3.4", RPC);
    expect(caller.tier).toBe("ANONYMOUS");
    expect(caller.keyId).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("is anonymous for a string that is not one of our keys, without a lookup", async () => {
    // The prefix check is what keeps a stray Authorization header from
    // becoming a database query on every request.
    await resolveCaller("Bearer some-jwt-from-another-system", "ip:1.2.3.4", RPC);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("raises the budget for a valid key", async () => {
    findUnique.mockResolvedValue({ id: "k1", tier: "PRO", status: "ACTIVE", expiresAt: null });
    const caller = await resolveCaller("sfk_abcd1234_secret", "ip:1.2.3.4", RPC);

    expect(caller.tier).toBe("PRO");
    expect(caller.keyId).toBe("k1");
    expect(caller.budget.capacity).toBeGreaterThan(RPC.capacity);
  });

  it("meters a keyed caller on the key, not the IP", async () => {
    // The point of holding a key: a team behind one NAT gets its own budget
    // instead of sharing an address's.
    findUnique.mockResolvedValue({ id: "k1", tier: "FREE", status: "ACTIVE", expiresAt: null });
    const caller = await resolveCaller("sfk_abcd1234_secret", "ip:1.2.3.4", RPC);
    expect(caller.identity).toBe("key:k1");
  });

  it("falls back to anonymous for a revoked key", async () => {
    findUnique.mockResolvedValue({ id: "k1", tier: "PRO", status: "REVOKED", expiresAt: null });
    expect((await resolveCaller("sfk_a_b", "ip:1.2.3.4", RPC)).tier).toBe("ANONYMOUS");
  });

  it("falls back to anonymous for an expired key", async () => {
    findUnique.mockResolvedValue({
      id: "k1",
      tier: "PRO",
      status: "ACTIVE",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await resolveCaller("sfk_a_b", "ip:1.2.3.4", RPC)).tier).toBe("ANONYMOUS");
  });

  it("serves as anonymous when the lookup throws, rather than 500ing", async () => {
    // A key lookup failing must not take down endpoints that never required a
    // key. Failing closed here would let an outage in an optional feature
    // break the ones everybody uses.
    findUnique.mockRejectedValue(new Error("connection reset"));
    const caller = await resolveCaller("sfk_a_b", "ip:1.2.3.4", RPC);
    expect(caller.tier).toBe("ANONYMOUS");
    expect(caller.budget.capacity).toBe(RPC.capacity);
  });
});

describe("unitsFor", () => {
  it("charges the expensive route more than the cheap one", () => {
    // /api/ai/ask runs an embedding plus two queries; /api/openapi returns a
    // cached pure function of the deployed code. One price for both would
    // either subsidise the first or overcharge the second.
    expect(unitsFor("/api/ai/ask")).toBeGreaterThan(unitsFor("/api/rpc"));
    expect(unitsFor("/api/rpc")).toBeGreaterThan(unitsFor("/api/openapi"));
  });

  it("defaults an unknown route to one unit rather than zero", () => {
    // Zero would make a new route free and invisible in usage until someone
    // remembered to price it.
    expect(unitsFor("/api/something-new")).toBe(1);
  });
});

describe("recordUsage", () => {
  it("writes nothing for an anonymous caller", () => {
    recordUsage(
      { tier: "ANONYMOUS", keyId: null, identity: "ip:1", budget: budgetFor(RPC, "ANONYMOUS") },
      "/api/rpc",
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts on the (key, route, day) key so concurrent writes increment", () => {
    recordUsage(
      { tier: "PRO", keyId: "k1", identity: "key:k1", budget: budgetFor(RPC, "PRO") },
      "/api/rpc",
    );

    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      apiKeyId_route_day: { apiKeyId: "k1", route: "/api/rpc", day: utcDay() },
    });
    // increment, not a read-modify-write — two concurrent requests must not
    // lose a count between them.
    expect(call.update).toEqual({
      count: { increment: 1 },
      units: { increment: unitsFor("/api/rpc") },
    });
  });

  it("swallows a write failure instead of rejecting", async () => {
    // Fire-and-forget with no catch is an unhandled rejection, which can take
    // the process down in Node. Metering must never do that.
    upsert.mockRejectedValue(new Error("write failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      recordUsage(
        { tier: "PRO", keyId: "k1", identity: "key:k1", budget: budgetFor(RPC, "PRO") },
        "/api/rpc",
      ),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    vi.restoreAllMocks();
  });
});

describe("dailyUsage", () => {
  const proCaller = {
    tier: "PRO" as const,
    keyId: "k1",
    identity: "key:k1",
    budget: budgetFor(RPC, "PRO"),
  };
  const freeCaller = {
    tier: "FREE" as const,
    keyId: "k1",
    identity: "key:k1",
    budget: budgetFor(RPC, "FREE"),
  };

  it("is null when the tier has no cap, so the caller can skip the check", async () => {
    expect(await dailyUsage(proCaller)).toBeNull();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("is null for an anonymous caller", async () => {
    expect(
      await dailyUsage({
        tier: "ANONYMOUS",
        keyId: null,
        identity: "ip:1",
        budget: budgetFor(RPC, "ANONYMOUS"),
      }),
    ).toBeNull();
  });

  it("reports exceeded once usage reaches the cap", async () => {
    aggregate.mockResolvedValue({ _sum: { count: DAILY_CAP.FREE } });
    expect(await dailyUsage(freeCaller)).toMatchObject({ exceeded: true });
  });

  it("is not exceeded one request below the cap", async () => {
    aggregate.mockResolvedValue({ _sum: { count: (DAILY_CAP.FREE as number) - 1 } });
    expect(await dailyUsage(freeCaller)).toMatchObject({ exceeded: false });
  });

  it("treats an empty aggregate as zero, not as NaN", async () => {
    // Prisma returns { _sum: { count: null } } when no rows match. NaN >= cap
    // is false, so this would silently work — until someone renders the number.
    aggregate.mockResolvedValue({ _sum: { count: null } });
    expect(await dailyUsage(freeCaller)).toMatchObject({ used: 0, exceeded: false });
  });

  it("returns null rather than refusing when the read fails", async () => {
    aggregate.mockRejectedValue(new Error("timeout"));
    expect(await dailyUsage(freeCaller)).toBeNull();
  });
});

describe("utcDay", () => {
  it("truncates to UTC midnight", () => {
    const day = utcDay(new Date("2026-08-21T23:59:59.999Z"));
    expect(day.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("does not shift the day for a time that is already midnight", () => {
    expect(utcDay(new Date("2026-08-21T00:00:00.000Z")).toISOString()).toBe(
      "2026-08-21T00:00:00.000Z",
    );
  });
});
