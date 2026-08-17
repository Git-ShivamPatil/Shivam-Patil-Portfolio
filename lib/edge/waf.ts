/**
 * P23 — edge request filtering, as a pure function of the request.
 *
 * **Written to run in two edges, and it does.** `proxy.ts` runs on Vercel's
 * Edge runtime and is in the live request path today. `edge/worker.ts` is a
 * deployable Cloudflare Worker that calls the same `evaluate()`. Neither
 * reimplements the other, which is the same arrangement P21's circuit breaker
 * uses — one module, two hosts.
 *
 * That matters because the roadmap asks for Cloudflare Workers and this site is
 * on Vercel. Rather than writing a Worker nobody runs, or pretending Vercel's
 * edge is Cloudflare's, the rules live in a module with no platform imports at
 * all: no `next/server`, no `node:*`, no Cloudflare globals. It takes a `Request`
 * and returns a verdict. Both hosts supply the Request and act on the verdict.
 *
 * **What this is not.** It is not a replacement for a real WAF. A real WAF has a
 * managed ruleset updated as new attack signatures appear, and sees traffic
 * across every site behind it. This is a small, fixed set of rules covering the
 * probes this specific application actually receives — which, being a Next.js
 * app with no PHP, no WordPress and no admin panel at `/wp-admin`, is mostly
 * automated scanners looking for software that is not here.
 */

export type Action = "allow" | "block" | "challenge";

export interface Verdict {
  action: Action;
  /** Rule that decided, for the log. Never sent to the caller. */
  rule: string;
  /** HTTP status to answer with when blocking. */
  status: number;
}

const ALLOW: Verdict = { action: "allow", rule: "none", status: 200 };

/**
 * Paths that exist only in software this app does not run.
 *
 * A request for `/wp-login.php` against a Next.js site is not a mistake a human
 * makes; it is a scanner working through a list. Blocking costs nothing and
 * removes the noise from the analytics and the RED error rate — a 404 counts as
 * traffic, and thousands of them make the real numbers harder to read.
 *
 * **404 rather than 403.** A 403 confirms something is filtering; a 404 is what
 * the scanner would get anyway from a site that simply does not have the file.
 * Telling an attacker which of their requests tripped a rule is free help.
 */
const PROBE_PATHS =
  /^\/(?:wp-admin|wp-login|wp-content|wp-includes|xmlrpc\.php|\.env|\.git\/|\.aws\/|phpmyadmin|administrator\/|typo3\/|vendor\/phpunit|cgi-bin\/|\.svn\/|config\.json|credentials|id_rsa)/i;

/**
 * Traversal and null-byte attempts.
 *
 * **A literal `../` never reaches this function, and the test suite proves it.**
 * Constructing a `Request` parses the URL with the WHATWG algorithm, which
 * resolves dot segments during parsing — so `/api/x/../../etc/passwd` is
 * already `/etc/passwd` by the time anything here reads `pathname`. There is no
 * ordering trick that recovers the original; the information is gone before the
 * first line of application code runs.
 *
 * What survives parsing is the *percent-encoded* form. `%2e%2e%2f` is not a dot
 * segment as far as the parser is concerned, so it passes through `pathname`
 * and `search` intact — and it is exactly what an attacker sends when the thing
 * they are targeting decodes later. Same for `%00`, which truncates a string in
 * any C-backed path handling it eventually reaches.
 *
 * So the literal alternation below is dead against a parsed URL and kept
 * deliberately: this module takes a `Request`, but nothing stops a future
 * caller handing it a path pulled from a raw header, where the parser has not
 * been involved. It costs one alternation.
 */
const TRAVERSAL = /(?:\.\.[/\\]|%2e%2e|%2f\.\.|%00|\x00)/i;

/**
 * User agents that identify themselves as vulnerability scanners.
 *
 * Deliberately only the ones that *announce* themselves. Blocking on a
 * fingerprint rather than a self-declaration is how a filter starts blocking
 * real browsers with unusual configurations, and a portfolio site that
 * intermittently refuses to load for someone with a privacy extension has
 * traded a real visitor for a scanner that would have found nothing.
 */
