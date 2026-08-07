import { NextResponse } from "next/server";
import { auth } from "../auth";
import type { Session } from "next-auth";

/**
 * Use at the top of admin-only route handlers. Returns the session on
 * success, or a ready-to-return 403 NextResponse otherwise:
 *
 *   const guard = await requireAdminApi();
 *   if ("error" in guard) return guard.error;
 */
export async function requireAdminApi(): Promise<{ session: Session } | { error: NextResponse }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Not authorized." }, { status: 403 }) };
  }
  return { session };
}
