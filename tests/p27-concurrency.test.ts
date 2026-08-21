import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { AdaptiveLimiter, limiterFor, limiterStates, resetLimiters } from "../lib/sre/concurrency";

/**
 * P27 — adaptive concurrency limiting.
 *
 * The property under test is not "it limits things" — a constant would do that.
 * It is that the limit is **derived from observed downstream latency**, so the
 * route sheds load when the database is unwell and opens up again when it is
 * not. A token bucket cannot do that: it enforces the number it was given and
 * admits identical traffic whether Neon answers in 40ms or 4s.
 *
 * Two failures are specifically pinned because both are silent:
 *
 * - A limiter that can only shrink. Without the √limit queue term,
 *   `limit × gradient` has a fixed point at gradient 1.0 and can never grow,
 *   so one blip ratchets the route down permanently.
 * - A leaked slot. A handler that throws between acquire and release loses a
 *   permit forever; enough of those and the route stops serving anyone, with
 *   nothing in the logs to say why.
 */

/** Drive `count` requests through the limiter, each taking `rttMs`. */
async function run(limiter: AdaptiveLimiter, count: number, rttMs: number) {
  let shed = 0;
  for (let i = 0; i < count; i += 1) {
    const result = await limiter.guard(async () => {
      vi.advanceTimersByTime(rttMs);
      return "ok";
    });
    if (!result.ok) shed += 1;
  }
  return shed;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetLimiters();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AdaptiveLimiter", () => {
  it("starts at the floor rather than the ceiling", () => {
    // Starting wide open admits maximum concurrency during exactly the window
    // where nothing is yet known about downstream health.
    const limiter = new AdaptiveLimiter({ minLimit: 4, maxLimit: 64 });
    expect(limiter.state().limit).toBe(4);
  });

  it("opens up while latency stays good", async () => {
    const limiter = new AdaptiveLimiter({ minLimit: 4, maxLimit: 64 });
    await run(limiter, 60, 10);

    // This is the assertion that fails if the √limit queue term is dropped:
    // limit x gradient has a fixed point at gradient 1.0, so without headroom
    // the limit can never rise above where it started.
    expect(limiter.state().limit).toBeGreaterThan(4);
  });

  it("closes when latency degrades", async () => {
    const limiter = new AdaptiveLimiter({ minLimit: 4, maxLimit: 64 });
    await run(limiter, 80, 10);
    const healthy = limiter.state().limit;

    await run(limiter, 80, 400);
    expect(limiter.state().limit).toBeLessThan(healthy);
  });

  it("recovers after the degradation passes", async () => {
    // A limiter that clamps and stays clamped has converted a transient blip
    // into a permanent capacity cut.
    const limiter = new AdaptiveLimiter({ minLimit: 4, maxLimit: 64 });
    await run(limiter, 60, 10);
    await run(limiter, 60, 500);
    const degraded = limiter.state().limit;

    await run(limiter, 120, 10);
    expect(limiter.state().limit).toBeGreaterThan(degraded);
  });

  it("never goes below the floor", async () => {
    // A floor of 1 would serialise the route, turning a slow dependency into a
    // queue that is slower still.
    const limiter = new AdaptiveLimiter({ minLimit: 4, maxLimit: 64 });
    await run(limiter, 50, 10);
    await run(limiter, 200, 8000);
    expect(limiter.state().limit).toBeGreaterThanOrEqual(4);
  });

  it("never exceeds the ceiling", async () => {
    const limiter = new AdaptiveLimiter({ minLimit: 4, maxLimit: 10 });
    await run(limiter, 300, 1);
    expect(limiter.state().limit).toBeLessThanOrEqual(10);
  });

  it("sheds once in-flight reaches the limit", () => {
    const limiter = new AdaptiveLimiter({ minLimit: 2, maxLimit: 2 });
    expect(limiter.acquire()).not.toBeNull();
    expect(limiter.acquire()).not.toBeNull();
    expect(limiter.acquire()).toBeNull();
    expect(limiter.state().dropped).toBe(1);
  });

  it("releases the slot when the guarded work throws", async () => {
    // The leak this pins is invisible: a handler that throws between acquire
    // and release loses a permit permanently, and enough of them close the
    // route with nothing in the logs explaining it.
    const limiter = new AdaptiveLimiter({ minLimit: 2, maxLimit: 2 });

    for (let i = 0; i < 5; i += 1) {
      await expect(
        limiter.guard(async () => {
          throw new Error("downstream exploded");
        }),
      ).rejects.toThrow("downstream exploded");
    }

    expect(limiter.state().inFlight).toBe(0);
    expect(limiter.acquire()).not.toBeNull();
  });

  it("ignores a double release", () => {
    // A second release decrements in-flight below the true value and admits
    // more concurrency than the limit claims.
    const limiter = new AdaptiveLimiter({ minLimit: 2, maxLimit: 2 });
    const release = limiter.acquire();
    expect(release).not.toBeNull();

    release!();
    release!();
    expect(limiter.state().inFlight).toBe(0);
  });

  it("survives instantaneous responses without dividing by zero", async () => {
    // Date.now() deltas of 0 are real on a warm path. longRtt / shortRtt would
    // be Infinity or NaN, and NaN propagates silently into the limit.
    const limiter = new AdaptiveLimiter();
    await run(limiter, 20, 0);
    expect(Number.isFinite(limiter.state().limit)).toBe(true);
    expect(limiter.state().limit).toBeGreaterThanOrEqual(4);
  });

  it("does not treat a uniformly slow route as a degraded one", async () => {
    // Worth pinning because it surprises people, and because the first version
    // of the sibling test below asserted the opposite and failed.
    //
    // The gradient is longRTT/shortRTT — a measure of how far a route is from
    // ITS OWN best, not from some absolute latency budget. A route that always
    // takes 2s is not unwell; it is a 2s route, and throttling it would be the
    // limiter inventing a problem. Only a CHANGE in latency closes the limit.
    const alwaysSlow = new AdaptiveLimiter({ minLimit: 4, maxLimit: 64 });
    await run(alwaysSlow, 120, 2000);

    expect(alwaysSlow.state().limit).toBeGreaterThan(4);
  });

  it("keeps one route's degradation from closing another's limiter", async () => {
    // Per-route limiters, not one shared estimate: /api/ai/ask running a
    // pgvector query and /api/rpc encoding protobuf have unrelated latency
    // profiles, and one degrading should not throttle the other.
    const degrading = limiterFor("/degrading");
    const healthy = limiterFor("/healthy");

    // Both establish a good baseline first, so "degraded" means something.
    await run(degrading, 60, 5);
    await run(healthy, 60, 5);

    // Only one of them gets worse.
    await run(degrading, 60, 1500);
    await run(healthy, 60, 5);

    expect(healthy.state().limit).toBeGreaterThan(degrading.state().limit);
  });

  it("reports state per route for the reliability page", async () => {
    await run(limiterFor("/api/ai/ask"), 10, 20);
    const states = limiterStates();
    expect(states["/api/ai/ask"]).toMatchObject({ inFlight: 0 });
    expect(states["/api/ai/ask"].limit).toBeGreaterThan(0);
  });
});
