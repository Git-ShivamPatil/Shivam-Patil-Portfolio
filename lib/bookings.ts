import { randomBytes, createHash } from "node:crypto";
import { prisma } from "./prisma";
import { Prisma } from "./generated/prisma/client";
import { isUniqueConstraintOn } from "./prisma-errors";
import { formatMoney } from "./money";
import { sendBookingConfirmation } from "./mail";
import { notifyOwnerOfBooking } from "./push/notify";
import type { PaymentProvider, PaymentStatus } from "./generated/prisma/enums";

/**
 * Human-facing booking reference: BK-2608-4F2A9C1B2D.
 *
 * The random suffix is 5 bytes, not 3. At 3 bytes it was 24 bits — 16.7M
 * values — and `Booking.reference` is `@unique`, so by the birthday bound a
 * mere 2,000 references carried an **11% chance** of a collision. That is not
 * a theoretical concern: app/api/bookings/route.ts passes this straight into
 * `booking.create()` with no retry, so a collision surfaces as a 500 for a
 * customer at the exact moment they are trying to pay. It also made
 * tests/p7-booking-invariants.test.ts fail roughly one run in nine.
 *
 * 5 bytes is 40 bits, which puts the same 2,000-reference collision
 * probability at about 1 in 550,000. The result is 18 characters, still well
 * inside Razorpay's 40-character receipt limit.
 */
export function generateReference(): string {
  const now = new Date();
  const stamp = `${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `BK-${stamp}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

/**
 * Deterministic idempotency key for "create checkout for this booking with
 * this provider".
 *
 * Derived rather than random on purpose: a client that retries the request
 * (double-click, flaky network, refresh) produces the same key, so both our
 * Payment row and the provider's order dedupe instead of charging twice.
 */
/**
 * How many fresh references to try before giving up.
 *
 * Three is not a tuning knob so much as a statement about what a second failure
 * would mean. At 40 bits the chance of one collision is ~1 in 550,000 over a
 * realistic burst; two independent collisions in a row is not a thing that
 * happens to a working generator, so a third failure is evidence of a *bug* —
 * a constant suffix, a clock stuck at one month, a mocked randomBytes — and
 * looping harder would only delay finding it.
 */
const REFERENCE_ATTEMPTS = 3;

/**
 * Create a booking, regenerating the reference if it collides.
 *
 * **This closes the oldest open defect in the repo.** `Booking.reference` is
 * `@unique` and the route created the row with a single unretried `create()`,
 * so a collision surfaced as a 500 to a customer at the exact moment they were
 * trying to pay. Widening the suffix from 24 to 40 bits (see `generateReference`)
 * made that rare; it did not make it impossible, and "rare" is the wrong
 * property for the one code path that is holding someone's money.
 *
 * **Why the reference is still random rather than sequential.** A monotonic
 * counter would remove collisions by construction and is the obvious fix, but
 * it is the wrong one here: `app/booking/success/page.tsx` looks a booking up
 * *by reference* and renders the customer's name, email, service and amount to
 * whoever holds it. The reference is therefore a bearer token in practice, and
 * `BK-2608-0000000042` would let anyone walk every booking on the site by
 * incrementing a number. Retrying random values keeps the collision handling
 * where it belongs — in the writer — instead of trading a 500-once-in-550,000
 * for an enumeration hole that is open permanently.
 *
 * The retry is scoped to `reference` specifically via `isUniqueConstraintOn`.
 * A P2002 on any other column is re-thrown untouched, because regenerating a
 * reference cannot fix it and swallowing it would hide a real constraint bug.
 */
export async function createBookingWithReference(
  data: Omit<Prisma.BookingUncheckedCreateInput, "reference">,
  client: Pick<Prisma.TransactionClient, "booking"> = prisma,
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
    try {
      return await client.booking.create({
        data: { ...data, reference: generateReference() },
      });
    } catch (error) {
      if (!isUniqueConstraintOn(error, "reference")) throw error;
      lastError = error;
      // Logged at every attempt, not only the last. A collision is rare enough
      // that seeing even one in production is worth knowing about — it is the
      // early warning that the generator has regressed.
      console.warn(
        `[bookings] reference collision on attempt ${attempt + 1}/${REFERENCE_ATTEMPTS}`,
      );
    }
  }

  throw lastError;
}

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
