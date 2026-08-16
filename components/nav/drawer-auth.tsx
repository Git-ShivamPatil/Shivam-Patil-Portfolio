"use client";

import Link from "next/link";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";

/**
 * The session block pinned to the bottom of the drawer.
 *
 * This is the header's old avatar dropdown, unrolled. Up there it had to be a
 * button that opened a menu because a top bar has no room for three links; the
 * drawer foot has the room, so they are just links — which also removes a
 * second popover trapping focus inside a panel that is already trapping it.
 *
 * `onNavigate` closes the drawer. Next's client router does not unmount the
 * drawer on navigation, so without it the panel stays open over the page the
 * visitor just asked for.
 */
export function DrawerAuth({ onNavigate }: { onNavigate: () => void }) {
  const { data: session, status } = useSession();

  // Hold the foot's height while the client-side session request resolves,
  // instead of flashing "Sign in" and then swapping it for the account block —
  // the same reason the header version rendered a pulsing circle.
  if (status === "loading") {
    return <div aria-hidden="true" className="drawer-auth-placeholder" />;
  }

  if (!session?.user) {
    return (
      <Link href="/login" className="drawer-auth-signin" onClick={onNavigate}>
        Sign in
      </Link>
    );
  }

  const { user } = session;
  const initials = (user.name ?? user.email ?? "?").charAt(0).toUpperCase();

  return (
    <div className="drawer-auth">
      <div className="drawer-auth-identity">
        <span className="drawer-auth-avatar" aria-hidden="true">
          {user.image ? (
            <Image src={user.image} alt="" width={38} height={38} />
          ) : (
            <span>{initials}</span>
          )}
        </span>
        <span className="drawer-auth-who">
          <strong>{user.name ?? "Signed in"}</strong>
          <span className="drawer-auth-email">{user.email}</span>
        </span>
      </div>

      <div className="drawer-auth-actions">
        <Link href="/account" className="drawer-auth-action" onClick={onNavigate}>
          Account
        </Link>
        {user.role === "ADMIN" ? (
          <Link href="/admin" className="drawer-auth-action" onClick={onNavigate}>
            Admin
          </Link>
        ) : null}
        <button
          type="button"
          className="drawer-auth-action"
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
