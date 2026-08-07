import type { PaymentProvider, PaymentStatus } from "../generated/prisma/enums";

export interface CheckoutRequest {
  bookingId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  description: string;
  customerEmail: string;
  customerName: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Stable per (booking, provider). Replaying a create-checkout command with
   * the same key must not create a second order — this is the Idempotency-Key
   * stage of the write path, pushed all the way out to the provider.
   */
  idempotencyKey: string;
}

export interface CheckoutSession {
  provider: PaymentProvider;
  /** Provider-side order/session id, stored as Payment.providerOrderId. */
  providerOrderId: string;
  /** Hosted-page URL, or null when the provider uses an in-page SDK. */
  redirectUrl: string | null;
  /** Handed to the browser SDK (Razorpay Checkout) when there is no redirect. */
  clientConfig?: Record<string, unknown>;
}

/**
 * Normalised result of verifying and interpreting a provider webhook.
 *
 * `ok: false` means the signature did not verify — the caller must reject the
 * request without touching any state.
 */
export interface WebhookVerification {
  ok: boolean;
  eventId: string;
  type: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  /** Null for event types this app does not act on (which is most of them). */
  status: PaymentStatus | null;
  raw: unknown;
}

export interface PaymentAdapter {
  name: PaymentProvider;
  /** Whether the necessary secrets are present in the environment. */
  isConfigured(): boolean;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookVerification>;
}
