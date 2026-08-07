import { Resend } from "resend";
import {
  bookingConfirmedEmail,
  contactFormEmail,
  newsletterConfirmEmail,
  newsletterWelcomeEmail,
  oauthOnlyAccountEmail,
  passwordResetEmail,
} from "./email/templates";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shivamsfolio.com";
// Falls back to Resend's shared test sender until shivamsfolio.com is
// domain-verified in the Resend dashboard.
const FROM = process.env.EMAIL_FROM ?? "Shivam Patil <onboarding@resend.dev>";
// The same address already published on /contact and /reach-out — where
// contact-form submissions land.
const SITE_OWNER_EMAIL = "shivampatilinfo@gmail.com";

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resend = getResendClient();
  const resetUrl = `${siteUrl}/reset-password/${token}`;
  const { subject, html } = passwordResetEmail({ resetUrl });

  if (!resend) {
    // No RESEND_API_KEY configured yet — log instead of throwing, so local
    // development / testing without email credentials still works.
    console.warn(`[mail] RESEND_API_KEY not set — password reset link for ${to}: ${resetUrl}`);
    return;
  }

  await resend.emails.send({ from: FROM, to, subject, html });
}

export async function sendOAuthOnlyNotice(to: string): Promise<void> {
  const resend = getResendClient();
  const loginUrl = `${siteUrl}/login`;
  const { subject, html } = oauthOnlyAccountEmail({ loginUrl });

  if (!resend) {
    console.warn(`[mail] RESEND_API_KEY not set — OAuth-only notice for ${to} not sent.`);
    return;
  }

  await resend.emails.send({ from: FROM, to, subject, html });
}

export async function sendContactFormEmail(input: {
  name: string;
  email: string;
  message: string;
}): Promise<void> {
  const resend = getResendClient();
  const { subject, html } = contactFormEmail(input);

  if (!resend) {
    console.warn(
      `[mail] RESEND_API_KEY not set — contact form message from ${input.email} not sent:\n${input.message}`,
    );
    return;
  }

  await resend.emails.send({
    from: FROM,
    to: SITE_OWNER_EMAIL,
    replyTo: input.email,
    subject,
    html,
  });
}

// ---- Phase 6: newsletter ----

export async function sendNewsletterConfirmation(to: string, confirmToken: string): Promise<void> {
  const resend = getResendClient();
  const confirmUrl = `${siteUrl}/api/newsletter/confirm?token=${confirmToken}`;
  const { subject, html } = newsletterConfirmEmail({ confirmUrl });

  if (!resend) {
    console.warn(
      `[mail] RESEND_API_KEY not set — newsletter confirm link for ${to}: ${confirmUrl}`,
    );
    return;
  }

  await resend.emails.send({ from: FROM, to, subject, html });
}

export async function sendNewsletterWelcome(to: string, unsubToken: string): Promise<void> {
  const resend = getResendClient();
  const unsubscribeUrl = `${siteUrl}/api/newsletter/unsubscribe?token=${unsubToken}`;
  const { subject, html } = newsletterWelcomeEmail({ unsubscribeUrl });

  if (!resend) {
    console.warn(`[mail] RESEND_API_KEY not set — welcome email for ${to} not sent.`);
    return;
  }

  await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
    // One-click unsubscribe (RFC 8058). Gmail and Yahoo require this on bulk
    // mail, and it keeps the list clean without a round-trip through the site.
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}

// ---- Phase 7: bookings ----

export async function sendBookingConfirmation(
  to: string,
  input: {
    reference: string;
    offering: string;
    amount: string;
    invoiceToken: string;
    scheduledAt: string | null;
  },
): Promise<void> {
  const resend = getResendClient();
  const invoiceUrl = `${siteUrl}/invoice/${input.invoiceToken}`;
  const { subject, html } = bookingConfirmedEmail({ ...input, invoiceUrl });

  if (!resend) {
    console.warn(
      `[mail] RESEND_API_KEY not set — booking confirmation for ${to} (${input.reference}) not sent. Invoice: ${invoiceUrl}`,
    );
    return;
  }

  await resend.emails.send({ from: FROM, to, replyTo: SITE_OWNER_EMAIL, subject, html });
}
