import Stripe from "stripe";
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentAdapter,
  WebhookVerification,
} from "./types";
import type { PaymentStatus } from "../generated/prisma/enums";

let client: Stripe | null = null;

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  // Lazily constructed and cached: building the client at module scope would
  // throw at import time on a deployment that only uses Razorpay.
  client ??= new Stripe(key);
  return client;
}

/** Map the handful of Stripe events this app acts on. */
function statusFor(eventType: string): PaymentStatus | null {
  switch (eventType) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return "SUCCEEDED";
    case "checkout.session.async_payment_failed":
    case "payment_intent.payment_failed":
      return "FAILED";
    case "charge.refunded":
      return "REFUNDED";
    case "checkout.session.expired":
      return "FAILED";
    default:
      return null;
  }
}

export const stripeAdapter: PaymentAdapter = {
  name: "STRIPE",

  isConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  },

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        customer_email: request.customerEmail,
        client_reference_id: request.bookingId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: request.currency.toLowerCase(),
              unit_amount: request.amountMinor,
              product_data: {
                name: request.description,
                // Surfaces on the Stripe-hosted page and the receipt.
                description: `Booking ${request.reference}`,
              },
            },
          },
        ],
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        // Echoed back on every webhook for this session, so the handler can
        // resolve the booking without a lookup table.
        metadata: { bookingId: request.bookingId, reference: request.reference },
        payment_intent_data: {
          metadata: { bookingId: request.bookingId, reference: request.reference },
        },
      },
      { idempotencyKey: request.idempotencyKey },
    );

    return {
      provider: "STRIPE",
      providerOrderId: session.id,
      redirectUrl: session.url,
    };
  },

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookVerification> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const signature = headers.get("stripe-signature");

    const empty: WebhookVerification = {
      ok: false,
      eventId: "",
      type: "",
      providerOrderId: null,
      providerPaymentId: null,
      status: null,
      raw: null,
    };

    if (!secret || !signature) return empty;

    let event: Stripe.Event;
    try {
      // constructEvent does the timing-safe HMAC comparison *and* enforces the
      // timestamp tolerance, which is what makes replaying an old captured
      // request fail rather than succeed.
      event = stripe().webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      console.error("[stripe] webhook signature verification failed:", error);
      return empty;
    }

    let providerOrderId: string | null = null;
    let providerPaymentId: string | null = null;

    // The union of every Stripe resource shape has no index signature, so the
    // narrowing below goes through `unknown` — we only read fields we've
    // already gated on by event type.
    const object = event.data.object as unknown as Record<string, unknown>;
    if (event.type.startsWith("checkout.session.")) {
      providerOrderId = (object.id as string) ?? null;
      providerPaymentId = (object.payment_intent as string) ?? null;
    } else if (event.type.startsWith("payment_intent.")) {
      providerPaymentId = (object.id as string) ?? null;
    } else if (event.type.startsWith("charge.")) {
      providerPaymentId = (object.payment_intent as string) ?? null;
    }

    return {
      ok: true,
      eventId: event.id,
      type: event.type,
      providerOrderId,
      providerPaymentId,
      status: statusFor(event.type),
      raw: event,
    };
  },
};
