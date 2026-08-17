import {
  canAttempt,
  emptyBreaker,
  recordOutcome,
  stats,
  DEFAULT_POLICY,
  type BreakerPolicy,
  type BreakerSnapshot,
  type BreakerState,
} from "./breaker";

/**
 * P21 — fault injection, and the experiment that uses it.
 *
 * **Deterministic, and that is the whole design.** Chaos engineering that
 * cannot be replayed is not an experiment, it is an anecdote: the run that
 * found the interesting failure is gone the moment it finishes, and "it did
 * something odd earlier" is not a bug report. Every random decision here comes
 * from a seeded generator, so a seed plus a config reproduces a run exactly —
 * on another machine, in a test, or a month later.
 *
 * Pure and import-free for the same reason ./breaker.ts is: the experiment
 * runs in the visitor's browser on /reliability, and in vitest, with no
 * server involved either time.
 */

/**
 * mulberry32 — 32-bit seeded PRNG.
 *
 * `Math.random()` cannot be seeded, which rules it out entirely. This is nine
 * lines, passes the statistical tests that matter for choosing whether a
 * simulated request fails, and is not cryptographic — nothing here is a secret,
 * and pretending otherwise by reaching for `crypto` would only make the run
 * unreproducible.
 */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FaultProfile {
  /** Probability in [0,1] that a call fails outright. */
  errorRate: number;
  /** Probability in [0,1] that a call hangs past the deadline. */
  timeoutRate: number;
  /** Added latency on a call that does succeed, in milliseconds. */
  latencyMs: number;
}

export const HEALTHY: FaultProfile = { errorRate: 0, timeoutRate: 0, latencyMs: 30 };

export type CallResult = "ok" | "error" | "timeout" | "rejected";

/**
 * Decide what one call to the faulty dependency does.
 *
 * Timeout is drawn before error, and the two probabilities are independent
 * draws rather than slices of one — a dependency that is both slow and erroring
 * is the realistic failure, not a mutually exclusive choice between them.
 */
export function injectFault(
  profile: FaultProfile,
  rng: () => number,
): {
  result: Exclude<CallResult, "rejected">;
  latencyMs: number;
} {
  if (rng() < profile.timeoutRate) {
    return { result: "timeout", latencyMs: 8000 };
  }
  if (rng() < profile.errorRate) {
    return { result: "error", latencyMs: profile.latencyMs };
  }
  return { result: "ok", latencyMs: profile.latencyMs };
}

export interface ExperimentConfig {
  seed: number;
  /** How many calls to make. */
  calls: number;
  /** Simulated milliseconds between calls. */
  intervalMs: number;
  /**
   * The dependency's health over time. Each entry applies from its `atCall`
   * until the next one — which is what lets an experiment model "GitHub broke
   * at call 20 and recovered at call 60", the only shape where a breaker's
   * behaviour is actually interesting.
   */
  phases: { atCall: number; profile: FaultProfile; label: string }[];
  policy?: BreakerPolicy;
}

export interface ExperimentStep {
  call: number;
  atMs: number;
  phase: string;
  /** What the breaker decided *before* the call. */
  stateBefore: BreakerState;
  result: CallResult;
  latencyMs: number;
  stateAfter: BreakerState;
  transitioned: boolean;
  note: string;
}

export interface ExperimentResult {
  steps: ExperimentStep[];
  /** Calls the breaker refused to make — the number that justifies its existence. */
  rejected: number;
  /** Calls that reached the dependency and failed. */
  failed: number;
  succeeded: number;
  /** Wall-clock the dependency was spared, in simulated milliseconds. */
  savedMs: number;
  finalState: BreakerState;
}

function profileAt(
  config: ExperimentConfig,
  call: number,
): { profile: FaultProfile; label: string } {
  let active = { profile: HEALTHY, label: "healthy" };
  for (const phase of config.phases) {
    if (call >= phase.atCall) active = { profile: phase.profile, label: phase.label };
  }
  return active;
}

/**
 * Drive the real breaker through a simulated incident.
 *
 * Simulated time, not real time: `atMs` advances by `intervalMs` per call and
 * is handed to the breaker as `now`. A 200-call experiment covering ten minutes
 * of cooldowns and recoveries therefore runs instantly, which is what makes it
 * something a visitor will actually sit through.
 *
 * The breaker being exercised is the production one from ./breaker.ts,
 * unmodified. If this experiment shows the circuit opening after twelve
 * failures, that is because the code that guards the real GitHub integration
 * opens after twelve failures.
 */
