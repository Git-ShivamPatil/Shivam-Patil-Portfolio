import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { hashPassword } from "../../../lib/password";
import { resetPasswordSchema } from "../../../lib/validations/auth";

const INVALID_TOKEN_MESSAGE = "This reset link is invalid or has expired.";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { token, password } = parsed.data;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  try {
    const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return NextResponse.json({ error: INVALID_TOKEN_MESSAGE }, { status: 400 });
    }

    const hashedPassword = await hashPassword(password);

    // Update the password and burn the token in one transaction so a token
    // can never be replayed even under concurrent requests for the same link.
    await prisma.$transaction([
      prisma.user.update({ where: { id: resetToken.userId }, data: { hashedPassword } }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ message: "Password updated. You can now sign in." });
  } catch (error) {
    console.error("POST /api/reset-password failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
