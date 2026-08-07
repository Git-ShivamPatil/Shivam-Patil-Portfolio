"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";

export function AuthNav() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);

  // Keep the header's layout stable while the client-side session request
  // resolves, instead of flashing "Sign in" then swapping to the avatar.
  if (status === "loading") {
    return <div aria-hidden="true" className="bg-app-line/60 h-9 w-9 animate-pulse rounded-full" />;
  }

  if (!session?.user) {
    return (
      <Link href="/login" className="text-app-fg text-sm font-bold">
        Sign in
      </Link>
    );
  }

  const { user } = session;
  const initials = (user.name ?? user.email ?? "?").charAt(0).toUpperCase();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="border-app-line bg-app-ink text-app-lime flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border"
      >
        {user.image ? (
          <Image
            src={user.image}
            alt=""
            width={36}
            height={36}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-xs font-semibold">{initials}</span>
        )}
      </button>

      {open ? (
        <>
          {/* click-away layer */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="border-app-line bg-app-bg absolute right-0 z-40 mt-2 w-48 rounded-xl border py-2 text-sm shadow-lg"
          >
            <p className="text-app-muted truncate px-4 py-1 text-xs">{user.email}</p>
            <Link
              href="/account"
              role="menuitem"
              className="text-app-fg hover:bg-app-line/30 block px-4 py-2"
              onClick={() => setOpen(false)}
            >
              Account
            </Link>
            {user.role === "ADMIN" ? (
              <Link
                href="/admin"
                role="menuitem"
                className="text-app-fg hover:bg-app-line/30 block px-4 py-2"
                onClick={() => setOpen(false)}
              >
                Admin
              </Link>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => signOut({ callbackUrl: "/" })}
              className="text-app-fg hover:bg-app-line/30 block w-full px-4 py-2 text-left"
            >
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
