import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { sendOAuthOnlyNotice, sendPasswordResetEmail } from "../../../lib/mail";
import { forgotPasswordSchema } from "../../../lib/validations/auth";
import { takeToken, clientIp } from "../../../lib/rate-limit";

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

  // Two buckets, because they stop different abuses. The per-email one stops
  // someone using this endpoint to mail-bomb a specific inbox; the per-IP one
  // stops a script walking an address list. Both are checked before any DB
  // work, and a rejection still returns the same generic body — a distinct
  // 429 here would itself be an enumeration oracle.
  if (
    !takeToken(`forgot:email:${email}`, 3, 1 / 900).ok ||
    !takeToken(`forgot:ip:${clientIp(request)}`, 10, 1 / 60).ok
  ) {
    return genericResponse();
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (user && user.hashedPassword) {
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");

      // Burn every outstanding token for this user first. Otherwise each
      // request leaves another live one behind, so a token captured from an
      // old email (a forwarded message, a shared screenshot) keeps working
      // for its full hour even after the user requests a new link — and
      // requesting a new link is exactly what someone does when they suspect
      // the old one leaked.
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

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
