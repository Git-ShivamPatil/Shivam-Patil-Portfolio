import type { MailAdapter, MailMessage, MailProvider } from "./types";
import { resendAdapter } from "./resend-adapter";
import { sendgridAdapter } from "./sendgrid-adapter";

export * from "./types";

/**
 * P27 — provider selection, shaped after `lib/payments/index.ts`.
 *
 * ### The default, and why it is SendGrid
 *
 * §56i: Resend requires an MX record on a `send` subdomain, Wix cannot create
 * one, and Resend's dashboard now names Wix explicitly as unable to verify.
 * SendGrid's Automated Security authenticates on CNAME records alone. So on
 * *this* domain SendGrid is the one that can actually be verified, and an
 * unverified sender is what puts mail in spam.
 *
 * Resend stays as an adapter rather than being deleted. It works, and the only
 * thing wrong with it here is a DNS constraint that is not its fault — on a
 * domain not hosted at Wix it remains the better API.
 *
 * ### Order matters, and it is not alphabetical
 *
 * `PREFERENCE` is the order tried when `MAIL_PROVIDER` is unset. Whichever is
 * configured first wins, so adding a SendGrid key is the whole switch — no code
 * change, no redeploy of anything but the environment. Setting `MAIL_PROVIDER`
 * explicitly overrides it, which is what a rollback looks like if SendGrid ever
 * misbehaves: set it to `RESEND` and the previous behaviour is back.
 */
const ADAPTERS: Record<MailProvider, MailAdapter> = {
  SENDGRID: sendgridAdapter,
  RESEND: resendAdapter,
};

const PREFERENCE: MailProvider[] = ["SENDGRID", "RESEND"];

/** Providers whose credentials are actually present. */
export function availableMailProviders(): MailProvider[] {
  return PREFERENCE.filter((name) => ADAPTERS[name].isConfigured());
}

/**
 * The adapter to send with, or null when nothing is configured.
 *
 * **Null is a supported state, not an error.** Every caller degrades to logging
 * what it would have sent, which is what keeps local development and CI working
 * without credentials — and it is the same shape `lib/payments` uses for a
 * provider whose keys are absent.
 */
export function mailAdapter(): MailAdapter | null {
  const explicit = process.env.MAIL_PROVIDER?.toUpperCase();

  if (explicit === "SENDGRID" || explicit === "RESEND") {
    const chosen = ADAPTERS[explicit];
    // Named but unconfigured is a misconfiguration worth being loud about
    // rather than silently falling through to the other provider — mail
    // arriving from an unexpected sender is harder to diagnose than none.
    if (!chosen.isConfigured()) {
      console.warn(`[mail] MAIL_PROVIDER=${explicit} but its API key is not set — not sending.`);
      return null;
    }
    return chosen;
  }

  const available = availableMailProviders();
  return available.length > 0 ? ADAPTERS[available[0]] : null;
}

/**
 * Send through whichever provider is configured.
 *
 * Returns `false` when nothing is configured, so the caller can log what it
 * would have sent — including the link a developer needs, which is the whole
 * reason those log lines exist.
 *
 * Failures throw, and every caller in lib/mail.ts is already best-effort about
 * that: the money is captured and the invoice issued before a confirmation
 * email is attempted, so a mail outage must never fail the operation.
 */
export async function sendMail(message: MailMessage, from: string): Promise<boolean> {
  const adapter = mailAdapter();
  if (!adapter) return false;

  await adapter.send(message, from);
  return true;
}
