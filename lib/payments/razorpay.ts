import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentAdapter,
  WebhookVerification,
} from "./types";
import type { PaymentStatus } from "../generated/prisma/enums";

/**
 * Razorpay adapter built on plain fetch + node:crypto rather than the official
 * SDK. The two things this app needs from Razorpay — create an order, verify a
 * webhook HMAC — are a single REST call and a signature comparison, so the SDK
 * would add a dependency without removing any real work.
 */

const API_BASE = "https://api.razorpay.com/v1";

function authHeader(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.");
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

/** Razorpay's `payment.*` / `refund.*` events, mapped to our vocabulary. */
function statusFor(eventType: string): PaymentStatus | null {
  switch (eventType) {
    case "payment.captured":
    case "order.paid":
      return "SUCCEEDED";
    case "payment.failed":
      return "FAILED";
    case "refund.processed":
    case "refund.created":
      return "REFUNDED";
    case "payment.authorized":
      // Authorised but not captured — money is held, not taken. Treated as
      // still pending so nothing is marked confirmed prematurely.
      return "PENDING";
    default:
      return null;
  }
}

export const razorpayAdapter: PaymentAdapter = {
  name: "RAZORPAY",

  isConfigured() {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  },

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const response = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        // Razorpay dedupes on this header the same way Stripe does.
        "X-Razorpay-Idempotency-Key": request.idempotencyKey,
      },
      body: JSON.stringify({
        amount: request.amountMinor,
        currency: request.currency.toUpperCase(),
        // Razorpay caps receipt at 40 characters and rejects longer ones.
        receipt: request.reference.slice(0, 40),
        notes: { bookingId: request.bookingId, reference: request.reference },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Razorpay order creation failed: ${response.status} ${detail}`);
    }

    const order = (await response.json()) as RazorpayOrder;

    return {
      provider: "RAZORPAY",
      providerOrderId: order.id,
      // Razorpay has no hosted redirect in this flow — the browser opens its
      // Checkout modal with the config below.
      redirectUrl: null,
      clientConfig: {
        key: process.env.RAZORPAY_KEY_ID,
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        name: "Shivam Patil",
        description: request.description,
        prefill: { name: request.customerName, email: request.customerEmail },
        notes: { reference: request.reference },
        theme: { color: "#111110" },
      },
    };
  },

  async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookVerification> {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = headers.get("x-razorpay-signature");

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

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const received = Buffer.from(signature, "utf8");
    const computed = Buffer.from(expected, "utf8");

    // timingSafeEqual throws on length mismatch, so compare lengths first.
    if (received.length !== computed.length || !timingSafeEqual(received, computed)) {
      console.error("[razorpay] webhook signature mismatch");
      return empty;
    }

    let event: {
      event?: string;
      payload?: {
        payment?: { entity?: { id?: string; order_id?: string } };
        order?: { entity?: { id?: string } };
        refund?: { entity?: { id?: string; payment_id?: string } };
      };
    };
    try {
      event = JSON.parse(rawBody);
    } catch {
      return empty;
    }

    const type = event.event ?? "";
    const payment = event.payload?.payment?.entity;
    const order = event.payload?.order?.entity;

    return {
      ok: true,
      // Razorpay does not send an event id in the body; the delivery id header
      // is the closest stable identifier, and it is what the idempotency
      // ledger keys on. Falling back to order+type keeps a redelivery without
      // the header from being processed twice.
      eventId:
        headers.get("x-razorpay-event-id") ?? `${type}:${payment?.id ?? order?.id ?? "unknown"}`,
      type,
      providerOrderId: payment?.order_id ?? order?.id ?? null,
      providerPaymentId: payment?.id ?? null,
      status: statusFor(type),
      raw: event,
    };
  },
};
