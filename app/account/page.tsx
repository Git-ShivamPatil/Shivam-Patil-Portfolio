import type { Metadata } from "next";
import { requireUser } from "../../lib/auth-guards";
import { prisma } from "../../lib/prisma";
import { ProfileForm } from "../../components/account/profile-form";
import { ChangePasswordForm } from "../../components/account/change-password-form";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const session = await requireUser("/account");

  // Read fresh from the DB rather than trusting session.user.name — the JWT
  // session strategy caches user fields in the token, so a just-saved
  // profile edit wouldn't show up here until the session naturally refreshes.
  const [user, accounts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, hashedPassword: true },
    }),
    prisma.account.findMany({
      where: { userId: session.user.id },
      select: { provider: true },
    }),
  ]);

  return (
    <div className="shell flex max-w-2xl flex-col gap-12 py-16">
      <div>
        <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
          Account
        </p>
        <h1 className="text-app-fg text-3xl font-bold tracking-tight">{user?.email}</h1>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-app-fg text-lg font-bold">Profile</h2>
        <ProfileForm initialName={user?.name ?? ""} />
      </section>

      {user?.hashedPassword ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-app-fg text-lg font-bold">Change password</h2>
          <ChangePasswordForm />
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-app-fg text-lg font-bold">Linked sign-in methods</h2>
        {accounts.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {accounts.map((account) => (
              <li
                key={account.provider}
                className="border-app-line text-app-fg w-fit rounded-full border px-3 py-1.5 text-xs font-semibold capitalize"
              >
                {account.provider}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-app-muted text-sm">Email and password only.</p>
        )}
      </section>
    </div>
  );
}
