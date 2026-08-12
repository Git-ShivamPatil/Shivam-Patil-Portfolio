import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "./auth.config";
import { allowedOriginsFor, checkCsrf } from "./lib/security/csrf";

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
  matcher: ["/account/:path*", "/admin/:path*", "/api/:path*"],
};