const HOSTILE_AGENTS =
  /\b(?:sqlmap|nikto|nessus|acunetix|masscan|zgrab|dirbuster|gobuster|wpscan)\b/i;

/**
 * Header size ceiling.
 *
 * Not a security boundary — the platform enforces its own limits well before
 * this — but an oversized cookie jar is the signature of a client stuck in a
 * redirect loop writing cookies, and answering it quickly is kinder than
 * letting it consume a function invocation.
 */
const MAX_HEADER_BYTES = 16 * 1024;

export interface EvaluateOptions {
  /** Paths never filtered, whatever else matches. */
  skip?: RegExp;
}

export function evaluate(request: Request, options: EvaluateOptions = {}): Verdict {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    // An unparseable URL cannot be routed anyway, and reaching the application
    // with one is how a normalisation bug becomes exploitable.
    return { action: "block", rule: "malformed-url", status: 400 };
  }

  const path = url.pathname;
  if (options.skip?.test(path)) return ALLOW;

  if (TRAVERSAL.test(path) || TRAVERSAL.test(url.search)) {
    return { action: "block", rule: "traversal", status: 400 };
  }

  if (PROBE_PATHS.test(path)) {
    return { action: "block", rule: "probe-path", status: 404 };
  }

  const agent = request.headers.get("user-agent") ?? "";
  if (HOSTILE_AGENTS.test(agent)) {
    return { action: "block", rule: "hostile-agent", status: 403 };
  }

  let headerBytes = 0;
  for (const [key, value] of request.headers) headerBytes += key.length + value.length + 4;
  if (headerBytes > MAX_HEADER_BYTES) {
    return { action: "block", rule: "oversized-headers", status: 431 };
  }

  return ALLOW;
}

/* ------------------------------------------------------------- canary */

export interface CanaryOptions {
  /** Fraction of traffic to send to the canary, 0–1. */
  share: number;
  /** Cookie that pins a visitor once assigned. */
  cookieName?: string;
}

export interface CanaryDecision {
  /** True when this request should be served by the canary. */
  canary: boolean;
  /** Set when the decision is new and should be persisted in a cookie. */
  assign: boolean;
  reason: string;
}

/**
 * FNV-1a over a string, as the bucketing hash.
 *
 * A hash rather than `Math.random()` because the assignment has to be *stable*
 * for the same visitor across requests. Random assignment per request would put
 * a single visitor on both versions during one page load — the page HTML from
 * the canary and its API calls from stable — which is worse than not running a
 * canary at all, because the resulting errors belong to a configuration that
 * exists on nobody's machine.
 *
 * FNV-1a specifically: it is eight lines, has no dependencies, distributes well
 * enough for bucketing, and is not being used for anything where its lack of
 * cryptographic strength matters.
 */
export function hashToUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0xffffffff;
}

/**
 * Decide whether a request goes to the canary.
 *
 * An existing cookie always wins, including when the share is later reduced to
 * zero — a visitor already on the canary stays there until the cookie expires.
 * The alternative, re-evaluating every request, means rolling a canary back
 * moves people mid-session, which is exactly when a half-loaded application
 * breaks.
 */
export function canaryFor(
  request: Request,
  options: CanaryOptions,
  identity?: string,
): CanaryDecision {
  const cookieName = options.cookieName ?? "sf_canary";
  const cookies = request.headers.get("cookie") ?? "";
  const pinned = new RegExp(`(?:^|;\\s*)${cookieName}=(on|off)`).exec(cookies);

  if (pinned) {
    return { canary: pinned[1] === "on", assign: false, reason: "pinned by cookie" };
  }

  if (options.share <= 0) return { canary: false, assign: false, reason: "canary disabled" };
  if (options.share >= 1) return { canary: true, assign: true, reason: "canary at 100%" };

  // Identity falls back to a per-request value only when nothing stable is
  // available; the cookie assignment below is what makes it stick from then on.
  const key = identity ?? request.headers.get("x-forwarded-for") ?? request.url;
  const bucket = hashToUnit(key);

  return {
    canary: bucket < options.share,
    assign: true,
    reason: `bucket ${bucket.toFixed(3)} against share ${options.share}`,
  };
}
