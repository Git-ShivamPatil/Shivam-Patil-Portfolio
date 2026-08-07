"use client";

import { useEffect } from "react";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_DAYS } from "../lib/referral";

// Mounted once in the root layout. Reads window.location directly (rather
// than next/navigation's useSearchParams) so it never forces the static
// marketing pages into dynamic rendering — see the comment on proxy.ts's
// matcher for why that matters here.
export function ReferralCapture() {
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref) return;
    const maxAge = REFERRAL_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
    document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(ref.slice(0, 80))}; path=/; max-age=${maxAge}; samesite=lax`;
  }, []);

  return null;
}
