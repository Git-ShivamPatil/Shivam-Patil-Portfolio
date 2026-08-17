import { isRedisConfigured, pipeline } from "../security/redis";
import { withSpan } from "./trace";
import {
  canAttempt,
  emptyBreaker,
  recordOutcome,
  stats,
  DEFAULT_POLICY,
  type BreakerPolicy,
  type BreakerSnapshot,
  type Transition,
} from "./breaker";

/**
 * P21 — where the breaker's state actually lives.
 *
 * The state machine in ./breaker.ts is pure; this is the half that has to
 * choose a storage medium, and the choice is the same one lib/rate-limit.ts
 * made: **Redis when it is configured, per-instance memory when it is not, and
 * never a failure.**
 *
 * That fallback is not a compromise here, it is the correct behaviour. A
 * breaker's job is to stop a failing dependency from consuming resources. If
 * the breaker's own store is unreachable and it responded by rejecting every
 * call, it would have caused a total outage of a healthy dependency in order to
 * protect it — the exact failure it exists to prevent, with the blast radius
 * turned up. So a store outage degrades to a per-instance breaker, which is
 * strictly better than no breaker and strictly worse than a shared one.
 *
 * **The probe race, stated rather than solved.** In half-open, several
 * instances can each send a probe before any of them writes its result back, so
 * a recovering dependency can briefly see one request per instance instead of
 * exactly one. Making that airtight needs a distributed lock on the probe —
 * lib/distsys/lock.ts exists and could do it — but it would put a lock
 * acquisition on the recovery path of every guarded call, to save a dependency
 * from a handful of requests at the precise moment it has just proven it can
 * serve them. Not worth it.
 */

/** Registered dependencies. Anything guarded gets a name here so /reliability can list it. */
export const BREAKER_TARGETS = ["github", "leetcode"] as const;
export type BreakerTarget = (typeof BREAKER_TARGETS)[number];

const REDIS_PREFIX = "cb:";

/**
 * TTL on the stored snapshot.
 *
 * Longer than the window so an idle dependency keeps its state, short enough
 * that a breaker nobody has called in an hour starts clean rather than opening
 * on hour-old evidence.
 */
const STATE_TTL_SECONDS = 15 * 60;

const globalForBreakers = globalThis as unknown as { breakerStates?: Map<string, BreakerSnapshot> };
const memory: Map<string, BreakerSnapshot> = (globalForBreakers.breakerStates ??= new Map());

function isSnapshot(value: unknown): value is BreakerSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BreakerSnapshot>;
  return (
    (candidate.state === "closed" ||
      candidate.state === "open" ||
      candidate.state === "half-open") &&
    Array.isArray(candidate.outcomes) &&
    typeof candidate.halfOpenSuccesses === "number"
  );
}

async function load(target: string): Promise<BreakerSnapshot> {
  if (isRedisConfigured()) {
    const results = await pipeline([["GET", `${REDIS_PREFIX}${target}`]]);
    const raw = results?.[0];
    if (typeof raw === "string") {
      try {
        const parsed: unknown = JSON.parse(raw);
        // Shape-checked rather than cast, for the reason
        // lib/integrations/cache.ts spells out: this payload outlives deploys,
        // and a snapshot written by an older shape would otherwise be read as
        // a breaker with `outcomes: undefined` and throw inside `prune`.
        if (isSnapshot(parsed)) return parsed;
        console.error(`[breaker] stored snapshot for "${target}" has an unexpected shape`);
      } catch {
        console.error(`[breaker] stored snapshot for "${target}" is not JSON`);
      }
    }
    if (results) return emptyBreaker();
    // Redis configured but silent — fall through to memory.
  }
  return memory.get(target) ?? emptyBreaker();
}

async function save(target: string, snapshot: BreakerSnapshot): Promise<void> {
  // Always write memory: it is the fallback, and keeping it warm means a Redis
  // outage mid-incident degrades to a breaker that already knows what has been
  // happening rather than to a blank one.
  memory.set(target, snapshot);

  if (!isRedisConfigured()) return;
  await pipeline([
    ["SET", `${REDIS_PREFIX}${target}`, JSON.stringify(snapshot), "EX", STATE_TTL_SECONDS],
  ]);
}

