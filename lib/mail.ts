import { Resend } from "resend";
import { oauthOnlyAccountEmail, passwordResetEmail } from "./email/templates";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://shivamsfolio.com";
// Falls back to Resend's shared test sender until shivamsfolio.com is
// domain-verified in the Resend dashboard.
const FROM = process.env.EMAIL_FROM ?? "Shivam Patil <onboarding@resend.dev>";

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
