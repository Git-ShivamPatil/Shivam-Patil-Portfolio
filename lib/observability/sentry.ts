// From ./secrets, not ./vault: this module is reachable from instrumentation.ts,
// which is bundled for the Edge runtime too, and vault.ts imports node:fs.
import { scrub } from "../security/secrets";

/**
 * P14 — error reporting to Sentry, over Sentry's own HTTP API.
 *
 * **No SDK, on purpose, and for the same reason lib/storage/s3.ts signs its own
 * SigV4 requests rather than pulling in the AWS SDK.** `@sentry/nextjs` is a
 * large dependency that patches the build (a webpack/turbopack plugin, source
 * map upload, an instrumentation wrapper on every route) to provide automatic
 * instrumentation. What this project actually needs is: when a request throws,
 * send the error somewhere durable. That is one HTTP POST of a documented
 * format, and doing it by hand means the error path has no build-time
 * dependency at all — which matters on a project whose build has already been
 * broken once by a third party (see app/layout.tsx on the fonts).
 *
 * The cost of this choice, stated plainly: no automatic breadcrumbs, no
 * performance tracing, no release health, and source maps are not uploaded so
 * stack frames point at built output. Those are real features and this does not
 * pretend to replace them. It covers the one that matters — an unhandled error
 * reaching a visitor should not be discoverable only by scrolling a platform
 * log.
 *
 * **Everything here degrades.** No DSN configured means every call is a no-op,
 * which is the same contract every other integration in this project honours.
 * A failed report is logged and swallowed: the error being reported is the
 * problem, and a reporting failure must never become a second one.
 */

interface ParsedDsn {
  endpoint: string;
  publicKey: string;
}

/**
 * A DSN is `https://<publicKey>@<host>/<projectId>`.
 *
 * Parsed once and cached, including the negative result — a malformed DSN
 * should be logged once at boot, not on every error the app ever throws.
 */
let cachedDsn: ParsedDsn | null | undefined;

function parseDsn(): ParsedDsn | null {
  if (cachedDsn !== undefined) return cachedDsn;

  const raw = process.env.SENTRY_DSN;
  if (!raw) {
    cachedDsn = null;
    return null;
  }

  try {
    const url = new URL(raw);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) throw new Error("missing public key or project id");
    cachedDsn = {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      publicKey: url.username,
    };
  } catch (error) {
    console.error(
      `[sentry] SENTRY_DSN is malformed, error reporting is off: ${error instanceof Error ? error.message : String(error)}`,
    );
    cachedDsn = null;
  }
  return cachedDsn;
}

export function isSentryConfigured(): boolean {
  return parseDsn() !== null;
}

/** Reset the memoised DSN. Tests only. */
export function resetSentryCache(): void {
  cachedDsn = undefined;
}

export interface ErrorContext {
  /** Where it came from: "route", "client", "cron", ... */
  source?: string;
  /** The request path, when there is one. Never a query string. */
  path?: string;
  method?: string;
  /** Anything else worth indexing on. Values are stringified and scrubbed. */
  tags?: Record<string, string | undefined>;
}

interface SentryFrame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
}

/**
 * Turn a V8 stack string into Sentry's frame list.
 *
 * Sentry renders frames **innermost last**, which is the reverse of how V8
 * prints them — getting this backwards produces a stack trace that reads
 * upside down and makes every error look like it originated in the framework.
 */
function parseStack(stack: string | undefined): SentryFrame[] {
  if (!stack) return [];
  const frames: SentryFrame[] = [];

  for (const line of stack.split("\n").slice(1)) {
    // "    at fnName (/path/file.js:12:34)" or "    at /path/file.js:12:34"
    const withName = /^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/.exec(line);
    const bare = /^\s*at\s+(.+?):(\d+):(\d+)$/.exec(line);

    if (withName) {
      frames.push({
        function: withName[1],
        filename: withName[2],
        lineno: Number(withName[3]),
        colno: Number(withName[4]),
      });
    } else if (bare) {
      frames.push({
        function: "<anonymous>",
        filename: bare[1],
        lineno: Number(bare[2]),
        colno: Number(bare[3]),
      });
    }
  }

  // Cap the depth. A runaway recursion produces a stack thousands of frames
  // long, and a report large enough to be rejected is a report that never
  // arrives.
  return frames.slice(0, 50).reverse();
}

/** Sentry wants a 32-character hex id with no dashes. */
function eventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Report one error. Never throws, never rejects.
 *
 * Deliberately fire-and-forget at the call site (`void reportError(...)`): the
 * response the visitor is waiting on must not be held up by a POST to a third
 * party, and if that POST is slow the request that failed is already failing.
 */
export async function reportError(error: unknown, context: ErrorContext = {}): Promise<void> {
  const dsn = parseDsn();
  if (!dsn) return;

  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const now = new Date().toISOString();

    const tags: Record<string, string> = {
      source: context.source ?? "unknown",
      runtime: typeof window === "undefined" ? "server" : "browser",
    };
    if (context.method) tags.method = context.method;
    for (const [key, value] of Object.entries(context.tags ?? {})) {
      if (value) tags[key] = String(value).slice(0, 200);
    }

    const event = {
      event_id: eventId(),
      timestamp: now,
      platform: "node",
      level: "error",
      logger: "shivamsfolio",
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      // Vercel injects the commit SHA, which is what makes a report traceable
      // to a deploy without a release-tracking step.
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
      server_name: process.env.VERCEL_REGION,
      tags,
      transaction: context.path,
      exception: {
        values: [
          {
            type: err.name,
            // Scrubbed: a connection string interpolated into an error message
            // is exactly how a secret ends up in a third-party dashboard.
            value: scrub(err.message).slice(0, 2000),
            stacktrace: { frames: parseStack(err.stack) },
          },
        ],
      },
    };

    const envelope = [
      JSON.stringify({ event_id: event.event_id, sent_at: now }),
      JSON.stringify({ type: "event", content_type: "application/json" }),
      JSON.stringify(event),
    ].join("\n");

    // Bounded, because this runs inside a request that has already gone wrong.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(dsn.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": [
            "Sentry sentry_version=7",
            "sentry_client=shivamsfolio/1.0",
            `sentry_key=${dsn.publicKey}`,
          ].join(", "),
        },
        body: envelope,
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error(`[sentry] rejected the report: HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (reportingError) {
    // The one place a swallowed error is correct: we are already handling an
    // error, and a failure to report it must not replace it.
    console.error(
      `[sentry] could not report: ${reportingError instanceof Error ? reportingError.message : String(reportingError)}`,
    );
  }
}
