# Remaining manual setup

Everything in this file needs a login I can't perform on your behalf. The site
builds, deploys, and runs correctly with none of it done — each item just
switches a feature from "degraded" to "fully working". Do them in any order.

Nothing here costs money. Stripe and Razorpay charge no signup or monthly fee;
they take a percentage only of money you actually receive.

---

## 1. Email — add DNS records for shivamsfolio.com

**Status: half done.** I created a sending-access API key (already in
`.env.local`) and registered the domain in Resend. Until the DNS records below
exist, Resend falls back to its shared `onboarding@resend.dev` sender, which is
**only allowed to deliver to shivampatilinfo@gmail.com**. So today the contact
form notifies you fine, but password resets, newsletter confirmations, and
booking receipts to _other people_ will not send.

Resend domain: https://resend.com/domains/b3a58209-e177-4080-91a1-7cdf3351c516
Region: Tokyo (ap-northeast-1) — closest to India.

Add these at whichever registrar/DNS host serves shivamsfolio.com. Values are
copied verbatim from Resend, not reconstructed.

### Required — DKIM

| Type | Name                | Value                                                                                                                                                                                                                        | TTL  |
| ---- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| TXT  | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDw511/qieQYATZJ4TkBheOH+eXZ/doDPGvJRYejdkBKJp3VhQA4c9M6OmxJZhCjWblmp6JZg+9wm8BTzTV7psQDPp+gSWVKrlbtgyTXP0dy3pzqTMV38Ky6cYLwa6RnrZ/oA9QUcq7KEQHaMv7jwWKhnAbE6jv5/nH4etBOnpXwQIDAQAB` | Auto |

### Required — SPF

| Type | Name   | Value                                        | Priority | TTL  |
| ---- | ------ | -------------------------------------------- | -------- | ---- |
| MX   | `send` | `feedback-smtp.ap-northeast-1.amazonses.com` | 10       | Auto |
| TXT  | `send` | `v=spf1 include:amazonses.com ~all`          | —        | Auto |

### Optional — DMARC (recommended; improves deliverability)

| Type | Name     | Value               | TTL  |
| ---- | -------- | ------------------- | ---- |
| TXT  | `_dmarc` | `v=DMARC1; p=none;` | Auto |

### Optional — inbound (only if you want to _receive_ mail at the domain)

| Type | Name | Value                                       | Priority | TTL  |
| ---- | ---- | ------------------------------------------- | -------- | ---- |
| MX   | `@`  | `inbound-smtp.ap-northeast-1.amazonaws.com` | 10       | Auto |

**Caution:** an `@` MX record replaces where mail for the whole domain is
delivered. Skip this one unless you are sure nothing else serves mail there.

**Resend flagged one blocker:** if DNS for shivamsfolio.com is managed by
**Wix**, verification cannot work — Wix does not support subdomains on MX
records. Move DNS to Cloudflare (free) or your registrar if that's the case.

### After the records propagate

1. Click **Verify** on the Resend domain page.
2. Change `EMAIL_FROM` in `.env.local` (and in Vercel) to a real address on the
   domain, e.g. `Shivam Patil <hello@shivamsfolio.com>`.

Do **not** change `EMAIL_FROM` before verification succeeds — an unverified
sender domain makes Resend reject every send, which is worse than the current
degraded state.

---

## 2. Payments — Stripe

You said you already have an account.

1. Go to https://dashboard.stripe.com/test/apikeys (test mode, top-right toggle).
2. Copy the **Secret key** (`sk_test_…`) → `STRIPE_SECRET_KEY`.
3. Go to https://dashboard.stripe.com/test/webhooks → **Add endpoint**.
   - URL: `https://<your-domain>/api/webhooks/stripe`
   - Events to send — exactly these four:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `checkout.session.async_payment_failed`
     - `charge.refunded`
4. Copy the endpoint's **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.

To test locally without a public URL:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

That prints its own `whsec_…` — use it for local runs only.

---

## 3. Payments — Razorpay

You said you already have an account.

1. Go to https://dashboard.razorpay.com/app/website-app-settings/api-keys
2. Switch to **Test Mode**, then **Generate Test Key**.
   - Key Id (`rzp_test_…`) → `RAZORPAY_KEY_ID`
   - Key Secret → `RAZORPAY_KEY_SECRET` (shown once — copy it immediately)
3. Go to https://dashboard.razorpay.com/app/webhooks → **Add New Webhook**.
   - URL: `https://<your-domain>/api/webhooks/razorpay`
   - Secret: choose any strong string → `RAZORPAY_WEBHOOK_SECRET`
   - Active events — exactly these four:
     - `payment.captured`
     - `payment.failed`
     - `order.paid`
     - `refund.processed`

Razorpay needs KYC/business details for **live** mode. Test mode works
immediately and costs nothing.

---

## 4. GitHub token (optional)

Raises `/stats` from 60 requests/hour to 5,000. The panel already works without
it.

1. https://github.com/settings/personal-access-tokens/new
2. Fine-grained token, **Public repositories (read-only)** — no other scopes.
3. → `GITHUB_TOKEN`

---

## 5. Cal.com (optional)

Free individual plan. Without `CAL_USERNAME` the intro-call section on
`/services` is simply not rendered.

1. Sign up at https://cal.com/signup
2. Your handle from `cal.com/<handle>` → `CAL_USERNAME`
3. The event slug you want to expose (default `30min`) → `CAL_EVENT_SLUG`

---

## 6. Vercel environment variables

Every variable in `.env.local` must be added to the Vercel project for
production. In particular these are **required** or the deploy will not behave:

- `DATABASE_URL`, `DIRECT_URL`
- `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST`
- `NEXT_PUBLIC_SITE_URL` — must be the real production origin, since it builds
  the links inside every outgoing email and the webhook success/cancel URLs.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `RESEND_API_KEY`, `EMAIL_FROM`

Anything absent degrades rather than crashes — see the table in README.md.