/**
 * Persist a transition, best-effort.
 *
 * Fire-and-forget against Postgres because the caller is on a request path and
 * a breaker transition is history, not control flow — the decision has already
 * been made and acted on by the time this runs. Failing to record it must not
 * fail the request that caused it.
 */
async function logTransition(target: string, transition: Transition): Promise<void> {
  try {
    const { prisma } = await import("../prisma");
    await prisma.breakerTransition.create({
      data: {
        target,
        from: transition.from,
        to: transition.to,
        failures: transition.failures,
        samples: transition.samples,
        reason: transition.reason,
      },
    });
  } catch (error) {
    console.error(
      `[breaker] could not record ${target} ${transition.from}→${transition.to}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** Thrown when the circuit rejects a call before it is attempted. */
export class CircuitOpenError extends Error {
  readonly target: string;

  constructor(target: string, reason: string) {
    super(`circuit for "${target}" is open: ${reason}`);
    this.name = "CircuitOpenError";
    this.target = target;
  }
}

/**
 * Run `fn` behind the breaker for `target`.
 *
 * Throws `CircuitOpenError` without calling `fn` when the circuit is open. That
 * is the point — the value of a breaker is the call it does *not* make — so
 * every caller needs a fallback. In this app they all have one already:
 * lib/integrations/cache.ts serves the last-good payload on any throw, so an
 * open circuit renders a stale stats panel instead of an error state, and does
 * it without spending eight seconds discovering the upstream is still down.
 */
export async function guard<T>(
  target: BreakerTarget,
  fn: () => Promise<T>,
  policy: BreakerPolicy = DEFAULT_POLICY,
): Promise<T> {
  const now = Date.now();
  const loaded = await load(target);
  const verdict = canAttempt(loaded, now, policy);

  if (verdict.transition) {
    await save(target, verdict.snapshot);
    void logTransition(target, verdict.transition);
  }

  if (!verdict.allowed) {
    // Recorded as a span even though no call is made — a rejection is the most
    // important thing this breaker ever does, and a trace that only contains
    // the calls that happened cannot explain why a page rendered stale data.
    await withSpan(
      `dependency ${target}`,
      {
        kind: "client",
        attributes: {
          "dependency.name": target,
          "breaker.state": verdict.snapshot.state,
          "breaker.rejected": true,
        },
      },
      async () => undefined,
    );
    throw new CircuitOpenError(target, verdict.reason);
  }

  // The span wraps only `fn`, not the state load and save around it. Those are
  // this breaker's own overhead, and including them would report the
  // dependency as slower than it is.
  return withSpan(
    `dependency ${target}`,
    {
      kind: "client",
      attributes: { "dependency.name": target, "breaker.state": verdict.snapshot.state },
    },
    async (span) => {
      try {
        const result = await fn();
        const settled = recordOutcome(verdict.snapshot, true, Date.now(), policy);
        await save(target, settled.snapshot);
        if (settled.transition) void logTransition(target, settled.transition);
        span.attributes["breaker.outcome"] = "ok";
        return result;
      } catch (error) {
        const settled = recordOutcome(verdict.snapshot, false, Date.now(), policy);
        await save(target, settled.snapshot);
        if (settled.transition) void logTransition(target, settled.transition);
        span.attributes["breaker.outcome"] = "failed";
        if (settled.transition) span.attributes["breaker.transition"] = settled.transition.to;
        // Re-thrown untouched. The breaker counts failures; it does not own them.
        throw error;
      }
    },
  );
}

export interface BreakerReport {
  target: string;
  state: BreakerSnapshot["state"];
  samples: number;
  failures: number;
  ratio: number;
  openedAt: number | null;
  /** True when the state came from Redis rather than this instance's memory. */
  shared: boolean;
}

/** Every registered breaker's current state, for /reliability. */
export async function breakerReports(): Promise<BreakerReport[]> {
  const shared = isRedisConfigured();
  return Promise.all(
    BREAKER_TARGETS.map(async (target) => {
      const snapshot = await load(target);
      const current = stats(snapshot);
      return {
        target,
        state: snapshot.state,
        samples: current.samples,
        failures: current.failures,
        ratio: current.ratio,
        openedAt: snapshot.openedAt,
        shared,
      };
    }),
  );
}
