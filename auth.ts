import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./lib/prisma";
import { verifyPassword } from "./lib/password";
import { loginSchema } from "./lib/validations/auth";
import { authConfig } from "./auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  // Credentials provider requires the JWT session strategy — a database
  // session can't represent a credentials-authenticated session (there's no
  // OAuth/email-verification flow behind it). The Prisma adapter is still
  // used for User/Account persistence and OAuth account linking.
  session: { strategy: "jwt" },
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        try {
          const user = await prisma.user.findUnique({ where: { email } });
          // No hashedPassword means this is an OAuth-only account — don't
          // let a credentials attempt succeed against it.
          if (!user?.hashedPassword) return null;

          const valid = await verifyPassword(password, user.hashedPassword);
          if (!valid) return null;

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            role: user.role,
          };
        } catch (error) {
          // A DB hiccup here should read to the user as "sign-in failed",
          // not crash — but it's still logged server-side for visibility.
          console.error("Credentials authorize() failed:", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    // `session` is inherited from authConfig — it must be shared with the
    // adapter-less instance proxy.ts builds, so it is defined there.
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
      }
      // Role is otherwise frozen into the JWT at sign-in for its full 30-day
      // life, so revoking an admin via /api/admin/users/[id]/role would not
      // take effect until they signed out. Re-reading on session refresh
      // bounds that staleness without a DB hit on every request.
      else if (trigger === "update" && token.id) {
        try {
          const fresh = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { role: true },
          });
          if (fresh) token.role = fresh.role;
        } catch (error) {
          // Keep the existing claim rather than locking the user out.
          console.error("jwt() role refresh failed:", error);
        }
      }
      return token;
    },
  },
});
