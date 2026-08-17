/**
 * P21 — a circuit breaker, as a pure state machine.
 *
 * Deliberately free of imports, I/O and clocks. Everything takes `now` as an
 * argument and returns the next state rather than mutating one. Three things
 * fall out of that, and all three are the reason it is written this way:
 *
 * - **The same code runs in both places.** lib/sre/breaker-store.ts drives it
 *   server-side with Redis-backed state in front of the real integrations;
 *   components/sre/chaos-lab.tsx drives it in the browser against an injected
 *   fault so a visitor can watch it trip. Not a reimplementation for the demo —
 *   the demo is the production breaker.
 * - **It is testable without waiting.** A cooldown expiring is `now + 31_000`,
 *   not a sleep.
 * - **It is serialisable.** The snapshot is plain JSON, which is what lets the
 *   state live in Redis and be shared across instances instead of each one
 *   keeping a private opinion about whether GitHub is up.
 *
 * **Why a failure *ratio* and not a failure count.** A threshold of "5 failures
 * opens the circuit" behaves completely differently at 10 requests a minute
 * than at 10,000, and this app sees both. A ratio over a rolling window is
 * load-independent, which is what makes one policy usable for an integration
 * called twice an hour and one called on every render.
 */

export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerPolicy {
  /** How far back outcomes count toward the ratio. */
  windowMs: number;
  /** Below this many outcomes in the window, the breaker never opens. */
  minimumSamples: number;
  /** Fraction of failures in the window that opens the circuit. */
  failureRatio: number;
  /** How long an open circuit rejects before allowing a probe. */
  cooldownMs: number;
  /** Consecutive probe successes needed to close again. */
  successesToClose: number;
}

export const DEFAULT_POLICY: BreakerPolicy = {
  windowMs: 60_000,
  // Five, because the ratio is meaningless below it: one failure out of one is
  // a 100% failure rate and says nothing at all about the dependency.
  minimumSamples: 5,
  failureRatio: 0.5,
  cooldownMs: 30_000,
  // Two rather than one. A single success can be a dependency that recovered
  // for exactly one request, and closing on it puts the full load straight back
  // onto something that is still unwell.
  successesToClose: 2,
};

/** Outcome log entry: `[whenMs, 1 for ok | 0 for failed]`. */
export type Outcome = [number, 0 | 1];

export interface BreakerSnapshot {
  state: BreakerState;
  /** Rolling window, oldest first. Pruned by `prune`. */
  outcomes: Outcome[];
  /** When the circuit last opened, for cooldown arithmetic. */
  openedAt: number | null;
  /** Consecutive successes since entering half-open. */
  halfOpenSuccesses: number;
}

export function emptyBreaker(): BreakerSnapshot {
  return { state: "closed", outcomes: [], openedAt: null, halfOpenSuccesses: 0 };
}

/**
 * Hard cap on retained outcomes.
 *
 * The window prunes by time, which is unbounded in *count* — a dependency
 * called a thousand times a second would hold a hundred thousand entries and
 * be serialised into Redis on every call. Capping the log keeps the ratio
 * honest (it is still the most recent N) while keeping the payload small.
 */
const MAX_OUTCOMES = 100;

/** Keep only the most recent MAX_OUTCOMES entries. */
function cap(outcomes: Outcome[]): Outcome[] {
  return outcomes.length > MAX_OUTCOMES ? outcomes.slice(-MAX_OUTCOMES) : outcomes;
}

export function prune(
  snapshot: BreakerSnapshot,
  now: number,
  policy: BreakerPolicy,
): BreakerSnapshot {
  const cutoff = now - policy.windowMs;
  const outcomes = cap(snapshot.outcomes.filter(([at]) => at > cutoff));
  return outcomes.length === snapshot.outcomes.length ? snapshot : { ...snapshot, outcomes };
}

export interface BreakerStats {
  samples: number;
  failures: number;
  ratio: number;
}

export function stats(snapshot: BreakerSnapshot): BreakerStats {
  const samples = snapshot.outcomes.length;
  const failures = snapshot.outcomes.reduce((total, [, ok]) => total + (ok ? 0 : 1), 0);
  return { samples, failures, ratio: samples === 0 ? 0 : failures / samples };
}

export interface Verdict {
  allowed: boolean;
  /** State *after* any time-based transition this check performed. */
  snapshot: BreakerSnapshot;
  transition: Transition | null;
  reason: string;
}

export interface Transition {
  from: BreakerState;
  to: BreakerState;
  failures: number;
  samples: number;
  reason: string;
}

/**
 * Ask whether a call may proceed.
 *
 * This is where open becomes half-open, and it has to be: the transition is
 * driven by the passage of time, and nothing else runs on a timer here. A
 * breaker whose cooldown only expired when someone happened to call
 * `recordOutcome` would stay open forever the moment traffic stopped — which is
 * exactly when it is holding back the request that would prove recovery.
 */
