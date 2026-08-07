import { redirect } from "next/navigation";
import { auth } from "../auth";
import type { Session } from "next-auth";

/**
 * Use in server components/route handlers that require any signed-in user.
 * Redirects to /login (preserving the original path as callbackUrl) if not.
 */
export async function requireUser(currentPath?: string): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    const callback = currentPath ? `?callbackUrl=${encodeURIComponent(currentPath)}` : "";
    redirect(`/login${callback}`);
  }
  return session;
}

/**
 * Use in server components/route handlers that require an ADMIN user.
 * Non-admins are redirected home rather than shown a bare 403 — this app has
 * no reason to reveal that an admin-only area even exists to a regular user.
 */
export async function requireAdmin(currentPath?: string): Promise<Session> {
  const session = await requireUser(currentPath);
  if (session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session;
}
