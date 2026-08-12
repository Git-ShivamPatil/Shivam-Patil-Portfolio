import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { bookingSchema } from "../../../lib/validations/booking";
import { getAdapter, defaultProviderFor } from "../../../lib/payments";
import { generateReference, checkoutIdempotencyKey } from "../../../lib/bookings";
import { consume, clientIp } from "../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shivamsfolio.com";

/**
 * Create a booking and open a checkout for it.
 *
 * The booking row is written first and lands as PENDING_PAYMENT: a lead that
 * abandons at the payment step is still a lead worth having, and the webhook
 * needs a row to attach to before the provider can call back. Nothing is
 * treated as confirmed here — only a verified webhook promotes a booking to
 * CONFIRMED, because a client-side "success" redirect is trivially forged.
 */
export async function POST(request: Request) {
  const limit = await consume(`booking:${clientIp(request)}`, 5, 0.1);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many booking attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = bookingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  if (parsed.data.website) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  const input = parsed.data;

  const offering = await prisma.serviceOffering.findUnique({
    where: { slug: input.offeringSlug },
  });
  if (!offering || !offering.active) {
    return NextResponse.json({ error: "That service isn't available." }, { status: 404 });
  }

  const provider = input.provider ?? defaultProviderFor(offering.currency);
  if (!provider) {
    return NextResponse.json(
      { error: "Payments aren't configured on this site yet." },
      { status: 503 },
    );
  }

  const adapter = getAdapter(provider);
  if (!adapter.isConfigured()) {
    return NextResponse.json({ error: `${provider} isn't configured.` }, { status: 503 });
  }

  try {
    const booking = await prisma.booking.create({
      data: {
        reference: generateReference(),
        offeringId: offering.id,
        name: input.name,
        email: input.email.toLowerCase(),
        company: input.company || null,
        notes: input.notes || null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        calBookingUid: input.calBookingUid || null,
        referralRef: input.ref || null,
      },
    });

    const idempotencyKey = checkoutIdempotencyKey(booking.id, provider);

    const session = await adapter.createCheckout({
      bookingId: booking.id,
      reference: booking.reference,
      amountMinor: offering.priceMinor,
      currency: offering.currency,
      description: offering.name,
      customerEmail: booking.email,
      customerName: booking.name,
      successUrl: `${siteUrl}/booking/success?ref=${booking.reference}`,
      cancelUrl: `${siteUrl}/services?cancelled=${booking.reference}`,
      idempotencyKey,
    });

    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider,
        providerOrderId: session.providerOrderId,
        amountMinor: offering.priceMinor,
        currency: offering.currency,
        status: "PENDING",
        idempotencyKey,
      },
    });

    return NextResponse.json(
      {
        reference: booking.reference,
        provider,
        redirectUrl: session.redirectUrl,
        clientConfig: session.clientConfig ?? null,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/bookings failed:", error);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 },
    );
  }
}
