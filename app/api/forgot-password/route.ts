import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { sendOAuthOnlyNotice, sendPasswordResetEmail } from "../../../lib/mail";
import { forgotPasswordSchema } from "../../../lib/validations/auth";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Always the same response text/shape regardless of what happens internally
// — an endpoint that says "no account with that email" is a classic account
// enumeration leak, so this never differentiates in the HTTP response itself.
// A fresh NextResponse per call, not a shared instance — a Response's body
// stream can only be consumed once, so reusing one object across concurrent
// requests would break under load.
function genericResponse() {
  return NextResponse.json({
    message: "If an account exists for that email, we've sent instructions.",
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    // Still generic — don't reveal *why* it failed either.
    return genericResponse();
  }

  const { email } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (user && user.hashedPassword) {
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        },
      });

      await sendPasswordResetEmail(email, rawToken);
    } else if (user && !user.hashedPassword) {
      // OAuth-only account — safe to differentiate the *email content* here,
      // since only the real inbox owner ever sees it; the HTTP response
      // above never reveals which branch ran.
      await sendOAuthOnlyNotice(email);
    }
    // No user at all: no-op, but still return the generic response.
  } catch (error) {
    console.error("POST /api/forgot-password failed:", error);
    // Even on an internal error, don't change the response shape.
  }

  return genericResponse();
}
