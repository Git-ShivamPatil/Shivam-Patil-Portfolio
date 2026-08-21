/**
 * P27 — the mail provider boundary.
 *
 * ### Why this exists at all
 *
 * `lib/mail.ts` called the Resend SDK directly from six places. That was fine
 * until §56i established that **Resend cannot be verified on this domain** —
 * it requires an MX record on a `send` subdomain, Wix does not support
 * subdomain MX records, and Resend now says so in its own dashboard by name.
 *
 * The blocker is specific to one record type, not to email. SendGrid's
 * Automated Security authenticates on CNAME records alone: the CNAME delegates
 * a subdomain into SendGrid's own zone, and SendGrid generates the SPF and MX
 * *there*, so nothing MX-shaped is ever entered at Wix. This interface is what
 * lets that provider be swapped in without touching a single caller.
 *
 * Shaped after `lib/payments/types.ts` deliberately. That module already solved
 * the same problem for Stripe and Razorpay, and a second adapter pattern with
 * different ergonomics would be one more thing to hold in your head.
 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Where a human reply should go, when that differs from the sender. */
  replyTo?: string;
  /**
   * Extra headers. Used for RFC 8058 one-click unsubscribe, which Gmail and
   * Yahoo require on bulk mail — so a provider that silently drops headers is
   * not a usable provider here.
   */
  headers?: Record<string, string>;
}

export interface MailAdapter {
  name: MailProvider;
  /** True when this provider's credentials are present in the environment. */
  isConfigured: () => boolean;
  /**
   * Send, or throw.
   *
   * Throwing rather than returning a result is deliberate: every caller in
   * lib/mail.ts already treats a send as best-effort and catches, and a
   * `{ ok: false }` that callers forget to check is a message silently lost.
   */
  send: (message: MailMessage, from: string) => Promise<void>;
}

export type MailProvider = "RESEND" | "SENDGRID";
