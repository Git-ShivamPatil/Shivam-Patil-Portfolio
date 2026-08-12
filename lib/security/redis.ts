/**
 * P13 — a minimal Upstash Redis REST client.
 *
 * Hand-rolled for the same reason lib/storage/s3.ts signs its own requests: the
 * official SDK is a dependency, a bundle and a version to keep current, and
 * what is actually needed here is one authenticated POST of a JSON array. The
 * REST protocol is `["INCR", "key"]` in, `{"result": 1}` out.
 *
 * REST rather than a TCP client because the runtime is serverless: a connection
 * pool cannot be shared between invocations, so a TCP client would open and
 * tear down a connection per request anyway — which is what HTTP already is,
 * only with keep-alive handled for us.
 *
 * **Everything here degrades rather than throws.** If Redis is not configured,
 * or is down, or is slow, the caller falls back to the in-memory limiter. A
 * rate limiter that fails closed would take the site down to protect it from
 * traffic it was never receiving.
 */

const URL_ENV = "UPSTASH_REDIS_REST_URL";
const TOKEN_ENV = "UPSTASH_REDIS_REST_TOKEN";

/**
 * Hard ceiling on how long a limiter check may take.
 *
 * The limiter sits in front of the handler, so its latency is added to every
 * request it guards. Beyond this it is cheaper to be wrong than slow, and being
 * wrong here means falling back to the per-instance limiter.
 */
const TIMEOUT_MS = 800;

export function isRedisConfigured(): boolean {
  return Boolean(process.env[URL_ENV] && process.env[TOKEN_ENV]);
}

type Command = (string | number)[];

interface PipelineResult {
  result?: unknown;
  error?: string;
}

/**
 * Run commands in one round trip.
 *
 * Upstash's `/pipeline` endpoint takes an array of commands and returns an
 * array of results in the same order — which is what makes a token bucket
 * possible in a single request instead of three.
 *
 * Returns null on any failure, including a timeout. Never throws.
 */
export async function pipeline(commands: Command[]): Promise<unknown[] | null> {
  const baseUrl = process.env[URL_ENV];
  const token = process.env[TOKEN_ENV];
  if (!baseUrl || !token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
      // Never let a limiter read be served from a cache.
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(`[redis] pipeline failed: HTTP ${response.status}`);
      return null;
    }

    const body = (await response.json()) as PipelineResult[];
    if (!Array.isArray(body)) return null;

    const failed = body.find((entry) => entry.error);
    if (failed) {
      console.error(`[redis] command error: ${failed.error}`);
      return null;
    }

    return body.map((entry) => entry.result);
  } catch (error) {
    // An abort lands here too. Logged, not thrown: the caller has a fallback
    // and the visitor must never see this.
    console.error(
      `[redis] pipeline unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
