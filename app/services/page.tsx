import type { Metadata } from "next";
import { prisma } from "../../lib/prisma";
import { formatMoney } from "../../lib/money";
import { availableProviders } from "../../lib/payments";
import { BookingForm, type OfferingOption } from "../../components/booking/booking-form";
import { CalEmbed } from "../../components/booking/cal-embed";

export const metadata: Metadata = {
  title: "Work with me — Shivam Patil",
  description:
    "Book a paid consultation, architecture review, or system deep-dive with Shivam Patil.",
  alternates: { canonical: "/services" },
};

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  // A database outage shouldn't 500 the page — it should render the "nothing
  // bookable right now" state, which is what a visitor can act on anyway.
  const offerings = await prisma.serviceOffering
    .findMany({ where: { active: true }, orderBy: { order: "asc" } })
    .catch((error) => {
      console.error("[services] could not load offerings:", error);
      return [];
    });

  const options: OfferingOption[] = offerings.map((offering) => ({
    slug: offering.slug,
    name: offering.name,
    durationMin: offering.durationMin,
    currency: offering.currency,
    priceLabel: formatMoney(offering.priceMinor, offering.currency),
  }));

  return (
    <>
      <section className="page-hero shell" data-reveal>
        <p className="eyebrow">Work with me</p>
        <h1 data-split>
          Bring me the
          <br />
          <em>hard part.</em>
        </h1>
        <p>
          Paid, focused sessions on the things that are expensive to get wrong — throughput
          ceilings, failure modes, retrieval quality, and the architecture decisions underneath
          them. Book a slot, pay securely, and get a written summary afterwards.
        </p>
      </section>

      <section className="service-offer-grid shell">
        {offerings.map((offering, index) => (
          <article
            key={offering.id}
            className="service-offer-card"
            data-reveal
            data-reveal-delay={String(Math.min(index + 1, 4))}
            data-tilt
          >
            <p className="eyebrow">{String(index + 1).padStart(2, "0")}</p>
            <h2>{offering.name}</h2>
            <p className="service-offer-desc">{offering.description}</p>
            <div className="service-offer-foot">
              <strong>{formatMoney(offering.priceMinor, offering.currency)}</strong>
              <span>{offering.durationMin} minutes</span>
            </div>
          </article>
        ))}
      </section>

      <section className="booking-section shell" id="book" data-reveal>
        <div className="booking-heading">
          <p className="eyebrow">Book</p>
          <h2>
            Pick a session,
            <br />
            <em>pay, and pick a time.</em>
          </h2>
          <p>
            Payment is handled by the provider&apos;s own hosted checkout. Your booking is only
            confirmed once their webhook verifies the payment — never from a browser redirect.
          </p>
        </div>
        <BookingForm offerings={options} providers={availableProviders()} />
      </section>

      <CalEmbed />
    </>
  );
}
