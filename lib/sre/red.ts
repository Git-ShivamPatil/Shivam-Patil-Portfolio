import { after } from "next/server";
import { newSpanId } from "./trace";

/**
 * P21 — RED metrics (rate, errors, duration) that survive being serverless.
 *
 * lib/observability/metrics.ts opens with an argument for why it exposes only
 * gauges and not one counter: an in-process counter lives in one instance's
 * memory, a scrape reaches an arbitrary instance, and the resulting series
 * jumps between unrelated totals. It ends by naming the fix — "an in-process
 * registry here plus one replica per scrape target" if self-hosted, otherwise
 * shared state. This file is the shared-state version, and it is what makes
 * `portfolio_http_requests_total` in that file a real counter rather than a
 * number that resets when the platform recycles a container.
 *
 * **The shape.** Each instance accumulates deltas in memory, then appends them
 * to Postgres as rows — never upserts. Two instances flushing the same instant
 * write two rows that sum correctly, so there is no write conflict and no
 * unique constraint to race on. Reads GROUP BY and sum. See the schema comment
 * on RequestMetric for why that mattered enough to pay a GROUP BY for.
 *
 * **The cost, stated plainly.** A flush is a database write on the response
 * path — it runs inside `after()`, so the visitor never waits for it, but it is
 * still work the request pays for. That is why the flush is debounced rather
 * than per-request: a busy instance writes one row per series per interval, not
 * one per request.
 */

/**
 * Cumulative histogram boundaries in milliseconds.
 *
 * Chosen for what this app actually does rather than from a default: 10ms is a
 * cache hit, 100ms is a Neon round trip from the same region, 1s is a page that
 * needs explaining, and 5s means an upstream is hanging. Boundaries are a
 * one-way door — change them and every row written before the change measures a
 * different thing — so they live here as a named constant and are versioned by
 * being left alone.
 */
export const LATENCY_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;

export type StatusClass = "2xx" | "3xx" | "4xx" | "5xx";

export function statusClassOf(status: number): StatusClass {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

interface Aggregate {
  route: string;
  method: string;
  statusClass: StatusClass;
  count: number;
  errors: number;
  durationSumMs: number;
  durationMaxMs: number;
  /** Cumulative counts, one per boundary above plus a final +Inf. */
  buckets: number[];
}

/**
 * The accumulator, on globalThis so a dev-server module reload does not silently
 * drop counts — the same reason lib/rate-limit.ts and lib/prisma.ts do it.
 */
const globalForRed = globalThis as unknown as {
  redBuffer?: Map<string, Aggregate>;
  redFlushedAt?: number;
  redInstanceId?: string;
};

const buffer: Map<string, Aggregate> = (globalForRed.redBuffer ??= new Map());

/**
 * A stable id for this instance for as long as it lives.
 *
 * Not `VERCEL_REGION` alone: several instances run in one region, and the
 * question this column answers ("is one of them bad") needs to tell them apart.
 * Region is prefixed so the common case stays readable.
 */
export function instanceId(): string {
  return (globalForRed.redInstanceId ??= `${process.env.VERCEL_REGION ?? "local"}-${newSpanId().slice(0, 8)}`);
}

/** How long deltas may sit in memory before a flush is due. */
const FLUSH_AFTER_MS = 15_000;

/**
 * Hard cap on distinct series held in memory.
 *
 * `withRed` takes a route *label* written by hand at the call site, so
 * cardinality is bounded by the number of call sites and this should never
 * trip. It exists because the one way it could trip — someone passing a
 * resolved path with an id in it — turns a bounded table into an unbounded one,
 * and an OOM on the instance is a worse way to find that out than a log line.
 */
const MAX_SERIES = 200;

function keyOf(route: string, method: string, statusClass: StatusClass): string {
  return `${route}|${method}|${statusClass}`;
}

/**
 * Record one request.
 *
 * Pure bookkeeping in memory — no I/O, no await. Safe to call from anywhere,
 * including a path that is already failing.
 */
export function record(
  route: string,
  method: string,
  status: number,
  durationMs: number,
  now = Date.now(),
): void {
  const statusClass = statusClassOf(status);
  const key = keyOf(route, method, statusClass);

  let aggregate = buffer.get(key);
  if (!aggregate) {
    if (buffer.size >= MAX_SERIES) {
      console.error(
        `[red] refusing to track "${route}" — ${MAX_SERIES} series already held. ` +
          `A route label almost certainly contains a resolved id.`,
      );
      return;
    }
    aggregate = {
      route,
      method,
      statusClass,
      count: 0,
      errors: 0,
      durationSumMs: 0,
      durationMaxMs: 0,
      buckets: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0),
    };
    buffer.set(key, aggregate);
  }

  aggregate.count += 1;
  if (status >= 500) aggregate.errors += 1;
  aggregate.durationSumMs += durationMs;
  aggregate.durationMaxMs = Math.max(aggregate.durationMaxMs, durationMs);

  // Cumulative: a 40ms request counts in le50, le100, ... and le+Inf. That is
  // what makes the columns summable across rows and quantile-able on read.
  for (let i = 0; i < LATENCY_BUCKETS_MS.length; i += 1) {
    if (durationMs <= LATENCY_BUCKETS_MS[i]) aggregate.buckets[i] += 1;
  }
  aggregate.buckets[LATENCY_BUCKETS_MS.length] += 1;

  globalForRed.redFlushedAt ??= now;
}

