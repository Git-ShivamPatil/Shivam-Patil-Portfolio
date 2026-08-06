import type { DefaultSession } from "next-auth";
import type { Role } from "../lib/generated/prisma/enums";

// Augment Auth.js's built-in types so `role`/`id` are known on session.user
// and the JWT everywhere they're used, instead of needing casts at call sites.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
