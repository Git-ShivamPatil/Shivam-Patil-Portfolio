import { randomBytes, createHash } from "node:crypto";
import { prisma } from "./prisma";
import { formatMoney } from "./money";
import { sendBookingConfirmation } from "./mail";
import { notifyOwnerOfBooking } from "./push/notify";
import type { PaymentProvider, PaymentStatus } from "./generated/prisma/enums";

/** Human-facing booking reference: BK-2608-4F2A9C. */
export function generateReference(): string {
  const now = new Date();
  const stamp = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `BK-${stamp}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * Deterministic idempotency key for "create checkout for this booking with
 * this provider".
 *
 * Derived rather than random on purpose: a client that retries the request
 * (double-click, flaky network, refresh) produces the same key, so both our
 * Payment row and the provider's order dedupe instead of charging twice.
 */
export function checkoutIdempotencyKey(bookingId: string, provider: PaymentProvider): string {
  return createHash("sha256").update(`${bookingId}:${provider}`).digest("hex").slice(0, 48);
}

export function invoiceAccessToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Allocate the next invoice number for the current year.
 *
 * Invoice numbering is expected to be gapless and sequential, so this counts
 * existing rows for the year rather than using a random suffix. The caller
 * retries on unique-constraint violation, which is what makes two concurrent
 * confirmations settle on distinct numbers.
 */
async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const count = await prisma.invoice.count({ where: { issuedAt: { gte: start } } });
  return `INV-${year}-${String(count + 1).padStart(4, "0")}`;
}

/**
 * Mark a booking paid, issue its invoice, and notify both sides.
 *
 * Safe to call repeatedly for the same booking: webhooks are redelivered, and
 * both Stripe and Razorpay can send more than one event that means "paid".
 * The invoice is created with an upsert-by-bookingId guard so a second call
 * reuses the existing one instead of issuing a duplicate number.
 */
export async function confirmBookingPaid(input: {
  paymentId: string;
  providerPaymentId: string | null;
  status: PaymentStatus;
  rawPayload: unknown;
}): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    include: { booking: { include: { offering: true, invoice: true } } },
  });
  if (!payment) return;

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: input.status,
      providerPaymentId: input.providerPaymentId ?? payment.providerPaymentId,
      rawPayload: input.rawPayload as never,
    },
  });

  if (input.status !== "SUCCEEDED") {
    if (input.status === "REFUNDED") {
      await prisma.booking.update({
        where: { id: payment.bookingId },
        data: { status: "REFUNDED" },
      });
    }
    return;
  }

  const booking = payment.booking;

  // Already confirmed by an earlier delivery of this (or a sibling) event.
  if (booking.status === "CONFIRMED" && booking.invoice) return;

  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "CONFIRMED" },
  });

  let invoice = booking.invoice;
  if (!invoice) {
    for (let attempt = 0; attempt < 5 && !invoice; attempt += 1) {
      try {
        invoice = await prisma.invoice.create({
          data: {
            number: await nextInvoiceNumber(),
            bookingId: booking.id,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            accessToken: invoiceAccessToken(),
            // Snapshotted: an invoice is a historical record and must not
            // change if the offering is later renamed or repriced.
            billTo: {
              name: booking.name,
              email: booking.email,
              company: booking.company ?? null,
            },
            lineItems: [
              {
                description: booking.offering.name,
                durationMin: booking.offering.durationMin,
                quantity: 1,
                unitAmountMinor: payment.amountMinor,
                amountMinor: payment.amountMinor,
              },
            ],
          },
        });
      } catch (error) {
        // Unique violation on `number` (two confirmations racing) or on
        // `bookingId` (a concurrent call already issued it). Re-read: if the
        // invoice now exists we are done, otherwise loop for a fresh number.
        const existing = await prisma.invoice.findUnique({ where: { bookingId: booking.id } });
        if (existing) {
          invoice = existing;
          break;
        }
        if (attempt === 4) {
          console.error("[bookings] invoice creation failed after retries:", error);
          return;
        }
      }
    }
  }
  if (!invoice) return;

  const amount = formatMoney(payment.amountMinor, payment.currency);

  // Both notifications are best-effort — the money is already captured and
  // the invoice already issued, so neither failure should surface as an error.
  sendBookingConfirmation(booking.email, {
    reference: booking.reference,
    offering: booking.offering.name,
    amount,
    invoiceToken: invoice.accessToken,
    scheduledAt: booking.scheduledAt ? booking.scheduledAt.toUTCString() : null,
  }).catch((error) => console.error("[bookings] confirmation email failed:", error));

  notifyOwnerOfBooking({
    reference: booking.reference,
    name: booking.name,
    offering: booking.offering.name,
    amount,
  }).catch((error) => console.error("[bookings] owner push failed:", error));
}

/**
 * Resolve the Payment a webhook is about.
 *
 * Providers are inconsistent about which id they include on which event, so
 * this tries the order id first (always present on the events we act on) and
 * falls back to the payment id for events that only carry that.
 */
export async function findPaymentForWebhook(input: {
  provider: PaymentProvider;
  providerOrderId: string | null;
  providerPaymentId: string | null;
}) {
  if (input.providerOrderId) {
    const byOrder = await prisma.payment.findUnique({
      where: { providerOrderId: input.providerOrderId },
    });
    if (byOrder) return byOrder;
  }
  if (input.providerPaymentId) {
    return prisma.payment.findUnique({ where: { providerPaymentId: input.providerPaymentId } });
  }
  return null;
}
