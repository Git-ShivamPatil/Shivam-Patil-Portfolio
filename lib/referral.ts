// Lightweight referral attribution: a ?ref= query param is captured into a
// first-party cookie on any page landing, then read back when the contact
// form is submitted (see components/referral-capture.tsx and
// components/contact-form.tsx). Deliberately not a page-view logging
// pipeline — the only thing worth tracking here is "which source produced a
// lead," not full analytics (Vercel Analytics already covers traffic).
export const REFERRAL_COOKIE = "spf_ref";
export const REFERRAL_COOKIE_MAX_AGE_DAYS = 30;

export function readReferralCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${REFERRAL_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}
