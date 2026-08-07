import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { sendNewsletterWelcome } from "../../../../lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shivamsfolio.com";

/**
 * Confirmation link target (GET, because it is followed from an email).
 *
 * Always redirects to a human-readable status page rather than returning
 * JSON — the person clicking this is in a mail client, not an API console.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(`${siteUrl}/newsletter/confirmed?status=invalid`);
  }

  try {
    const subscriber = await prisma.newsletterSubscriber.findUnique({
      where: { confirmToken: token },
    });

    if (!subscriber) {
      return NextResponse.redirect(`${siteUrl}/newsletter/confirmed?status=invalid`);
    }

    if (subscriber.status === "CONFIRMED") {
      // Mail clients prefetch links; a second visit must be a no-op success,
      // not an error the subscriber has to interpret.
      return NextResponse.redirect(`${siteUrl}/newsletter/confirmed?status=already`);
    }

    await prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), unsubscribedAt: null },
    });

    // Best-effort: the subscription is already committed above.
    sendNewsletterWelcome(subscriber.email, subscriber.unsubToken).catch((error) =>
      console.error("[newsletter] welcome email failed:", error),
    );

    return NextResponse.redirect(`${siteUrl}/newsletter/confirmed?status=ok`);
  } catch (error) {
    console.error("GET /api/newsletter/confirm failed:", error);
    return NextResponse.redirect(`${siteUrl}/newsletter/confirmed?status=error`);
  }
}