export function runExperiment(config: ExperimentConfig): ExperimentResult {
  const policy = config.policy ?? DEFAULT_POLICY;
  const rng = seeded(config.seed);

  let snapshot: BreakerSnapshot = emptyBreaker();
  const steps: ExperimentStep[] = [];

  let rejected = 0;
  let failed = 0;
  let succeeded = 0;
  let savedMs = 0;

  for (let call = 0; call < config.calls; call += 1) {
    const atMs = call * config.intervalMs;
    const { profile, label } = profileAt(config, call);
    const stateBefore = snapshot.state;

    const verdict = canAttempt(snapshot, atMs, policy);
    snapshot = verdict.snapshot;

    if (!verdict.allowed) {
      rejected += 1;
      // What the call *would* have cost had it been made. Counting the timeout
      // budget rather than the healthy latency is the honest figure: the calls
      // a breaker rejects are, by construction, the ones that were about to be
      // slow.
      savedMs += profile.timeoutRate > 0 ? 8000 : profile.latencyMs;
      steps.push({
        call,
        atMs,
        phase: label,
        stateBefore,
        result: "rejected",
        latencyMs: 0,
        stateAfter: snapshot.state,
        transitioned: stateBefore !== snapshot.state,
        note: verdict.reason,
      });
      continue;
    }

    const { result, latencyMs } = injectFault(profile, rng);
    const ok = result === "ok";
    if (ok) succeeded += 1;
    else failed += 1;

    const settled = recordOutcome(snapshot, ok, atMs + latencyMs, policy);
    snapshot = settled.snapshot;

    steps.push({
      call,
      atMs,
      phase: label,
      stateBefore: verdict.snapshot.state,
      result,
      latencyMs,
      stateAfter: snapshot.state,
      transitioned: Boolean(settled.transition) || stateBefore !== verdict.snapshot.state,
      note: settled.transition?.reason ?? verdict.reason,
    });
  }

  return { steps, rejected, failed, succeeded, savedMs, finalState: snapshot.state };
}

/** The same numbers the breaker would report, for the summary line under a run. */
export function summarise(result: ExperimentResult): {
  attempted: number;
  rejectedPct: number;
  errorPct: number;
} {
  const attempted = result.succeeded + result.failed;
  const total = attempted + result.rejected;
  return {
    attempted,
    rejectedPct: total === 0 ? 0 : (result.rejected / total) * 100,
    errorPct: attempted === 0 ? 0 : (result.failed / attempted) * 100,
  };
}

/* --------------------------------------------------------- server-side arm */

/**
 * Server-side fault injection, off unless `CHAOS_ENABLED` is set.
 *
 * **Off by default and it stays that way in production.** The browser
 * experiment above is the demonstration; this exists so the breaker can be
 * exercised against the *real* integration path in a preview deploy, which is
 * the only way to find out whether the fallback in lib/integrations/cache.ts
 * actually renders a stale panel rather than throwing. Reading the env var on
 * every call rather than caching it means switching it off takes effect
 * immediately, without a redeploy.
 */
export function chaosProfile(target: string): FaultProfile | null {
  if (process.env.CHAOS_ENABLED !== "1") return null;

  const raw = process.env[`CHAOS_${target.toUpperCase()}`];
  if (!raw) return null;

  // "errorRate:0.5,latencyMs:200" — a format small enough to not need a parser
  // and explicit enough to not be guessed at.
  const profile: FaultProfile = { ...HEALTHY };
  for (const pair of raw.split(",")) {
    const [key, value] = pair.split(":").map((part) => part.trim());
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    if (key === "errorRate") profile.errorRate = Math.min(1, Math.max(0, parsed));
    if (key === "timeoutRate") profile.timeoutRate = Math.min(1, Math.max(0, parsed));
    if (key === "latencyMs") profile.latencyMs = Math.max(0, parsed);
  }
  return profile;
}

/** Apply a configured fault to a real call site. No-op when chaos is off. */
export async function withChaos<T>(target: string, fn: () => Promise<T>): Promise<T> {
  const profile = chaosProfile(target);
  if (!profile) return fn();

  const { result, latencyMs } = injectFault(profile, Math.random);
  if (result === "timeout") {
    await new Promise((resolve) => setTimeout(resolve, Math.min(latencyMs, 10_000)));
    throw new Error(`[chaos] injected timeout for ${target}`);
  }
  if (result === "error") {
    throw new Error(`[chaos] injected error for ${target}`);
  }
  if (profile.latencyMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, profile.latencyMs));
  }
  return fn();
}

/** Re-exported so the lab imports one module. */
export { stats as breakerStats, DEFAULT_POLICY };
