import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { razorpayAdapter } from "../lib/payments/razorpay";

/**
 * P7 — webhook signature verification.
 *
 * This is the single most security-critical function in the codebase: it is
 * the only thing standing between "a stranger POSTed some JSON" and "we marked
 * a booking as paid and issued an invoice". Every test here is a bypass
 * attempt.
 */
const SECRET = "test_webhook_secret_value";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function headers(signature: string | null, eventId?: string): Headers {
  const h = new Headers();
  if (signature !== null) h.set("x-razorpay-signature", signature);
  if (eventId) h.set("x-razorpay-event-id", eventId);
  return h;
}

function captureBody(orderId = "order_123", paymentId = "pay_456") {
  return JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
  });
}

describe("razorpay webhook verification", () => {
  const original = process.env.RAZORPAY_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
    else process.env.RAZORPAY_WEBHOOK_SECRET = original;
  });

  it("accepts a correctly signed payload and extracts the ids", async () => {
    const body = captureBody();
    const result = await razorpayAdapter.verifyWebhook(body, headers(sign(body), "evt_1"));

    expect(result.ok).toBe(true);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.providerOrderId).toBe("order_123");
    expect(result.providerPaymentId).toBe("pay_456");
    expect(result.eventId).toBe("evt_1");
  });

  it("rejects a body tampered with after signing", async () => {
    const body = captureBody();
    const signature = sign(body);
    // Attacker inflates nothing about the amount here, but any mutation at
    // all must invalidate the signature.
    const tampered = body.replace("pay_456", "pay_EVIL");

    const result = await razorpayAdapter.verifyWebhook(tampered, headers(signature));
    expect(result.ok).toBe(false);
    expect(result.status).toBeNull();
  });

  it("rejects a signature made with the wrong secret", async () => {
    const body = captureBody();
    const result = await razorpayAdapter.verifyWebhook(
      body,
      headers(sign(body, "attacker_guessed_secret")),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a missing signature header", async () => {
    const body = captureBody();
    const result = await razorpayAdapter.verifyWebhook(body, headers(null));
    expect(result.ok).toBe(false);
  });

  it("rejects a truncated signature without throwing", async () => {
    // timingSafeEqual throws on length mismatch — the adapter must compare
    // lengths first, or a short signature crashes the route instead of
    // returning 400.
    const body = captureBody();
    const short = sign(body).slice(0, 10);

    await expect(razorpayAdapter.verifyWebhook(body, headers(short))).resolves.toMatchObject({
      ok: false,
    });
  });

  it("rejects everything when no secret is configured", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const body = captureBody();
    // Signed with the secret the server no longer has — must still fail
    // closed rather than skipping verification.
    const result = await razorpayAdapter.verifyWebhook(body, headers(sign(body)));
    expect(result.ok).toBe(false);
  });

  it("rejects malformed JSON even when the signature matches", async () => {
    const body = "{not json at all";
    const result = await razorpayAdapter.verifyWebhook(body, headers(sign(body)));
    expect(result.ok).toBe(false);
  });

  it("maps event types to the right payment status", async () => {
    const cases: [string, string | null][] = [
      ["payment.captured", "SUCCEEDED"],
      ["order.paid", "SUCCEEDED"],
      ["payment.failed", "FAILED"],
      ["refund.processed", "REFUNDED"],
      ["refund.created", "REFUNDED"],
      // Authorised means the money is held, not taken — must NOT confirm.
      ["payment.authorized", "PENDING"],
      ["payment.dispute.created", null],
      ["subscription.charged", null],
    ];

    for (const [event, expected] of cases) {
      const body = JSON.stringify({
        event,
        payload: { payment: { entity: { id: "pay_1", order_id: "order_1" } } },
      });
      const result = await razorpayAdapter.verifyWebhook(body, headers(sign(body)));
      expect(result.ok).toBe(true);
      expect(result.status, `event ${event}`).toBe(expected);
    }
  });

  it("derives a stable event id when the delivery header is absent", async () => {
    // Razorpay does not always send x-razorpay-event-id. Without a stable
    // fallback the idempotency ledger would treat every redelivery as new
    // and double-fulfil the booking.
    const body = captureBody("order_abc", "pay_xyz");
    const a = await razorpayAdapter.verifyWebhook(body, headers(sign(body)));
    const b = await razorpayAdapter.verifyWebhook(body, headers(sign(body)));

    expect(a.eventId).toBe(b.eventId);
    // Keyed on event type + payment id. The payment id is preferred over the
    // order id because it is the more specific of the two: one order can
    // produce several payment attempts, and each deserves its own ledger row.
    expect(a.eventId).toBe("payment.captured:pay_xyz");
  });

  it("gives the same payment different event ids for different event types", () => {
    // Otherwise a failed-then-retried-and-captured payment would be swallowed
    // by the idempotency ledger as a duplicate and never fulfilled.
    const forEvent = async (event: string) => {
      const body = JSON.stringify({
        event,
        payload: { payment: { entity: { id: "pay_same", order_id: "order_same" } } },
      });
      return (await razorpayAdapter.verifyWebhook(body, headers(sign(body)))).eventId;
    };

    return Promise.all([forEvent("payment.failed"), forEvent("payment.captured")]).then(
      ([failed, captured]) => expect(failed).not.toBe(captured),
    );
  });

  it("reports configured only when both key and secret exist", () => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    try {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      expect(razorpayAdapter.isConfigured()).toBe(false);

      process.env.RAZORPAY_KEY_ID = "rzp_test_x";
      expect(razorpayAdapter.isConfigured()).toBe(false);

      process.env.RAZORPAY_KEY_SECRET = "shh";
      expect(razorpayAdapter.isConfigured()).toBe(true);
    } finally {
      if (keyId === undefined) delete process.env.RAZORPAY_KEY_ID;
      else process.env.RAZORPAY_KEY_ID = keyId;
      if (keySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
      else process.env.RAZORPAY_KEY_SECRET = keySecret;
    }
  });
});
