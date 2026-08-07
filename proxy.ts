import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Next.js 16 renamed middleware.ts -> proxy.ts, and expects a plain function
// export named "proxy" (a destructuring-rename export isn't recognized by
// its static analysis). This builds a second, lightweight NextAuth instance
// from the proxy-safe authConfig (no Prisma adapter, no Credentials
// provider) purely to read the session JWT and run the `authorized`
// callback's redirect logic on every matched request — the full auth.ts
// instance is used everywhere else.
const { auth } = NextAuth(authConfig);

export const proxy = auth;

export const config = {
  // Only /account and /admin actually need gating — scoping the matcher this
  // way (rather than "everything except assets") keeps every other route,
  // including all the marketing pages, eligible for static generation. A
  // proxy that matches a route forces it to render dynamically, so a broad
  // matcher would otherwise silently undo Phase 1's static-generation wins.
  matcher: ["/account/:path*", "/admin/:path*"],
};
