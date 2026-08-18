import { after } from "next/server";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * P21 — OpenTelemetry, as the wire format rather than as a dependency.
 *
 * **Why this is hand-rolled.** The idiomatic answer is `@vercel/otel` plus
 * `@opentelemetry/sdk-node`, which is roughly 40 transitive packages and a
 * meaningful cold-start cost, in exchange for auto-instrumentation of libraries
 * this app does not use. What is actually needed is narrower and completely
 * specified by two public documents: W3C Trace Context for propagation, and
 * OTLP/HTTP+JSON for export. Both are implemented here in full. This is the
 * same trade lib/security/redis.ts and lib/storage/s3.ts already made — the
 * protocol is small, so speak it directly.
 *
 * The consequence worth stating: there is **no auto-instrumentation**. A span
 * exists because a call site asked for one. That is a real limitation compared
 * with the SDK, and it is why `withSpan` is deliberately cheap to call.
 *
 * **Node-only, on purpose.** `AsyncLocalStorage` is how the active span is
 * carried across awaits without threading a context argument through every
 * signature. It exists in the Edge runtime too, but this module also exports to
 * a collector with a Node-shaped timeout, and nothing on the Edge path traces.
 * Do not import this from proxy.ts.
 */

const HEX = "0123456789abcdef";

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let out = "";
  for (const byte of buffer) out += HEX[byte >> 4] + HEX[byte & 15];
  return out;
}

/** 16 bytes, and never all-zero — the spec makes an all-zero trace id invalid. */
export function newTraceId(): string {
  let id = randomHex(16);
  while (/^0{32}$/.test(id)) id = randomHex(16);
  return id;
}

/** 8 bytes, same all-zero rule. */
export function newSpanId(): string {
  let id = randomHex(8);
  while (/^0{16}$/.test(id)) id = randomHex(8);
  return id;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  /** The `sampled` bit of the trace-flags byte. */
  sampled: boolean;
}

/**
 * Parse `traceparent: 00-<trace-id>-<parent-id>-<flags>`.
 *
 * Strict, and returns null rather than repairing anything. A malformed header
 * means the caller is not actually in a trace we can join, and inventing a
 * parent id for it would attach our spans to a trace that does not exist — a
 * gap in someone else's waterfall is better than a lie in it.
 *
 * Version `00` only. The spec says a future version must be accepted if it is
 * longer and still parses as `00`, but nothing emits one yet, and accepting a
 * version we have not read the definition of is how a parser ends up wrong.
 */
export function parseTraceparent(header: string | null | undefined): TraceContext | null {
  if (!header) return null;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header.trim());
  if (!match) return null;

  const [, traceId, spanId, flags] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;

  return { traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

export type SpanKind = "internal" | "server" | "client";

/** OTLP encodes kind as an enum; these are the values from the proto. */
const KIND_CODE: Record<SpanKind, number> = { internal: 1, server: 2, client: 3 };

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  startedAt: number;
  endedAt: number | null;
  attributes: Record<string, string | number | boolean>;
  /** null while running, then "ok" or the error. */
  error: string | null;
}

interface ActiveContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

const storage = new AsyncLocalStorage<ActiveContext>();

/** The trace this code is running inside, if any. */
export function currentContext(): ActiveContext | null {
  return storage.getStore() ?? null;
}

/**
 * The current trace id, for a log line or a response header.
 *
 * Returning null rather than minting one matters: a trace id that appears in a
 * log but belongs to no span is worse than no trace id, because it invites a
 * search that will never find anything.
 */
export function currentTraceId(): string | null {
  return storage.getStore()?.traceId ?? null;
}

/**
 * Completed spans from this instance, newest last.
 *
 * **Per-instance, and /reliability says so on the page.** This is the same
 * constraint lib/observability/metrics.ts is about: a serverless instance's
 * memory is not shared state, so this buffer shows the traces that happened to
 * land on whichever instance answered. It is a debugging aid and a
 * demonstration, not an observability backend — that is what OTLP export is
 * for, and when a collector is configured this buffer stops being the only
 * copy.
 */
const RING_SIZE = 100;
const globalForSpans = globalThis as unknown as { sreSpans?: Span[] };
const finished: Span[] = (globalForSpans.sreSpans ??= []);

export function recentSpans(limit = RING_SIZE): Span[] {
  return finished.slice(-limit);
}

