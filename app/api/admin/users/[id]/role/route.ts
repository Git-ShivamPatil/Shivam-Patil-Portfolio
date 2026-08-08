import { NextResponse } from "next/server";
import { auth } from "../../../../../../auth";
import { prisma } from "../../../../../../lib/prisma";
import { updateRoleSchema } from "../../../../../../lib/validations/account";
import { isNotFoundError } from "../../../../../../lib/prisma-errors";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const user = await prisma.user.update({
      where: { id },
      data: { role: parsed.data.role },
      select: { id: true, role: true },
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
