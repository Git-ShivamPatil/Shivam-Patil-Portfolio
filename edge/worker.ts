import { canaryFor, evaluate } from "../lib/edge/waf";

/**
 * P23 — a Cloudflare Worker, real and deployable.
 *
 * **This is not currently in the request path, and saying so is the point.**
 * The site is served by Vercel; putting Cloudflare in front of it means moving
 * DNS, which is the same blocked task that has held up the Resend domain
 * verification since P5 (§3). So this Worker is written, typed against the same
 * module `proxy.ts` uses, and deployable with one `wrangler deploy` the day the
 * DNS moves — but it is not pretending to be live.
 *
 * What it demonstrates that the Vercel proxy cannot:
 *
 * - **It sees every request**, including static assets. `proxy.ts` has to list
 *   probe paths one by one, because a catch-all matcher there would drag every
 *   prerendered page through the proxy and cost the site its static generation.
 *   A Worker sits in front of the origin, so filtering costs the origin nothing.
 * - **It blocks before the origin is touched at all.** A request rejected here
 *   never becomes a Vercel function invocation, which is the difference between
 *   filtering as a cost and filtering as a saving.
 * - **Canary routing by origin**, which is genuinely impossible inside the
 *   application: choosing between two deployments requires being in front of
 *   both.
 *
 * The rules themselves are imported, not restated. wrangler bundles TypeScript
 * and resolves the relative import, so `lib/edge/waf.ts` is the single
 * definition — a Worker with its own copy of the ruleset is a Worker whose
 * ruleset silently drifts from the one under test.
 */

export interface Env {
  /** Origin serving the current production deployment. */
  ORIGIN: string;
  /** Origin serving the canary deployment. Optional. */
  CANARY_ORIGIN?: string;
  /** Fraction of traffic to route to the canary, as a string like "0.05". */
  CANARY_SHARE?: string;
}

/** Assets that must never be filtered or bucketed — see the note on skip below. */
const SKIP =
  /^\/(?:_next\/static|_next\/image|favicon|icon|apple-icon|opengraph-image|logo|sw\.js|manifest|sbom\.json|wasm\/|workers\/)/;

const CANARY_COOKIE = "sf_canary";
/** A week. Long enough to keep a visitor on one side for a real session. */
const CANARY_MAX_AGE = 7 * 24 * 60 * 60;

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const verdict = evaluate(request, { skip: SKIP });

    if (verdict.action === "block") {
      // No body. A blocked request should cost the attacker a round trip and
      // us nothing, and an error page is bytes spent explaining ourselves to
      // a scanner.
      return new Response(null, {
        status: verdict.status,
        // The rule goes in a header the origin never sees and Cloudflare's own
        // logs can index. Not in the body, where the caller reads it.
        headers: { "cf-waf-rule": verdict.rule },
      });
    }

    const share = Number(env.CANARY_SHARE ?? "0");
    const canOffer = Boolean(env.CANARY_ORIGIN) && Number.isFinite(share) && share > 0;

    // Static assets are excluded from bucketing as well as from filtering. If a
    // visitor's HTML came from the canary and its JavaScript chunk came from
    // stable, the chunk hashes do not match and the page fails to hydrate —
    // a failure mode that exists on nobody's deployment and is miserable to
    // diagnose.
    const url = new URL(request.url);
    const decision =
      canOffer && !SKIP.test(url.pathname)
        ? canaryFor(request, { share, cookieName: CANARY_COOKIE })
        : { canary: false, assign: false, reason: "canary not configured" };

    const origin = decision.canary ? (env.CANARY_ORIGIN as string) : env.ORIGIN;
    const target = new URL(url.pathname + url.search, origin);

    const response = await fetch(
      new Request(target, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "manual",
      }),
    );

    // The response is copied rather than returned directly, because a Response
    // from fetch() has immutable headers and the cookie has to be attached.
    const out = new Response(response.body, response);
    out.headers.set("x-sf-lane", decision.canary ? "canary" : "stable");

    if (decision.assign) {
      // `Secure` and `SameSite=Lax` so the assignment is not readable over
      // plaintext and does not follow a cross-site POST. Not `HttpOnly`: the
      // page is allowed to show a visitor which lane they are on, and there is
      // nothing sensitive in a one-bit bucket.
      out.headers.append(
        "set-cookie",
        `${CANARY_COOKIE}=${decision.canary ? "on" : "off"}; Path=/; Max-Age=${CANARY_MAX_AGE}; Secure; SameSite=Lax`,
      );
    }

    return out;
  },
};

export default worker;
