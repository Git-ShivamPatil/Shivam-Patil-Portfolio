import { emailButton, emailLayout, escapeHtml } from "./layout";

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

export function contactFormEmail({
  name,
  email,
  message,
}: {
  name: string;
  email: string;
  message: string;
}): { subject: string; html: string } {
  // name/email/message are visitor-supplied — escape before interpolating.
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br />");

  const bodyHtml = `
    <p style="margin:0 0 16px;font:700 20px Arial,sans-serif;color:#111110;">New message from your site</p>
    <p style="margin:0 0 4px;font:700 12px Arial,sans-serif;color:#6d6c66;text-transform:uppercase;letter-spacing:0.05em;">From</p>
    <p style="margin:0 0 20px;font:400 14px Arial,sans-serif;color:#42413c;">
      ${safeName} &lt;<a href="mailto:${safeEmail}" style="color:#42413c;">${safeEmail}</a>&gt;
    </p>
    <p style="margin:0 0 4px;font:700 12px Arial,sans-serif;color:#6d6c66;text-transform:uppercase;letter-spacing:0.05em;">Message</p>
    <p style="margin:0 0 24px;font:400 14px/1.6 Arial,sans-serif;color:#42413c;">${safeMessage}</p>
    ${emailButton(`mailto:${safeEmail}`, "Reply")}
  `;
  return {
    subject: `New contact form message from ${name}`,
    html: emailLayout({ previewText: `${name} sent a message via shivamsfolio.com`, bodyHtml }),
  };
}

export function newsletterConfirmEmail({ confirmUrl }: { confirmUrl: string }): {
  subject: string;
  html: string;
} {
  const bodyHtml = `
    <p style="margin:0 0 16px;font:700 20px Arial,sans-serif;color:#111110;">Confirm your subscription</p>
    <p style="margin:0 0 24px;font:400 14px/1.6 Arial,sans-serif;color:#42413c;">
      You asked to receive occasional notes on distributed systems, production AI, and what
      I am building. Confirm below and you are on the list — one click, no account.
    </p>
    ${emailButton(confirmUrl, "Confirm subscription")}
    <p style="margin:24px 0 0;font:400 12px/1.6 Arial,sans-serif;color:#6d6c66;">
      If you did not request this, ignore this email — nothing is sent until you confirm.
    </p>
  `;
  return {
    subject: "Confirm your subscription",
    html: emailLayout({ previewText: "One click to confirm your subscription", bodyHtml }),
  };
}

export function newsletterWelcomeEmail({ unsubscribeUrl }: { unsubscribeUrl: string }): {
  subject: string;
  html: string;
} {
  const bodyHtml = `
    <p style="margin:0 0 16px;font:700 20px Arial,sans-serif;color:#111110;">You are subscribed</p>
    <p style="margin:0 0 24px;font:400 14px/1.6 Arial,sans-serif;color:#42413c;">
      Thanks for subscribing. Expect infrequent, technical posts — architecture decisions,
      failure modes worth knowing about, and the occasional teardown.
    </p>
    ${emailButton("https://shivamsfolio.com/blog", "Read the blog")}
    <p style="margin:24px 0 0;font:400 12px/1.6 Arial,sans-serif;color:#6d6c66;">
      Changed your mind? <a href="${unsubscribeUrl}" style="color:#6d6c66;">Unsubscribe</a> any time.
    </p>
  `;
  return {
    subject: "You are subscribed",
    html: emailLayout({ previewText: "Welcome aboard", bodyHtml }),
  };
}

export function bookingConfirmedEmail(input: {
  reference: string;
  offering: string;
  amount: string;
  invoiceUrl: string;
  scheduledAt: string | null;
}): { subject: string; html: string } {
  const safeRef = escapeHtml(input.reference);
  const safeOffering = escapeHtml(input.offering);
  const safeAmount = escapeHtml(input.amount);
  const when = input.scheduledAt
    ? `<p style="margin:0 0 20px;font:400 14px/1.6 Arial,sans-serif;color:#42413c;">Scheduled for <strong>${escapeHtml(input.scheduledAt)}</strong>.</p>`
    : `<p style="margin:0 0 20px;font:400 14px/1.6 Arial,sans-serif;color:#42413c;">I will follow up shortly to lock in a time that works for you.</p>`;

  const bodyHtml = `
    <p style="margin:0 0 16px;font:700 20px Arial,sans-serif;color:#111110;">Payment received</p>
    <p style="margin:0 0 8px;font:400 14px/1.6 Arial,sans-serif;color:#42413c;">
      Your booking for <strong>${safeOffering}</strong> is confirmed.
    </p>
    <p style="margin:0 0 20px;font:400 14px/1.6 Arial,sans-serif;color:#42413c;">
      Reference <strong>${safeRef}</strong> · <strong>${safeAmount}</strong>
    </p>
    ${when}
    ${emailButton(input.invoiceUrl, "View invoice")}
  `;
  return {
    subject: `Booking confirmed — ${input.reference}`,
    html: emailLayout({ previewText: `${input.offering} confirmed`, bodyHtml }),
  };
}
