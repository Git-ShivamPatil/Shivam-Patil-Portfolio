import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { getAdapter } from "../../../../lib/payments";
import { confirmBookingPaid, findPaymentForWebhook } from "../../../../lib/bookings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Razorpay webhook receiver. Same shape as the Stripe handler — raw body for
 * signature verification, idempotency ledger, then the shared confirm path.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const adapter = getAdapter("RAZORPAY");

  const verification = await adapter.verifyWebhook(rawBody, request.headers);
  if (!verification.ok) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    await prisma.webhookEvent.create({
      data: { provider: "RAZORPAY", eventId: verification.eventId, type: verification.type },
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (!verification.status) {
    return NextResponse.json({ received: true, ignored: verification.type });
  }

  try {
    const payment = await findPaymentForWebhook({
      provider: "RAZORPAY",
      providerOrderId: verification.providerOrderId,
      providerPaymentId: verification.providerPaymentId,
    });

    if (!payment) {
      console.warn(`[razorpay] no payment matched event ${verification.eventId}`);
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
    console.error("[razorpay] webhook handling failed:", error);
    await prisma.webhookEvent
      .deleteMany({ where: { provider: "RAZORPAY", eventId: verification.eventId } })
      .catch(() => undefined);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }
}
