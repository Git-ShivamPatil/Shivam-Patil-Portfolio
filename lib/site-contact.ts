/**
 * The two direct-contact channels the header exposes, and the WhatsApp deep
 * link the casual path builds on.
 *
 * **The phone number is an environment variable, deliberately, and the site
 * works without it.**
 *
 * Two reasons, and the second is the one that decided it:
 *
 * 1. This repository is public. A personal mobile number committed to it is
 *    scraped within a day and cannot be un-published — the git history keeps
 *    it even after a later commit removes the line.
 * 2. A `tel:` or `wa.me` link built from a placeholder is worse than no button
 *    at all. It looks live, it is tappable, and it fails in the visitor's
 *    dialler rather than on the page. Every other integration in this codebase
 *    degrades by design when its credential is absent (see HANDOFF §31); this
 *    follows that rule instead of inventing an exception.
 *
 * Set `NEXT_PUBLIC_CONTACT_PHONE` to switch on the phone button, the WhatsApp
 * links and the invite card. It is `NEXT_PUBLIC_` because the value has to
 * reach an `href` the browser renders, so it is public by definition — that is
 * a reason to be deliberate about it, not a leak.
 *
 * Format it in full international form with no spaces or punctuation, e.g.
 * `919876543210`. `tel:` tolerates most things; `wa.me` does not — it wants
 * digits and a country code and silently 404s on anything else.
 */

/** Digits only, country code included. Empty string when unset. */
const rawPhone = (process.env.NEXT_PUBLIC_CONTACT_PHONE ?? "").replace(/[^\d]/g, "");

export const contactEmail = "shivampatilinfo@gmail.com";

/** Null when unset, so every call site has to decide what to do about it. */
export const contactPhone: string | null = rawPhone.length >= 8 ? rawPhone : null;

export const hasPhone = contactPhone !== null;

export function telHref(): string | null {
  return contactPhone ? `tel:+${contactPhone}` : null;
}

export function mailtoHref(subject?: string): string {
  return subject
    ? `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}`
    : `mailto:${contactEmail}`;
}

/**
 * A wa.me link with an optional prefilled message.
 *
 * The text is encoded rather than interpolated raw: a name with an ampersand or
 * a `#` in it would otherwise truncate the message at that character, because
 * `?text=` is a query parameter and both terminate one.
 */
export function whatsappHref(message?: string): string | null {
  if (!contactPhone) return null;
  return message
    ? `https://wa.me/${contactPhone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/${contactPhone}`;
}

/** The greeting the invite card sends. Kept here so both paths agree on it. */
export function inviteMessage(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `Hi Shivam I am ${trimmed}` : "Hi Shivam";
}
