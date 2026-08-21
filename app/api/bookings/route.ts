import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { bookingSchema } from "../../../lib/validations/booking";
import { getAdapter, defaultProviderFor } from "../../../lib/payments";
import { createBookingWithReference, checkoutIdempotencyKey } from "../../../lib/bookings";
import { consume, clientIp } from "../../../lib/rate-limit";
import { withRed } from "../../../lib/sre/red";
import { checkIdempotency, hashBody, isValidKey, remember } from "../../../lib/distsys/idempotency";
import { siteUrl } from "../../../lib/seo/site";
import type { Prisma } from "../../../lib/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/bookings";

/**
 * Create a booking and open a checkout for it.
 *
 * The booking row is written first and lands as PENDING_PAYMENT: a lead that
 * abandons at the payment step is still a lead worth having, and the webhook
 * needs a row to attach to before the provider can call back. Nothing is
 * treated as confirmed here — only a verified webhook promotes a booking to
 * CONFIRMED, because a client-side "success" redirect is trivially forged.
 */
/* P21 — measured. The route that most needs it: it takes a payment, so a 5xx
   here is a customer stuck mid-checkout rather than a panel that renders empty. */
export const POST = withRed(ROUTE, handlePOST);

async function handlePOST(request: Request) {
  const limit = await consume(`booking:${clientIp(request)}`, 5, 0.1);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many booking attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  // Read the body as text so it can be hashed for the idempotency check before
  // it is parsed. Parsing first and re-serialising would hash a *normalised*
  // body, so two genuinely different requests could hash the same.
  const rawBody = await request.text().catch(() => "");

  /**
   * `Idempotency-Key` — the second money-path defect this route carried.
   *
   * `checkoutIdempotencyKey` is derived from `booking.id`, which is minted
   * fresh on every request. It therefore deduped retries of the *checkout call
   * for one booking* and did nothing at all about retries of the HTTP request:
   * a double-clicked submit, or a client that retried after a dropped
   * connection, produced two Booking rows and two provider orders. The
   * customer sees two checkouts and the owner sees a phantom lead.
   *
   * Keying the whole route fixes it at the boundary. An absent key degrades to
   * the old behaviour rather than refusing, because the header is optional by
   * design and older clients must keep working.
   */
  const idempotencyKey = request.headers.get("Idempotency-Key");
  const key = isValidKey(idempotencyKey) ? idempotencyKey : null;
  const requestHash = hashBody(rawBody);

  if (key) {
    const outcome = await checkIdempotency(key, ROUTE, requestHash);
    if (outcome.kind === "replay") {
      return NextResponse.json(outcome.body as Record<string, unknown>, {
        status: outcome.status,
        headers: { "Idempotency-Replayed": "true" },
      });
    }
    if (outcome.kind === "conflict") {
      return NextResponse.json(
        {
          error:
            "This Idempotency-Key was already used with a different booking. Use a new key per distinct request.",
        },
        { status: 422 },
      );
    }
  }

  const parsed = bookingSchema.safeParse(
    (() => {
      try {
        return JSON.parse(rawBody) as unknown;
      } catch {
        return null;
      }
    })(),
  );
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
    // Retries internally on a reference collision. Before this, a collision
    // was a 500 for a customer mid-payment — see lib/bookings.ts for why the
    // reference stays random rather than becoming a collision-free counter.
    const booking = await createBookingWithReference({
      offeringId: offering.id,
      name: input.name,
      email: input.email.toLowerCase(),
      company: input.company || null,
      notes: input.notes || null,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      calBookingUid: input.calBookingUid || null,
      referralRef: input.ref || null,
    });

    const checkoutKey = checkoutIdempotencyKey(booking.id, provider);

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
      idempotencyKey: checkoutKey,
    });

    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider,
        providerOrderId: session.providerOrderId,
        amountMinor: offering.priceMinor,
        currency: offering.currency,
        status: "PENDING",
        idempotencyKey: checkoutKey,
      },
    });

    const body = {
      reference: booking.reference,
      provider,
      redirectUrl: session.redirectUrl,
      clientConfig: session.clientConfig ?? null,
    };

    // Remembered only after the provider order and Payment row both exist, so
    // a replay hands back a checkout that is actually payable. Storing it any
    // earlier would pin a response describing work that had not finished.
    // `clientConfig` is typed `Record<string, unknown>` because each adapter
    // shapes it differently, but every adapter builds it from JSON it is about
    // to hand to the browser. The cast asserts that, and nothing wider.
    if (key) await remember(key, ROUTE, requestHash, 201, body as Prisma.InputJsonValue);

    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    console.error("POST /api/bookings failed:", error);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 },
    );
  }
}
