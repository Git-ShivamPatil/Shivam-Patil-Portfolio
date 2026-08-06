import { emailButton, emailLayout } from "./layout";

export function passwordResetEmail({ resetUrl }: { resetUrl: string }): {
  subject: string;
  html: string;
} {
  const bodyHtml = `
    <p style="margin:0 0 16px;font:700 20px Arial,sans-serif;color:#111110;">Reset your password</p>
    <p style="margin:0 0 24px;font:400 14px/1.6 Arial,sans-serif;color:#42413c;">
      We received a request to reset the password for your account. This link expires in 1 hour
      and can only be used once.
    </p>
    ${emailButton(resetUrl, "Reset password")}
    <p style="margin:24px 0 0;font:400 12px/1.6 Arial,sans-serif;color:#6d6c66;">
      If you didn't request this, you can safely ignore this email — your password won't change.
    </p>
  `;
  return {
    subject: "Reset your password",
    html: emailLayout({ previewText: "Reset your password — link expires in 1 hour", bodyHtml }),
  };
}

export function oauthOnlyAccountEmail({ loginUrl }: { loginUrl: string }): {
  subject: string;
  html: string;
} {
  const bodyHtml = `
    <p style="margin:0 0 16px;font:700 20px Arial,sans-serif;color:#111110;">You already have an account</p>
    <p style="margin:0 0 24px;font:400 14px/1.6 Arial,sans-serif;color:#42413c;">
      Someone requested a password reset for this email address, but this account signs in with
      Google or GitHub — there's no password to reset. Use the button below to sign in that way
      instead.
    </p>
    ${emailButton(loginUrl, "Go to sign in")}
    <p style="margin:24px 0 0;font:400 12px/1.6 Arial,sans-serif;color:#6d6c66;">
      If you didn't request this, you can safely ignore this email.
    </p>
  `;
  return {
    subject: "About your account",
    html: emailLayout({ previewText: "This account signs in with Google or GitHub", bodyHtml }),
  };
}
