import { describe, it, expect } from "vitest";

import { histogramQuantile, addHistograms, clampQuantile } from "../lib/sre/histogram";
import {
  DEFAULT_POLICY,
  canAttempt,
  emptyBreaker,
  prune,
  recordOutcome,
  stats,
  type BreakerPolicy,
  type BreakerSnapshot,
} from "../lib/sre/breaker";
import { injectFault, runExperiment, seeded, summarise, HEALTHY } from "../lib/sre/chaos";
import { formatTraceparent, parseTraceparent } from "../lib/sre/trace";
import { statusClassOf, LATENCY_BUCKETS_MS } from "../lib/sre/red";

/**
 * P21 — SRE.
 *
 * The breaker tests are the ones that matter, and they assert *behaviour under
 * a sequence of events* rather than that a field holds a value. "One failed
 * probe re-opens the circuit but one successful probe does not close it" is the
 * asymmetry the whole state is for; asserting `state === "open"` after calling
 * a setter proves nothing.
 *
 * Nothing here touches a database, a clock or a network. Every function under
 * test takes `now` as an argument, which is what makes a thirty-second cooldown
 * testable in a microsecond.
 */

const BOUNDARIES = [...LATENCY_BUCKETS_MS];

/** Drive n failures through a closed breaker and hand back the result. */
function fail(snapshot: BreakerSnapshot, times: number, at: number, policy = DEFAULT_POLICY) {
  let current = snapshot;
  for (let i = 0; i < times; i += 1) {
    current = recordOutcome(current, false, at + i, policy).snapshot;
  }
  return current;
}

function succeed(snapshot: BreakerSnapshot, times: number, at: number, policy = DEFAULT_POLICY) {
  let current = snapshot;
  for (let i = 0; i < times; i += 1) {
    current = recordOutcome(current, true, at + i, policy).snapshot;
  }
  return current;
}

describe("P21 histogram", () => {
  it("returns null for an empty histogram rather than a fast-looking zero", () => {
    const empty = new Array(BOUNDARIES.length + 1).fill(0);
    expect(histogramQuantile(empty, BOUNDARIES, 0.95)).toBeNull();
  });

  it("interpolates inside the bucket the quantile lands in", () => {
    // 100 observations, all in the 25–50ms bucket. The median must land halfway
    // through it, not on an edge.
    const cumulative = [0, 0, 100, 100, 100, 100, 100, 100, 100, 100];
    const p50 = histogramQuantile(cumulative, BOUNDARIES, 0.5);
    expect(p50).toBeGreaterThan(25);
    expect(p50).toBeLessThan(50);
    expect(p50).toBeCloseTo(37.5, 1);
  });

  it("reports the top boundary when the quantile falls in +Inf", () => {
    // Everything slower than 5s: there is no upper edge to interpolate to, so
    // the honest answer is "at least 5000".
    const cumulative = [0, 0, 0, 0, 0, 0, 0, 0, 0, 40];
    expect(histogramQuantile(cumulative, BOUNDARIES, 0.99)).toBe(5000);
  });

  it("is monotonic in the quantile", () => {
    const cumulative = [1, 5, 20, 55, 80, 92, 97, 99, 100, 100];
    const p50 = histogramQuantile(cumulative, BOUNDARIES, 0.5)!;
    const p95 = histogramQuantile(cumulative, BOUNDARIES, 0.95)!;
    const p99 = histogramQuantile(cumulative, BOUNDARIES, 0.99)!;
    expect(p50).toBeLessThanOrEqual(p95);
    expect(p95).toBeLessThanOrEqual(p99);
  });

  it("rejects a bucket layout that does not match its boundaries", () => {
    expect(() => histogramQuantile([1, 2, 3], BOUNDARIES, 0.5)).toThrow(/expected/);
  });

  it("adds histograms bucket-wise — the property the whole storage design rests on", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34];
    expect(addHistograms(a, b)).toEqual([1, 3, 4, 6, 8, 11, 15, 21, 30, 44]);
  });

  it("never reports a percentile above the slowest request observed", () => {
    // The artefact this exists for, taken from a real reading on /api/search:
    // 16 requests, slowest 935ms, and interpolation inside the 500–1000ms
    // bucket put p99 at 980ms — a figure no request produced, printed next to
    // the max column that contradicted it.
    expect(clampQuantile(980, 935)).toBe(935);
    expect(clampQuantile(2480, 2140)).toBe(2140);
  });

  it("leaves a percentile alone when it is already below the max", () => {
    expect(clampQuantile(233, 935)).toBe(233);
    // No observations yet: nothing to clamp against, so pass the value through
    // rather than flattening it to zero.
    expect(clampQuantile(233, 0)).toBe(233);
    expect(clampQuantile(null, 935)).toBeNull();
  });

  it("gives the same quantile whether observations arrived in one batch or several", () => {
    // This is the serverless property stated as a test: two instances' partial
    // histograms, summed, must be indistinguishable from one instance seeing
    // every request.
    const instanceA = [0, 3, 9, 12, 12, 12, 12, 12, 12, 12];
    const instanceB = [0, 1, 4, 20, 28, 28, 28, 28, 28, 28];
    const merged = addHistograms(instanceA, instanceB);
    const combined = [0, 4, 13, 32, 40, 40, 40, 40, 40, 40];
    expect(merged).toEqual(combined);
    expect(histogramQuantile(merged, BOUNDARIES, 0.9)).toBe(
      histogramQuantile(combined, BOUNDARIES, 0.9),
    );
  });
});

