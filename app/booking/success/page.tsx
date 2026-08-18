import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "../../../lib/prisma";
import { formatMoney } from "../../../lib/money";
import { ArrowUpRight } from "../../../components/icons";
import "../../services/services.css";

export const metadata: Metadata = {
  title: "Booking received",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Post-checkout landing page.
 *
 * Reached by a browser redirect, which proves nothing about payment — so the
 * copy is careful to reflect the booking's *actual* stored status rather than
 * asserting success. A booking still PENDING_PAYMENT here is the normal case
 * for a few seconds while the webhook lands.
 */
export default async function BookingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  const booking = ref
    ? await prisma.booking
        .findUnique({
          where: { reference: ref },
          include: { offering: true, invoice: true },
        })
        .catch(() => null)
    : null;

  const confirmed = booking?.status === "CONFIRMED";

  return (
    <section className="error-page shell" data-reveal>
      <p className="eyebrow">Booking</p>
      <h1>{confirmed ? "You're booked." : "Payment received."}</h1>

      {booking ? (
        <>
          <p>
            {confirmed
              ? `Your ${booking.offering.name} is confirmed. A receipt and invoice are on their way to ${booking.email}.`
              : `We're waiting on final confirmation from the payment provider — this usually takes a few seconds. Your reference is ${booking.reference}, and the confirmation email will follow automatically.`}
          </p>
          <dl className="booking-summary">
            <div>
              <dt>Reference</dt>
              <dd>{booking.reference}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>{booking.offering.name}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{formatMoney(booking.offering.priceMinor, booking.offering.currency)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{booking.status.replace(/_/g, " ").toLowerCase()}</dd>
            </div>
          </dl>
          <div className="hero-actions">
            {booking.invoice && (
              <Link
                href={`/invoice/${booking.invoice.accessToken}`}
                className="button button-solid"
                data-magnetic
              >
                View invoice <ArrowUpRight />
              </Link>
            )}
            <Link href="/" className="button button-text" data-magnetic>
              Back home <span>→</span>
            </Link>
          </div>
        </>
      ) : (
        <>
          <p>
            We couldn&apos;t find that booking reference. If you were charged, the confirmation
            email will still arrive — reply to it and I&apos;ll sort it out.
          </p>
          <Link href="/services" className="button button-solid" data-magnetic>
            Back to services <ArrowUpRight />
          </Link>
        </>
      )}
    </section>
  );
}
