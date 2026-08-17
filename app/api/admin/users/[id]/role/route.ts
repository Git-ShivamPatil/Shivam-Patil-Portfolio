import { NextResponse } from "next/server";
import { auth } from "../../../../../../auth";
import { prisma } from "../../../../../../lib/prisma";
import { updateRoleSchema } from "../../../../../../lib/validations/account";
import { isNotFoundError } from "../../../../../../lib/prisma-errors";
import { record } from "../../../../../../lib/secops/ledger";
import { withRed } from "../../../../../../lib/sre/red";

/* P21 — measured. P22 — audited. This is the single most privilege-relevant
   write in the application: it is how someone gains the ability to make every
   other write. If exactly one action on this site belongs in a tamper-evident
   ledger, it is this one. */
export const PATCH = withRed("/api/admin/users/[id]/role", handlePATCH);

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const { id } = await params;

  // An admin can't demote themself — otherwise a single admin could lock
  // everyone (including themselves) out of the admin area by mistake.
  if (id === session.user.id) {
    return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateRoleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  try {
    // Read the prior role before overwriting it. An audit entry saying "role
    // set to ADMIN" is a fraction as useful as one saying "USER → ADMIN": the
    // question asked afterwards is always what changed, not what it ended up
    // as, and the old value is unrecoverable once the update lands.
    const previous = await prisma.user.findUnique({ where: { id }, select: { role: true } });

    const user = await prisma.user.update({
      where: { id },
      data: { role: parsed.data.role },
      select: { id: true, role: true },
    });

    // After the update, so the ledger only ever records grants that happened.
    // `record` swallows its own failures — an audit write must not turn a
    // successful role change into a 500, because the caller would retry and
    // the second attempt would succeed identically.
    await record({
      actor: session.user.id ?? "unknown-admin",
      action: "user.role.changed",
      target: `user:${id}`,
      metadata: { from: previous?.role ?? null, to: user.role },
    });

    return NextResponse.json({ user });
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    console.error("PATCH /api/admin/users/[id]/role failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