describe("P21 circuit breaker", () => {
  it("stays closed below the minimum sample count, however bad the ratio", () => {
    // Four failures out of four is a 100% failure rate. Opening on it would
    // mean any dependency called rarely enough is one blip from being cut off.
    const snapshot = fail(emptyBreaker(), DEFAULT_POLICY.minimumSamples - 1, 1000);
    expect(stats(snapshot).ratio).toBe(1);
    expect(snapshot.state).toBe("closed");
  });

  it("opens once the sample floor is met and the ratio is exceeded", () => {
    const snapshot = fail(emptyBreaker(), DEFAULT_POLICY.minimumSamples, 1000);
    expect(snapshot.state).toBe("open");
    expect(snapshot.openedAt).not.toBeNull();
  });

  it("reports the transition that opened it, with the evidence", () => {
    const current = fail(emptyBreaker(), DEFAULT_POLICY.minimumSamples - 1, 1000);
    const { transition } = recordOutcome(current, false, 1100);
    expect(transition).not.toBeNull();
    expect(transition!.from).toBe("closed");
    expect(transition!.to).toBe("open");
    expect(transition!.failures).toBe(DEFAULT_POLICY.minimumSamples);
    expect(transition!.reason).toMatch(/100%/);
  });

  it("rejects calls while the cooldown is running, and says how long is left", () => {
    const opened = fail(emptyBreaker(), 5, 1000);
    const verdict = canAttempt(opened, opened.openedAt! + DEFAULT_POLICY.cooldownMs - 1);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/cooldown/);
  });

  it("moves to half-open on the passage of time alone, not on a call being recorded", () => {
    // The regression this guards: if the open→half-open edge lived in
    // recordOutcome, a breaker would stay open forever once traffic stopped —
    // precisely when it is blocking the request that would prove recovery.
    //
    // Timed from `openedAt` rather than from the first failure. The circuit
    // opens on the *last* failure of the burst, so an experiment clocked from
    // the first one measures a cooldown several milliseconds short and reads as
    // still-open. That is the whole reason `openedAt` is stored rather than
    // inferred.
    const opened = fail(emptyBreaker(), 5, 1000);
    const verdict = canAttempt(opened, opened.openedAt! + DEFAULT_POLICY.cooldownMs + 1);
    expect(verdict.allowed).toBe(true);
    expect(verdict.snapshot.state).toBe("half-open");
    expect(verdict.transition?.to).toBe("half-open");
  });

  it("re-opens on a single failed probe", () => {
    const opened = fail(emptyBreaker(), 5, 1000);
    const probing = canAttempt(opened, opened.openedAt! + DEFAULT_POLICY.cooldownMs + 1).snapshot;
    const { snapshot, transition } = recordOutcome(probing, false, 40_000);
    expect(snapshot.state).toBe("open");
    expect(transition?.reason).toMatch(/probe failed/);
  });

  it("does NOT close on a single successful probe — the asymmetry is the point", () => {
    const opened = fail(emptyBreaker(), 5, 1000);
    const probing = canAttempt(opened, opened.openedAt! + DEFAULT_POLICY.cooldownMs + 1).snapshot;
    const afterOne = recordOutcome(probing, true, 40_000);
    expect(afterOne.snapshot.state).toBe("half-open");
    expect(afterOne.transition).toBeNull();

    const afterTwo = recordOutcome(afterOne.snapshot, true, 40_100);
    expect(afterTwo.snapshot.state).toBe("closed");
    expect(afterTwo.transition?.to).toBe("closed");
  });

  it("clears the failure log when it closes, so old evidence cannot re-open it", () => {
    const opened = fail(emptyBreaker(), 5, 1000);
    const probing = canAttempt(opened, opened.openedAt! + DEFAULT_POLICY.cooldownMs + 1).snapshot;
    const closed = succeed(probing, DEFAULT_POLICY.successesToClose, 40_000);
    expect(closed.state).toBe("closed");
    expect(closed.outcomes).toHaveLength(0);

    // One failure immediately after recovery must not re-open: without the
    // clear, the five original failures would still be inside the window.
    const afterBlip = recordOutcome(closed, false, 40_500);
    expect(afterBlip.snapshot.state).toBe("closed");
  });

  it("forgets failures that fall out of the rolling window", () => {
    // Clocked from the newest outcome, not the oldest: the window is a
    // trailing one, so `first + windowMs` still has the last three failures
    // inside it.
    const snapshot = fail(emptyBreaker(), 4, 1000);
    const newest = snapshot.outcomes[snapshot.outcomes.length - 1][0];
    const later = prune(snapshot, newest + DEFAULT_POLICY.windowMs + 1, DEFAULT_POLICY);
    expect(later.outcomes).toHaveLength(0);
    expect(stats(later).samples).toBe(0);
  });

  it("bounds the outcome log so a hot dependency cannot grow it without limit", () => {
    const policy: BreakerPolicy = { ...DEFAULT_POLICY, windowMs: 10_000_000 };
    let current = emptyBreaker();
    for (let i = 0; i < 500; i += 1) {
      current = recordOutcome(current, i % 2 === 0, 1000 + i, policy).snapshot;
    }
    expect(current.outcomes.length).toBeLessThanOrEqual(100);
  });

  it("is load-independent: the same ratio opens it at any call volume", () => {
    // Ten calls, six failures.
    let sparse = emptyBreaker();
    for (let i = 0; i < 10; i += 1) sparse = recordOutcome(sparse, i >= 6, 1000 + i).snapshot;

    // A hundred calls, sixty failures — same ratio, ten times the traffic.
    let busy = emptyBreaker();
    for (let i = 0; i < 100; i += 1) busy = recordOutcome(busy, i >= 60, 1000 + i).snapshot;

    expect(sparse.state).toBe("open");
    expect(busy.state).toBe("open");
  });
});

