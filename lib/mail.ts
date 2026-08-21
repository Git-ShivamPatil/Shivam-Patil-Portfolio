import {
  bookingConfirmedEmail,
  contactFormEmail,
  newsletterConfirmEmail,
  newsletterWelcomeEmail,
  oauthOnlyAccountEmail,
  passwordResetEmail,
} from "./email/templates";
import { sendMail } from "./email";
import { siteUrl } from "./seo/site";

/**
 * Transactional mail.
 *
 * **P27 moved the provider behind an adapter** (`lib/email/`). Every function
 * here used to call the Resend SDK directly, which was fine until §56i
 * established that Resend cannot be domain-verified on Wix DNS at all — it
 * needs an MX record on a `send` subdomain and Wix does not support those.
 * Nothing in this file names a provider now; `lib/email/index.ts` picks one.
 *
 * **The degraded path is a feature, not a stub.** With no provider configured,
 * every function below logs what it would have sent — including the reset link,
 * the confirmation URL, the invoice URL — and returns normally. That is what
 * makes local development and CI work without credentials, and it is why the
 * log lines carry the URL rather than just saying "not sent".
 */

/**
 * The sender.
 *
 * Still Resend's shared test address by default, which is why mail currently
 * lands in spam: authentication follows the *sending* domain, so no amount of
 * SPF or DKIM on shivamsfolio.com can help a message sent from resend.dev.
 * Once a domain is verified with whichever provider is in use, set this to
 * `shivam@shivamsfolio.com` and the spam placement goes with it.
 */
const FROM = process.env.EMAIL_FROM ?? "Shivam Patil <onboarding@resend.dev>";

/** The same address published on /contact and /reach-out. */
const SITE_OWNER_EMAIL = "shivampatilinfo@gmail.com";

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resetUrl = `${siteUrl}/reset-password/${token}`;
  const { subject, html } = passwordResetEmail({ resetUrl });

  const sent = await sendMail({ to, subject, html }, FROM);
  if (!sent) {
    console.warn(`[mail] no provider configured — password reset link for ${to}: ${resetUrl}`);
  }
}

export async function sendOAuthOnlyNotice(to: string): Promise<void> {
  const loginUrl = `${siteUrl}/login`;
  const { subject, html } = oauthOnlyAccountEmail({ loginUrl });

  const sent = await sendMail({ to, subject, html }, FROM);
  if (!sent) {
    console.warn(`[mail] no provider configured — OAuth-only notice for ${to} not sent.`);
  }
}

export async function sendContactFormEmail(input: {
  name: string;
  email: string;
  message: string;
}): Promise<void> {
  const { subject, html } = contactFormEmail(input);

  const sent = await sendMail(
    {
      to: SITE_OWNER_EMAIL,
      // So hitting reply in the inbox answers the visitor rather than the
      // sending domain. The message body is untrusted; `replyTo` is an address
      // the schema already validated.
      replyTo: input.email,
      subject,
      html,
    },
    FROM,
  );

  if (!sent) {
    console.warn(
      `[mail] no provider configured — contact form message from ${input.email} not sent:\n${input.message}`,
    );
  }
}

// ---- Phase 6: newsletter ----

export async function sendNewsletterConfirmation(to: string, confirmToken: string): Promise<void> {
  const confirmUrl = `${siteUrl}/api/newsletter/confirm?token=${confirmToken}`;
  const { subject, html } = newsletterConfirmEmail({ confirmUrl });

  const sent = await sendMail({ to, subject, html }, FROM);
  if (!sent) {
    console.warn(
      `[mail] no provider configured — newsletter confirm link for ${to}: ${confirmUrl}`,
    );
  }
}

export async function sendNewsletterWelcome(to: string, unsubToken: string): Promise<void> {
  const unsubscribeUrl = `${siteUrl}/api/newsletter/unsubscribe?token=${unsubToken}`;
  const { subject, html } = newsletterWelcomeEmail({ unsubscribeUrl });

  const sent = await sendMail(
    {
      to,
      subject,
      html,
      // One-click unsubscribe (RFC 8058). Gmail and Yahoo require this on bulk
      // mail, and it keeps the list clean without a round-trip through the
      // site. A provider that drops these headers is not usable here.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
    FROM,
  );

  if (!sent) {
    console.warn(`[mail] no provider configured — welcome email for ${to} not sent.`);
  }
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
  const invoiceUrl = `${siteUrl}/invoice/${input.invoiceToken}`;
  const { subject, html } = bookingConfirmedEmail({ ...input, invoiceUrl });

  const sent = await sendMail({ to, replyTo: SITE_OWNER_EMAIL, subject, html }, FROM);
  if (!sent) {
    console.warn(
      `[mail] no provider configured — booking confirmation for ${to} (${input.reference}) not sent. Invoice: ${invoiceUrl}`,
    );
  }
}
