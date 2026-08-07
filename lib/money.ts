/**
 * Money helpers.
 *
 * Every amount in this codebase is an integer in the currency's *minor* unit
 * (paise, cents). Both Stripe and Razorpay take minor units on the wire, and
 * keeping them integral end-to-end means the number that is charged, the
 * number that is stored, and the number that is invoiced can never drift apart
 * through float rounding.
 */

/** Currencies with no minor unit — amounts are already whole. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

export function minorUnitFactor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100;
}

export function toMajor(minor: number, currency: string): number {
  return minor / minorUnitFactor(currency);
}

export function toMinor(major: number, currency: string): number {
  return Math.round(major * minorUnitFactor(currency));
}

export function formatMoney(minor: number, currency: string, locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2,
  }).format(toMajor(minor, currency));
}