describe("P21 chaos", () => {
  it("is reproducible from a seed", () => {
    const config = {
      seed: 42,
      calls: 60,
      intervalMs: 1000,
      phases: [
        { atCall: 10, profile: { errorRate: 0.7, timeoutRate: 0, latencyMs: 50 }, label: "bad" },
      ],
    };
    const first = runExperiment(config);
    const second = runExperiment(config);
    expect(second.steps).toEqual(first.steps);
    expect(second.rejected).toBe(first.rejected);
  });

  it("produces a different run from a different seed", () => {
    const base = {
      calls: 60,
      intervalMs: 1000,
      phases: [
        { atCall: 10, profile: { errorRate: 0.5, timeoutRate: 0, latencyMs: 50 }, label: "bad" },
      ],
    };
    const a = runExperiment({ ...base, seed: 1 });
    const b = runExperiment({ ...base, seed: 2 });
    expect(b.steps).not.toEqual(a.steps);
  });

  it("never opens the circuit against a healthy dependency", () => {
    const result = runExperiment({
      seed: 5,
      calls: 200,
      intervalMs: 1000,
      phases: [{ atCall: 0, profile: HEALTHY, label: "healthy" }],
    });
    expect(result.finalState).toBe("closed");
    expect(result.rejected).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("opens during a total outage and refuses calls", () => {
    const result = runExperiment({
      seed: 7,
      calls: 120,
      intervalMs: 1000,
      phases: [
        { atCall: 0, profile: HEALTHY, label: "healthy" },
        { atCall: 20, profile: { errorRate: 1, timeoutRate: 0, latencyMs: 40 }, label: "down" },
      ],
    });
    expect(result.rejected).toBeGreaterThan(0);
    // The number that justifies the breaker: far fewer calls reached a
    // dependency that was failing 100% of the time than were made.
    expect(result.failed).toBeLessThan(100);
  });

  it("recovers and closes once the dependency comes back", () => {
    const result = runExperiment({
      seed: 7,
      calls: 200,
      intervalMs: 1000,
      phases: [
        { atCall: 0, profile: HEALTHY, label: "healthy" },
        { atCall: 20, profile: { errorRate: 1, timeoutRate: 0, latencyMs: 40 }, label: "down" },
        { atCall: 70, profile: HEALTHY, label: "recovered" },
      ],
    });
    expect(result.finalState).toBe("closed");
  });

  it("saves more latency against a hanging dependency than an erroring one", () => {
    const shared = { seed: 11, calls: 120, intervalMs: 1000 };
    const hanging = runExperiment({
      ...shared,
      phases: [
        { atCall: 5, profile: { errorRate: 0, timeoutRate: 1, latencyMs: 40 }, label: "hang" },
      ],
    });
    const erroring = runExperiment({
      ...shared,
      phases: [
        { atCall: 5, profile: { errorRate: 1, timeoutRate: 0, latencyMs: 40 }, label: "error" },
      ],
    });
    expect(hanging.savedMs).toBeGreaterThan(erroring.savedMs);
  });

  it("summarises percentages that add up", () => {
    const result = runExperiment({
      seed: 3,
      calls: 100,
      intervalMs: 1000,
      phases: [
        { atCall: 10, profile: { errorRate: 0.8, timeoutRate: 0, latencyMs: 40 }, label: "bad" },
      ],
    });
    const summary = summarise(result);
    expect(summary.attempted).toBe(result.succeeded + result.failed);
    expect(summary.rejectedPct).toBeGreaterThanOrEqual(0);
    expect(summary.rejectedPct).toBeLessThanOrEqual(100);
  });

  it("draws a healthy profile as always-ok", () => {
    const rng = seeded(1);
    for (let i = 0; i < 50; i += 1) {
      expect(injectFault(HEALTHY, rng).result).toBe("ok");
    }
  });
});

describe("P21 trace context", () => {
  it("round-trips a traceparent", () => {
    const context = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sampled: true,
    };
    expect(parseTraceparent(formatTraceparent(context))).toEqual(context);
  });

  it("reads the sampled flag", () => {
    expect(
      parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00")?.sampled,
    ).toBe(false);
    expect(
      parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")?.sampled,
    ).toBe(true);
  });

  it("rejects malformed and all-zero headers rather than repairing them", () => {
    // An invented parent id would attach our spans to a trace that does not
    // exist. A gap in someone else's waterfall beats a lie in it.
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent("")).toBeNull();
    expect(parseTraceparent("garbage")).toBeNull();
    expect(parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7")).toBeNull();
    expect(parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01")).toBeNull();
    expect(parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01")).toBeNull();
    // Version 01 is not version 00, and we have not read its definition.
    expect(parseTraceparent("01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")).toBeNull();
  });
});

describe("P21 RED", () => {
  it("classes statuses the way an error budget needs", () => {
    expect(statusClassOf(200)).toBe("2xx");
    expect(statusClassOf(304)).toBe("3xx");
    // A 429 is the rate limiter working, not an outage.
    expect(statusClassOf(429)).toBe("4xx");
    expect(statusClassOf(500)).toBe("5xx");
    expect(statusClassOf(503)).toBe("5xx");
  });

  it("keeps the bucket boundaries ascending and unique", () => {
    // These are a one-way door: change them and every row written beforehand
    // measures something else. This test exists to make that change loud.
    const sorted = [...LATENCY_BUCKETS_MS].sort((a, b) => a - b);
    expect([...LATENCY_BUCKETS_MS]).toEqual(sorted);
    expect(new Set(LATENCY_BUCKETS_MS).size).toBe(LATENCY_BUCKETS_MS.length);
    expect(LATENCY_BUCKETS_MS).toEqual([10, 25, 50, 100, 250, 500, 1000, 2500, 5000]);
  });
});
