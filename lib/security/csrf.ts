/**
 * P13 — cross-site request forgery.
 *
 * The threat is specific: this site authenticates with a cookie, and a cookie
 * is attached by the browser to any request to this origin no matter which page
 * triggered it. So `evil.example` can make a visitor's browser POST to
 * `/api/account/password` with their session attached, and without a check the
 * request is indistinguishable from a real one.
 *
 * **`SameSite=Lax` already blocks most of this**, and Auth.js sets it on the
 * session cookie. It is not the whole answer for two reasons: it says nothing
 * about a same-site subdomain, and "most" is not a property worth relying on
 * for password changes and payment writes.
 *
 * The check here is an origin check, not a token. A double-submit token would
 * mean minting, storing and rotating state for every form on the site; the
 * `Origin` header carries the same information, is set by the browser on every
 * unsafe request, and cannot be forged by page script. `Sec-Fetch-Site` is
 * checked first where present because it answers the question directly, and it
 * is set by every browser released since 2020.
 *
 * What this deliberately does **not** guard:
 *
 * - **GET/HEAD/OPTIONS.** They must not change state, and the ones here do not.
 * - **Webhooks.** Razorpay and Stripe are servers, not browsers: they send no
 *   Origin, and they authenticate with a signature over the raw body, which is
 *   a strictly stronger check than any header. Guarding them on Origin would
 *   reject every real callback.
 * - **The Auth.js routes.** They run their own CSRF token flow, and layering a
 *   second check on top would break the OAuth callback, which legitimately
 *   arrives as a cross-site navigation from the provider.
 */

/** Methods that may change state and therefore need the check. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths exempt from the origin check, each for a reason stated above.
 *
 * Matched as a prefix on the pathname. Kept short on purpose: every entry is a
 * hole, and the two that exist are both authenticated by something stronger.
 */
export const CSRF_EXEMPT_PREFIXES = ["/api/auth/", "/api/webhooks/"] as const;

export function isCsrfExempt(pathname: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export interface CsrfVerdict {
  ok: boolean;
  /** Why it failed, for the log line — never returned to the caller. */
  reason?: string;
}

/**
 * Decide whether a request may change state.
 *
 * `allowedOrigins` should be every origin this app is legitimately served
 * from — the configured public site URL and the host actually serving the
 * request, which is what keeps preview deploys and local development working
 * while production still refuses anything else.
 */
export function checkCsrf(
  request: { method: string; headers: Headers; url: string },
  allowedOrigins: string[],
): CsrfVerdict {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return { ok: true };

  const pathname = safePathname(request.url);
  if (pathname && isCsrfExempt(pathname)) return { ok: true };

  // The direct answer, where the browser gives one. "same-origin" and "none"
  // (a user typing the URL, or a bookmark) are ours; "same-site" and
  // "cross-site" are not.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) {
    if (fetchSite === "same-origin" || fetchSite === "none") return { ok: true };
    return { ok: false, reason: `sec-fetch-site: ${fetchSite}` };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    return allowedOrigins.includes(origin)
      ? { ok: true }
      : { ok: false, reason: `origin: ${origin}` };
  }

  // Neither header. A browser always sends at least one on an unsafe
  // cross-origin request, so what is left is a non-browser client: curl, a
  // server-to-server call, a health check. Those cannot be CSRF'd — there is no
  // ambient cookie to abuse — so refusing them would break legitimate tooling
  // without closing anything. Falling back to Referer instead would be worse:
  // it is stripped by privacy settings often enough to reject real visitors.
  return { ok: true };
}

function safePathname(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * Every origin this deployment answers to.
 *
 * Both the configured public origin and the host actually serving the request,
 * for the same reason /api/qr accepts both: checking only the former breaks
 * local development and preview deploys, where the browser's Origin is the
 * preview host while NEXT_PUBLIC_SITE_URL still points at production.
 */
export function allowedOriginsFor(request: { url: string; headers: Headers }): string[] {
  const origins = new Set<string>();

  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      origins.add(new URL(configured).origin);
    } catch {
      // A malformed env var must not take every write on the site down.
    }
  }

  try {
    origins.add(new URL(request.url).origin);
  } catch {
    // Unparseable request URL; the Sec-Fetch-Site path above still applies.
  }

  // Behind a proxy the request URL can carry the internal host rather than the
  // one the browser used, which is the host the Origin header will name.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) origins.add(`${forwardedProto}://${forwardedHost}`);

  return [...origins];
}
