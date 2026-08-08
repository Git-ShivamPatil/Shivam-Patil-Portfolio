import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import type { Role } from "./lib/generated/prisma/enums";

// Kept deliberately light — no Prisma adapter, no Credentials provider, no
// bcrypt — since proxy.ts imports this on every matched request and those
// dependencies aren't needed just to decide whether a route is allowed.
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [Google, GitHub],
  callbacks: {
    // Lives here rather than in auth.ts because proxy.ts builds a *second*,
    // adapter-less NextAuth instance from this config alone. Auth.js's default
    // session callback rebuilds session.user from a fixed whitelist
    // (name/email/image) and drops every other claim, so without this the
    // proxy instance would see `role === undefined` and the /admin gate below
    // would deny every request — including a genuine admin's. Both instances
    // read the same JWT, so projecting the claims here fixes both at once.
    session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const role = auth?.user?.role;

      if (nextUrl.pathname.startsWith("/admin")) {
        return isLoggedIn && role === "ADMIN";
      }
      if (nextUrl.pathname.startsWith("/account")) {
        return isLoggedIn;
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
