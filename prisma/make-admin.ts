// Promote an existing user to ADMIN.
//
//   pnpm db:make-admin you@example.com
//
// Deliberately does NOT create the account or set a password. Register through
// the site's own /register form first, so the password is chosen by you, hashed
// by the same bcrypt path the login flow verifies against, and never passes
// through a shell history, a script argument, or a chat transcript. This only
// flips the role column on a user that already exists.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error("Usage: pnpm db:make-admin <email>");
    process.exit(1);
  }

  const { prisma } = await import("../lib/prisma");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, hashedPassword: true },
  });

  if (!user) {
    const total = await prisma.user.count();
    console.error(`No user with email "${email}".`);
    console.error(
      total === 0
        ? "There are no users at all yet — register at /register first, then re-run this."
        : `${total} user(s) exist. Check the address you signed up with.`,
    );
    process.exit(1);
  }

  if (user.role === "ADMIN") {
    console.log(`${user.email} is already an ADMIN — nothing to do.`);
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: "ADMIN" },
    select: { email: true, role: true },
  });

  console.log(`${updated.email} is now ${updated.role}.`);
  console.log(
    user.hashedPassword
      ? "Sign out and back in — the role is baked into the session token at sign-in."
      : "This is an OAuth-only account; sign in with the same provider you registered with.",
  );
}

main();
