import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getAdapter } from "../../../../lib/payments";
import { confirmBookingPaid, findPaymentForWebhook } from "../../../../lib/bookings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook receiver.
 *
 * Reads the *raw* body — signature verification is over the exact bytes
 * Stripe signed, so parsing to JSON first and re-serialising would break it.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const adapter = getAdapter("STRIPE");

  const verification = await adapter.verifyWebhook(rawBody, request.headers);
  if (!verification.ok) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Idempotency ledger. Stripe explicitly documents that events may be
  // delivered more than once, and redelivers on any non-2xx — the unique
  // (provider, eventId) is what makes handling exactly-once.
  try {
    await prisma.webhookEvent.create({
      data: { provider: "STRIPE", eventId: verification.eventId, type: verification.type },
    });
  } catch {
    // Already processed. 200 so Stripe stops retrying.
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Events we don't act on are acknowledged, not errored — a 4xx would make
  // Stripe retry an event that will never be interesting.
  if (!verification.status) {
    return NextResponse.json({ received: true, ignored: verification.type });
  }

  try {
    const payment = await findPaymentForWebhook({
      provider: "STRIPE",
      providerOrderId: verification.providerOrderId,
      providerPaymentId: verification.providerPaymentId,
    });

    if (!payment) {
      console.warn(`[stripe] no payment matched event ${verification.eventId}`);
      return NextResponse.json({ received: true, matched: false });
    }

    await confirmBookingPaid({
      paymentId: payment.id,
      providerPaymentId: verification.providerPaymentId,
      status: verification.status,
      rawPayload: verification.raw,
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe] webhook handling failed:", error);
    // Roll the ledger entry back so Stripe's retry can actually re-run this.
    await prisma.webhookEvent
      .deleteMany({ where: { provider: "STRIPE", eventId: verification.eventId } })
      .catch(() => undefined);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }
}
