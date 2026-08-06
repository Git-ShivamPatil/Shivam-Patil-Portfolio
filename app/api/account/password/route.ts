import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { prisma } from "../../../../lib/prisma";
import { hashPassword, verifyPassword } from "../../../../lib/password";
import { changePasswordSchema } from "../../../../lib/validations/account";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    // OAuth-only accounts have no password to change against.
    if (!user?.hashedPassword) {
      return NextResponse.json(
        { error: "This account doesn't have a password to change." },
        { status: 400 },
      );
    }

    const valid = await verifyPassword(parsed.data.currentPassword, user.hashedPassword);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }

    const hashedPassword = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { hashedPassword } });

    return NextResponse.json({ message: "Password updated." });
  } catch (error) {
    console.error("PATCH /api/account/password failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
