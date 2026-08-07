import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

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
