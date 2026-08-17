import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "./auth.config";
import { allowedOriginsFor, checkCsrf } from "./lib/security/csrf";
import { evaluate } from "./lib/edge/waf";

// Next.js 16 renamed middleware.ts -> proxy.ts, and expects a plain function
// export named "proxy" (a destructuring-rename export isn't recognized by
// its static analysis). This builds a second, lightweight NextAuth instance
// from the proxy-safe authConfig (no Prisma adapter, no Credentials
// provider) purely to read the session JWT and run the `authorized`
// callback's redirect logic on every matched request — the full auth.ts
// instance is used everywhere else.
const { auth } = NextAuth(authConfig);

/**
 * P13 — the CSRF guard runs *before* and *instead of* the auth instance for
 * API routes.
 *
 * The ordering is the point. `authorized()` in auth.config.ts only knows about
 * /admin and /account and returns `true` for everything else, so running the
 * NextAuth instance over /api would cost a JWT decode on every API request to
 * reach a decision it does not make. Short-circuiting keeps the auth gate
 * exactly as it was — that gate was broken once and is now pinned by
 * tests/p2-auth-gate.test.ts — while giving every state-changing endpoint an
 * origin check it did not have.
 *
 * A rejection is a bare 403 with no detail. The reason goes to the log, not to
 * the caller: telling an attacker which check they tripped is free help.
 */
export function proxy(request: NextRequest, event: unknown) {
  // P23 — the WAF runs first, ahead of both the CSRF check and the auth
  // instance, because a blocked request must not cost a JWT decode or a
  // header parse. `evaluate` is the same module edge/worker.ts calls; see
  // lib/edge/waf.ts for why it has no platform imports.
  //
  // The reason goes to the log, never to the caller. A 404 for a probe path is
  // indistinguishable from a site that genuinely lacks the file, which is the
  // point — telling a scanner which rule it tripped is free help.
  const verdict = evaluate(request);
  if (verdict.action === "block") {
    console.warn(`[waf] ${verdict.rule} blocked ${request.method} ${request.nextUrl.pathname}`);
    return new NextResponse(null, { status: verdict.status });
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    const verdict = checkCsrf(request, allowedOriginsFor(request));
    if (!verdict.ok) {
      console.warn(
        `[csrf] blocked ${request.method} ${request.nextUrl.pathname} — ${verdict.reason}`,
      );
      return NextResponse.json({ error: "Request blocked." }, { status: 403 });
    }
    return NextResponse.next();
  }

  // Everything else keeps the previous behaviour exactly: the NextAuth instance
  // reads the session JWT and applies the `authorized` callback.
  return (auth as unknown as (req: NextRequest, event: unknown) => Response)(request, event);
}

export const config = {
  // /account and /admin need the auth gate; /api needs the CSRF check.
  //
  // Adding /api here does NOT cost static generation: API routes are already
  // rendered per request, so there is no prerendered output to lose. That is
  // why the matcher can grow here and must not grow to cover page routes — a
  // proxy that matches a page forces it to render dynamically, which would
  // silently undo Phase 1's static generation.
  //
  // P23 — the probe paths below are listed one by one for exactly that reason.
  // The WAF would ideally see every request, and a catch-all matcher is how
  // that is normally done; here it would drag every static page through the
  // proxy and cost the whole site its prerendering. Each entry below is a path
  // belonging to software this app does not run — WordPress, phpMyAdmin,
  // TYPO3 — so none corresponds to a real route and none has prerendered
  // output to lose.
  //
  // **A probe path missing from this list still gets a 404**, because no route
  // exists to serve it. `/.env` and `/.git/config` are in PROBE_PATHS and
  // deliberately not here — a dotfile matcher is awkward and would buy
  // nothing, since Next already answers them identically. What the matcher
  // adds is that the block is *logged as a block* rather than disappearing
  // into the general 404 noise, which is the difference between knowing you
  // are being scanned and not.
  //
  // Note also that `/wp-admin/` takes one redirect first: Next normalises the
  // trailing slash before the proxy runs, so the trailing-slash form costs an
  // extra hop and then lands here. Same outcome, one more round trip for the
  // scanner.
  //
  // The traversal, hostile-agent and header-size rules therefore only cover
  // /api, /admin and /account. That is the meaningful surface — a traversal
  // attempt against a static marketing page reaches a CDN, not this code — and
  // it is a real limit of running the filter inside the application rather than
  // in front of it. edge/worker.ts has no such constraint, which is precisely
  // what a Cloudflare Worker buys.
  matcher: [
    "/account/:path*",
    "/admin/:path*",
    "/api/:path*",
    "/wp-admin/:path*",
    "/wp-login.php",
    "/wp-content/:path*",
    "/wp-includes/:path*",
    "/xmlrpc.php",
    "/phpmyadmin/:path*",
    "/administrator/:path*",
    "/typo3/:path*",
    "/cgi-bin/:path*",
    "/vendor/:path*",
  ],
};
