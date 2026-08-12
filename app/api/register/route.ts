import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { hashPassword } from "../../../lib/password";
import { registerSchema } from "../../../lib/validations/auth";
import { consume, clientIp } from "../../../lib/rate-limit";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  // The 409 below deliberately tells the user *which* kind of account already
  // exists — without it, someone who signed up with Google gets "registration
  // failed" forever and no way to work out why. That candour is also an
  // account-enumeration oracle, so the answer is to make bulk probing
  // impractical rather than to make the message useless: a handful of tries
  // per IP is plenty for a real person and far too few to walk a list.
  const limit = await consume(`register:ip:${clientIp(request)}`, 5, 1 / 120);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const { name, email, password } = parsed.data;

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Distinguish an OAuth-only account from a real duplicate signup so
      // the user gets an actionable message instead of a generic failure.
      const message = existing.hashedPassword
        ? "An account with this email already exists."
        : "This email is already linked to a Google or GitHub sign-in. Use that instead.";
      return NextResponse.json({ error: message }, { status: 409 });
    }

    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: { name, email, hashedPassword },
      select: { id: true, name: true, email: true },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    // Never let a raw DB/driver error reach the client — log it server-side
    // and return a generic message instead.
    console.error("POST /api/register failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
