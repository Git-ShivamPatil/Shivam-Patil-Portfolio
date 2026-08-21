/**
 * P27 — adaptive concurrency limiting, closed-loop.
 *
 * ### Why a token bucket is not enough on its own
 *
 * `lib/rate-limit.ts` meters **arrivals**. It is open-loop: it enforces the
 * number it was configured with and learns nothing from what happens
 * downstream. That is the right tool for "one caller may not monopolise this",
 * and it is the wrong tool for "the database is degraded".
 *
 * Consider `/api/ai/ask`, whose own source calls it the slowest route on the
 * site — an embedding plus two Postgres queries, one of them pgvector. Sized
 * for a healthy database, its bucket admits 12 concurrent bursts happily. When
 * Neon slows from 40ms to 4s, the bucket admits *exactly the same traffic*,
 * every request now holding a connection twenty times longer. The limiter
 * configured to protect the database has become the thing feeding it. Latency
 * rises, the pool exhausts, and the failure spreads to every route that shares
 * it — none of which were under load.
 *
 * ### What this does instead
 *
 * Gradient-based limiting, the Netflix `concurrency-limits` idea. Little's law
 * says `L = λW`: for a fixed arrival rate, the number in flight rises exactly
 * as service time does. So in-flight count is a *measurement of downstream
 * health*, and the limit should be derived from it rather than fixed.
 *
 *   gradient  = longRTT / shortRTT      (1.0 when healthy, → 0 as it degrades)
 *   newLimit  = limit × gradient + queue
 *   queue     = √limit                  (headroom, so it can grow again)
 *
 * `longRTT` is the best latency ever observed — what the system does when
 * nothing is wrong. `shortRTT` is recent. Their ratio is a unitless measure of
 * how far from healthy we are, which is why this needs no threshold anyone has
 * to tune, and why it keeps working when the hardware changes underneath it.
 *
 * ### The queue term is the part that is easy to get wrong
 *
 * Without it, `newLimit = limit × gradient` can only ever shrink or stay put:
 * a gradient of exactly 1.0 is the best case and it is a fixed point. The
 * limiter would ratchet down on the first blip and never recover. `√limit` is
 * the standard allowance — it lets the limit probe upward whenever latency is
 * good, and it grows sub-linearly so a high limit does not probe recklessly.
 *
 * ### What it does NOT detect, and this surprises people
 *
 * **A route that is uniformly slow is not a degraded route.** The gradient is
 * a route's current latency against its own best, not against any absolute
 * budget — so an endpoint that has always taken two seconds converges to
 * `longRTT ≈ shortRTT ≈ 2s`, a gradient of 1.0, and the limit opens fully.
 * That is correct: it is a two-second route, and throttling it would be the
 * limiter inventing a problem nobody has. Only a *change* closes the limit.
 *
 * This was found by a test asserting the opposite, which failed. If you want
 * an absolute latency ceiling, that is a different mechanism — a circuit
 * breaker on a p99 threshold, which `lib/sre/breaker.ts` already is.
 *
 * ### What this honestly is not
 *
 * **In-process.** State lives per serverless instance, so a site spread across
 * ten warm instances runs ten independent limiters and the effective global
 * limit is ten times one instance's. That is the same limitation
 * `lib/rate-limit.ts` documents for its in-memory bucket, and it matters much
 * less here: the signal being measured — *this instance's* observed latency to
 * a shared database — is the same signal every instance sees, so they degrade
 * together without needing to coordinate. Sharing the state would make the
 * limit exact; it would not make the reaction more correct.
 *
 * A distributed version would put the counter in Redis, and would then have to
 * answer what happens when Redis is the thing that is slow. That is a real
 * design question and not one worth answering speculatively.
 */

export interface LimiterOptions {
  /** Where the limit starts, and the floor it may never go below. */
  minLimit?: number;
  /** Ceiling, so a fast burst cannot admit unbounded concurrency. */
  maxLimit?: number;
  /** How fast the limit moves. Lower is smoother and slower to react. */
  smoothing?: number;
  /** How much of longRTT survives each update — its decay toward current reality. */
  longWindow?: number;
}

export interface LimiterState {
  limit: number;
  inFlight: number;
  shortRttMs: number | null;
  longRttMs: number | null;
  /** Requests shed since process start. Diagnostics, not billing. */
  dropped: number;
}

const DEFAULTS = {
  /**
   * Four, not one.
   *
   * The floor is what the limiter falls back to under sustained degradation,
   * and a floor of one serialises the route — turning a slow dependency into a
   * queue that is slower still. Four keeps a degraded route usable while still
   * being far below what a healthy one admits.
   */
  minLimit: 4,
  maxLimit: 64,
  /**
   * 0.2 — the new estimate contributes a fifth of the move.
   *
   * High enough to react inside a few requests, low enough that one slow
   * request cannot halve the limit on its own. An unsmoothed limiter
   * oscillates: it clamps hard on a blip, the clamp reduces load, latency
   * recovers, it opens fully, and the cycle repeats.
   */
  smoothing: 0.2,
  /**
   * longRTT decays slowly toward current latency rather than being a hard
   * all-time minimum. A permanent minimum means one unusually fast response
   * early in a process's life defines "healthy" forever, and every honest
   * measurement afterwards reads as degradation.
   */
  longWindow: 0.99,
};

