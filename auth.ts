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
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      // Cast explicitly: with both an adapter and { strategy: "jwt" } set,
      // Auth.js's session-callback param type becomes an intersection
      // covering the database-session and JWT-session branches at once,
      // which loses the augmented JWT type's specificity on `token` here
      // even though it's correctly inferred inside the jwt() callback above.
      const jwt = token as { id: string; role: import("./lib/generated/prisma/enums").Role };
      if (session.user) {
        session.user.id = jwt.id;
        session.user.role = jwt.role;
      }
      return session;
    },
  },
});
