import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma";
import { sendNewsletterConfirmation } from "../../../../lib/mail";
import { takeToken, clientIp } from "../../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const subscribeSchema = z.object({
  email: z.email("Enter a valid email address."),
  ref: z.string().max(120).optional(),
  // Honeypot, mirroring the contact form's approach.
  website: z.string().optional(),
});

function token(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Double opt-in subscribe.
 *
 * The response is deliberately identical whether the address is new, already
 * pending, or already confirmed. Returning "you're already subscribed" would
 * turn this endpoint into an oracle for whether a given address is on the
 * list, which is a subscriber-privacy leak for a form that anyone can POST to.
 */
export async function POST(request: Request) {
  const limit = takeToken(`newsletter:${clientIp(request)}`, 5, 0.2);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  if (parsed.data.website) {
    // Bot tripped the honeypot — report success and do nothing.
    return NextResponse.json({ message: "Check your inbox to confirm." });
  }

  const email = parsed.data.email.toLowerCase().trim();

  try {
    const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } });

    if (existing?.status === "CONFIRMED") {
      return NextResponse.json({ message: "Check your inbox to confirm." });
    }

    // Re-subscribing after an unsubscribe, or re-requesting a lost confirm
    // link, both mint a fresh token so an old email can't be replayed.
    const confirmToken = token();
    const subscriber = existing
      ? await prisma.newsletterSubscriber.update({
          where: { email },
          data: {
            status: "PENDING",
            confirmToken,
            unsubscribedAt: null,
            referralRef: parsed.data.ref || existing.referralRef,
          },
        })
      : await prisma.newsletterSubscriber.create({
          data: {
            email,
            confirmToken,
            unsubToken: token(),
            referralRef: parsed.data.ref || null,
          },
        });

    await sendNewsletterConfirmation(subscriber.email, subscriber.confirmToken);

    return NextResponse.json({ message: "Check your inbox to confirm." });
  } catch (error) {
    console.error("POST /api/newsletter/subscribe failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