/**
 * One limiter per route.
 *
 * Deliberately a class rather than module-level maps: `/api/ai/ask` and
 * `/api/rpc` have unrelated latency profiles, and a shared estimate would let
 * a slow retrieval call throttle a protobuf encode that is doing fine.
 */
export class AdaptiveLimiter {
  private limit: number;
  private inFlight = 0;
  private shortRtt: number | null = null;
  private longRtt: number | null = null;
  private dropped = 0;

  private readonly minLimit: number;
  private readonly maxLimit: number;
  private readonly smoothing: number;
  private readonly longWindow: number;

  constructor(options: LimiterOptions = {}) {
    this.minLimit = options.minLimit ?? DEFAULTS.minLimit;
    this.maxLimit = options.maxLimit ?? DEFAULTS.maxLimit;
    this.smoothing = options.smoothing ?? DEFAULTS.smoothing;
    this.longWindow = options.longWindow ?? DEFAULTS.longWindow;
    // Starts at the floor and probes upward. Starting at the ceiling would
    // admit maximum concurrency during exactly the window where nothing is
    // known about downstream health yet.
    this.limit = this.minLimit;
  }

  state(): LimiterState {
    return {
      limit: Math.round(this.limit),
      inFlight: this.inFlight,
      shortRttMs: this.shortRtt,
      longRttMs: this.longRtt,
      dropped: this.dropped,
    };
  }

  /**
   * Try to enter. Returns null when the request should be shed.
   *
   * The returned function MUST be called exactly once — leaking one leaks a
   * permanent slot and the limiter closes over time. Callers use try/finally;
   * `guard()` below wraps that so a route cannot get it wrong.
   */
  acquire(): (() => void) | null {
    if (this.inFlight >= Math.round(this.limit)) {
      this.dropped += 1;
      return null;
    }

    this.inFlight += 1;
    const startedAt = Date.now();
    let released = false;

    return () => {
      // Idempotent. A double release would decrement in-flight below the real
      // value and admit more concurrency than the limit says.
      if (released) return;
      released = true;
      this.inFlight -= 1;
      this.observe(Date.now() - startedAt);
    };
  }

  /** Fold one completed request's latency into the estimate and re-derive the limit. */
  private observe(rttMs: number): void {
    // Zero-millisecond timings are real on a fast path and would make the
    // gradient divide by zero. One millisecond is the smallest honest floor.
    const sample = Math.max(rttMs, 1);

    this.shortRtt = this.shortRtt === null ? sample : this.shortRtt * 0.8 + sample * 0.2;

    if (this.longRtt === null) {
      this.longRtt = sample;
    } else if (sample < this.longRtt) {
      // A new best is adopted immediately: it is direct evidence of what the
      // system can do, and there is no reason to average toward good news.
      this.longRtt = sample;
    } else {
      this.longRtt = this.longRtt * this.longWindow + sample * (1 - this.longWindow);
    }

    const gradient = Math.max(0.5, Math.min(1, this.longRtt / this.shortRtt));
    const queue = Math.sqrt(this.limit);
    const target = this.limit * gradient + queue;

    this.limit = Math.max(
      this.minLimit,
      Math.min(this.maxLimit, this.limit * (1 - this.smoothing) + target * this.smoothing),
    );
  }

  /**
   * Run `work` under the limit, or return null if it must be shed.
   *
   * The `finally` is the whole reason this exists rather than callers using
   * `acquire()` directly: a route that throws between acquire and release
   * leaks a slot, and enough leaks close the limiter permanently. That failure
   * is invisible until the route stops serving anyone.
   */
  async guard<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    const release = this.acquire();
    if (!release) return { ok: false };

    try {
      return { ok: true, value: await work() };
    } finally {
      release();
    }
  }
}

/**
 * Limiters, keyed by route, surviving hot reload the same way the rate
 * limiter's buckets do.
 */
const globalForLimiters = globalThis as unknown as {
  adaptiveLimiters?: Map<string, AdaptiveLimiter>;
};
const limiters: Map<string, AdaptiveLimiter> = (globalForLimiters.adaptiveLimiters ??= new Map());

export function limiterFor(route: string, options?: LimiterOptions): AdaptiveLimiter {
  let limiter = limiters.get(route);
  if (!limiter) {
    limiter = new AdaptiveLimiter(options);
    limiters.set(route, limiter);
  }
  return limiter;
}

/** Every limiter's current state, for /reliability and /api/health. */
export function limiterStates(): Record<string, LimiterState> {
  return Object.fromEntries([...limiters].map(([route, limiter]) => [route, limiter.state()]));
}

/** Test seam. Nothing in the app calls this. */
export function resetLimiters(): void {
  limiters.clear();
}