export function canAttempt(
  snapshot: BreakerSnapshot,
  now: number,
  policy: BreakerPolicy = DEFAULT_POLICY,
): Verdict {
  const pruned = prune(snapshot, now, policy);
  const current = stats(pruned);

  if (pruned.state === "closed") {
    return { allowed: true, snapshot: pruned, transition: null, reason: "circuit closed" };
  }

  if (pruned.state === "open") {
    const elapsed = now - (pruned.openedAt ?? now);
    if (elapsed < policy.cooldownMs) {
      const remaining = Math.ceil((policy.cooldownMs - elapsed) / 1000);
      return {
        allowed: false,
        snapshot: pruned,
        transition: null,
        reason: `circuit open, ${remaining}s of cooldown left`,
      };
    }

    const next: BreakerSnapshot = { ...pruned, state: "half-open", halfOpenSuccesses: 0 };
    return {
      allowed: true,
      snapshot: next,
      transition: {
        from: "open",
        to: "half-open",
        failures: current.failures,
        samples: current.samples,
        reason: `cooldown of ${policy.cooldownMs}ms elapsed — probing`,
      },
      reason: "half-open probe",
    };
  }

  // Half-open. Probes are allowed through one at a time in a single process;
  // across instances this is best-effort, and deliberately so — see the note in
  // lib/sre/breaker-store.ts about why a distributed probe lock is not worth
  // what it costs.
  return { allowed: true, snapshot: pruned, transition: null, reason: "half-open probe" };
}

/**
 * Fold the result of a guarded call back into the breaker.
 *
 * The half-open rules are asymmetric, and that asymmetry is the entire value of
 * the state: **one failure re-opens, but N successes are needed to close.**
 * Recovery has to be demonstrated; failure only has to be observed. A symmetric
 * breaker oscillates — it closes on the first success, floods the dependency,
 * fails, opens, and repeats, which is worse for the dependency than staying
 * open would have been.
 */
export function recordOutcome(
  snapshot: BreakerSnapshot,
  ok: boolean,
  now: number,
  policy: BreakerPolicy = DEFAULT_POLICY,
): { snapshot: BreakerSnapshot; transition: Transition | null } {
  const pruned = prune(snapshot, now, policy);
  // Capped *after* appending, not before. `prune` trims to MAX_OUTCOMES and
  // then this adds one, so trimming only inside prune leaves the log one entry
  // over the cap on every single call — a leak that grows by one per request
  // and was found by the test asserting the bound, not by reading this line.
  const outcomes: Outcome[] = cap([...pruned.outcomes, [now, ok ? 1 : 0]]);
  const next: BreakerSnapshot = { ...pruned, outcomes };
  const current = stats(next);

  if (pruned.state === "half-open") {
    if (!ok) {
      return {
        snapshot: { ...next, state: "open", openedAt: now, halfOpenSuccesses: 0 },
        transition: {
          from: "half-open",
          to: "open",
          failures: current.failures,
          samples: current.samples,
          reason: "probe failed — dependency still unhealthy",
        },
      };
    }

    const successes = pruned.halfOpenSuccesses + 1;
    if (successes >= policy.successesToClose) {
      return {
        // Outcomes are cleared on close, not carried. The window still holds
        // the failures that opened the circuit, and keeping them would let a
        // breaker that has just proven recovery re-open on the *old* evidence
        // the moment one more request fails.
        snapshot: { state: "closed", outcomes: [], openedAt: null, halfOpenSuccesses: 0 },
        transition: {
          from: "half-open",
          to: "closed",
          failures: current.failures,
          samples: current.samples,
          reason: `${successes} consecutive probes succeeded`,
        },
      };
    }

    return { snapshot: { ...next, halfOpenSuccesses: successes }, transition: null };
  }

  if (pruned.state === "closed") {
    const shouldOpen =
      current.samples >= policy.minimumSamples && current.ratio >= policy.failureRatio;

    if (shouldOpen) {
      return {
        snapshot: { ...next, state: "open", openedAt: now, halfOpenSuccesses: 0 },
        transition: {
          from: "closed",
          to: "open",
          failures: current.failures,
          samples: current.samples,
          reason: `${current.failures}/${current.samples} failed (${Math.round(current.ratio * 100)}% ≥ ${Math.round(policy.failureRatio * 100)}%)`,
        },
      };
    }

    return { snapshot: next, transition: null };
  }

  // Open, and a result arrived anyway — a call that was already in flight when
  // the circuit opened. Worth recording as evidence, never worth acting on:
  // the cooldown is what governs re-entry, and letting a late success shortcut
  // it would defeat the point of having one.
  return { snapshot: next, transition: null };
}