function flushDue(now: number): boolean {
  if (buffer.size === 0) return false;
  return now - (globalForRed.redFlushedAt ?? now) >= FLUSH_AFTER_MS;
}

/**
 * Write the buffered deltas and clear them.
 *
 * The buffer is drained *before* the await, not after. If the write fails, the
 * counts are gone rather than double-counted on the next flush — the wrong
 * trade for billing, the right one for a burn rate, where a gap reads as a gap
 * and a double-count reads as an incident that never happened.
 */
export async function flush(now = Date.now()): Promise<void> {
  if (buffer.size === 0) return;

  const drained = [...buffer.values()];
  buffer.clear();
  globalForRed.redFlushedAt = now;

  // Truncate to the minute the flush lands in. Every delta in this batch was
  // observed within FLUSH_AFTER_MS of it, which is well inside one bucket.
  const bucketStart = new Date(Math.floor(now / 60_000) * 60_000);
  const instance = instanceId();

  try {
    const { prisma } = await import("../prisma");
    await prisma.requestMetric.createMany({
      data: drained.map((aggregate) => ({
        bucketStart,
        route: aggregate.route,
        method: aggregate.method,
        statusClass: aggregate.statusClass,
        instance,
        count: aggregate.count,
        errors: aggregate.errors,
        durationSumMs: Math.round(aggregate.durationSumMs),
        durationMaxMs: Math.round(aggregate.durationMaxMs),
        le10: aggregate.buckets[0],
        le25: aggregate.buckets[1],
        le50: aggregate.buckets[2],
        le100: aggregate.buckets[3],
        le250: aggregate.buckets[4],
        le500: aggregate.buckets[5],
        le1000: aggregate.buckets[6],
        le2500: aggregate.buckets[7],
        le5000: aggregate.buckets[8],
        leInf: aggregate.buckets[9],
      })),
    });
  } catch (error) {
    // Losing metrics must never fail a request. This runs in `after()`, where
    // an unhandled rejection would be logged by the platform as an error on a
    // request that actually succeeded.
    console.error(
      `[red] flush of ${drained.length} series failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Wrap a route handler so every response it produces is measured.
 *
 * `route` must be a literal written here at the call site — the route
 * *pattern*, not the resolved path. See MAX_SERIES.
 *
 * A throw is recorded as a 500 and re-thrown. Next's `onRequestError` hook in
 * instrumentation.ts reports it; this only counts it, because a handler that
 * throws is exactly the request an error rate is supposed to notice, and a
 * measurement layer that only sees clean returns will report 100% availability
 * during an outage.
 */
export function withRed<A extends unknown[]>(
  route: string,
  handler: (request: Request, ...rest: A) => Promise<Response>,
): (request: Request, ...rest: A) => Promise<Response> {
  return async (request: Request, ...rest: A): Promise<Response> => {
    const started = Date.now();
    let status = 500;

    try {
      const response = await handler(request, ...rest);
      status = response.status;
      return response;
    } finally {
      const now = Date.now();
      record(route, request.method, status, now - started, now);

      // `after()` runs once the response has been sent. Registering it inside
      // `finally` means it is registered on the throw path too, which is the
      // path whose numbers matter most.
      if (flushDue(now)) {
        try {
          after(() => flush());
        } catch {
          // `after()` throws outside a request scope (a unit test calling the
          // wrapped handler directly). Flushing inline there is correct and
          // costs nothing, since there is no visitor waiting on it.
          void flush();
        }
      }
    }
  };
}