/** Grouped into traces, newest trace first — the shape /reliability renders. */
export function recentTraces(limit = 12): { traceId: string; spans: Span[]; startedAt: number }[] {
  const byTrace = new Map<string, Span[]>();
  for (const span of finished) {
    const list = byTrace.get(span.traceId);
    if (list) list.push(span);
    else byTrace.set(span.traceId, [span]);
  }

  return [...byTrace.entries()]
    .map(([traceId, spans]) => ({
      traceId,
      spans: [...spans].sort((a, b) => a.startedAt - b.startedAt),
      startedAt: Math.min(...spans.map((s) => s.startedAt)),
    }))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

/**
 * Spans completed on this instance that have not yet been shipped to a
 * collector. Empty, and never written to, when no collector is configured.
 *
 * Separate from `finished` because the two have opposite lifetimes: `finished`
 * is a rolling window kept deliberately so /reliability has something to show,
 * and this is a queue that must be emptied exactly once.
 */
const globalForPending = globalThis as unknown as { sreSpansPending?: Span[] };
const pendingExport: Span[] = (globalForPending.sreSpansPending ??= []);

/**
 * Ship whatever is queued, and clear the queue first.
 *
 * The splice happens before the await so a second flush racing this one cannot
 * send the same spans twice. Losing a batch to a collector outage is the
 * accepted failure mode; double-counting latency is not.
 */
async function flushPending(): Promise<void> {
  if (pendingExport.length === 0) return;
  const batch = pendingExport.splice(0, pendingExport.length);
  await exportSpans(batch);
}

function retire(span: Span) {
  finished.push(span);
  // Trim from the front rather than letting a long-lived instance grow without
  // bound. splice once rather than shift-per-push: shift is O(n) each time.
  if (finished.length > RING_SIZE * 2) finished.splice(0, finished.length - RING_SIZE);

  // Hand the span to the exporter, if there is one.
  //
  // **This wiring was missing, and its absence made a claim on /reliability
  // false.** `exportSpans` below has always been a complete OTLP/HTTP exporter,
  // and the page told visitors that setting OTEL_EXPORTER_OTLP_ENDPOINT was "a
  // URL, not a code change" and that with a collector configured "spans are
  // exported off-box and the list below is only a local echo". Nothing called
  // it. A grep for `exportSpans` across the repository returned exactly one
  // hit: its own definition. Setting the variable changed which sentence
  // rendered and nothing else.
  //
  // The scheduling mirrors lib/sre/red.ts, which solved the same problem for
  // metrics: register inside `after()` so the export runs once the response has
  // been sent — an exporter that adds latency to the request it is measuring
  // has corrupted the measurement — and fall back to an inline flush when
  // `after()` throws, which it does outside a request scope (a unit test
  // calling an instrumented function directly). There is no visitor waiting in
  // that case, so inline is correct there rather than a compromise.
  if (!isOtlpConfigured()) return;
  pendingExport.push(span);
  try {
    after(() => flushPending());
  } catch {
    void flushPending();
  }
}

/**
 * Run `fn` inside a span.
 *
 * The span is recorded whether `fn` resolves or throws, and a throw is
 * re-thrown untouched — a tracing layer that swallows an error to keep its own
 * bookkeeping tidy has made the system less debuggable, not more.
 */
export async function withSpan<T>(
  name: string,
  options: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
    /** Join an inbound trace instead of starting a new one. */
    parent?: TraceContext | null;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = options.parent ?? storage.getStore() ?? null;

  const span: Span = {
    traceId: parent?.traceId ?? newTraceId(),
    spanId: newSpanId(),
    parentSpanId: parent?.spanId ?? null,
    name,
    kind: options.kind ?? "internal",
    startedAt: Date.now(),
    endedAt: null,
    attributes: options.attributes ?? {},
    error: null,
  };

  const context: ActiveContext = {
    traceId: span.traceId,
    spanId: span.spanId,
    sampled: parent?.sampled ?? true,
  };

  try {
    return await storage.run(context, () => fn(span));
  } catch (error) {
    span.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    span.endedAt = Date.now();
    retire(span);
  }
}

/** Attach a fact to the span this code is running inside, if there is one. */
export function annotate(span: Span, attributes: Record<string, string | number | boolean>): void {
  Object.assign(span.attributes, attributes);
}

/* ------------------------------------------------------------------ export */

const OTLP_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_ENDPOINT";
const OTLP_HEADERS_ENV = "OTEL_EXPORTER_OTLP_HEADERS";

export function isOtlpConfigured(): boolean {
  return Boolean(process.env[OTLP_ENDPOINT_ENV]);
}

/** OTLP wants attributes as a list of typed key/value pairs, not an object. */
function otlpAttributes(attributes: Record<string, string | number | boolean>) {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value:
      typeof value === "string"
        ? { stringValue: value }
        : typeof value === "boolean"
          ? { boolValue: value }
          : Number.isInteger(value)
            ? { intValue: String(value) }
            : { doubleValue: value },
  }));
}

/**
 * Parse `OTEL_EXPORTER_OTLP_HEADERS`, which the spec defines as W3C Baggage:
 * comma-separated `key=value`. This is how every hosted collector wants its
 * API key, so getting the format right is the difference between exporting and
 * silently 401-ing.
 */
function otlpHeaders(): Record<string, string> {
  const raw = process.env[OTLP_HEADERS_ENV];
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!raw) return headers;

  for (const pair of raw.split(",")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    headers[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return headers;
}

/**
 * Ship spans to a collector.
 *
 * Called from `after()` so it runs once the response has been sent — an
 * exporter that adds its own latency to the request it is measuring has
 * corrupted the measurement.
 *
 * Never throws. A collector being down is not a reason for a request that
 * already succeeded to be reported as failed.
 */
export async function exportSpans(spans: Span[]): Promise<void> {
  const endpoint = process.env[OTLP_ENDPOINT_ENV];
  if (!endpoint || spans.length === 0) return;

  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: otlpAttributes({
            "service.name": "shivamsfolio",
            "service.version": process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
            "deployment.environment":
              process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
            "cloud.region": process.env.VERCEL_REGION ?? "local",
          }),
        },
        scopeSpans: [
          {
            scope: { name: "lib/sre/trace", version: "1" },
            spans: spans
              .filter((span) => span.endedAt !== null)
              .map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
                name: span.name,
                kind: KIND_CODE[span.kind],
                // OTLP timestamps are unsigned nanoseconds since the epoch, as
                // a decimal *string* — a JSON number would lose precision past
                // 2^53, which nanoseconds passed in 1970.
                startTimeUnixNano: `${span.startedAt}000000`,
                endTimeUnixNano: `${span.endedAt}000000`,
                attributes: otlpAttributes(span.attributes),
                // 0 unset, 1 ok, 2 error.
                status: span.error ? { code: 2, message: span.error } : { code: 1 },
              })),
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(`${endpoint.replace(/\/+$/, "")}/v1/traces`, {
      method: "POST",
      headers: otlpHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error(`[otel] collector rejected ${spans.length} spans: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(
      `[otel] export failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
