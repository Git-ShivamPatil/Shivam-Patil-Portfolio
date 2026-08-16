/**
 * The two direct-contact channels the header exposes, and the WhatsApp deep
 * link the casual path builds on.
 *
 * **The phone-dependent controls still degrade rather than break.** If the
 * number is ever blanked — an override set to an empty string, a bad edit —
 * `contactPhone` becomes null and the header's phone button, the WhatsApp
 * links and the invite card stop rendering instead of shipping a dead href. A
 * `tel:` built from a placeholder is worse than no button at all: it looks
 * live, it is tappable, and it fails in the visitor's dialler rather than on
 * the page. Every other integration here degrades by design when its
 * credential is absent (HANDOFF §31); this follows that rule.
 *
 * `NEXT_PUBLIC_CONTACT_PHONE` overrides the default. It is `NEXT_PUBLIC_`
 * because the value has to reach an `href` the browser renders, so it is
 * public by definition.
 *
 * Format it in full international form with no spaces or punctuation, e.g.
 * `919876543210`. `tel:` tolerates most things; `wa.me` does not — it wants
 * digits and a country code and silently 404s on anything else, which is why
 * everything below is stripped to digits before use.
 */

/**
 * The number, with an environment override.
 *
 * It is a literal rather than env-only because the earlier privacy argument
 * does not survive contact with what this value is *for*: it renders into a
 * `tel:` and a `wa.me` href on a public page, so it is published to every
 * visitor and every scraper the moment the page ships. Keeping it out of the
 * repository would protect nothing while leaving production dependent on a
 * dashboard setting that is invisible from the code and easy to lose in a
 * project migration.
 *
 * The env var still wins when set, so a fork, a preview deployment or a local
 * checkout can point the buttons somewhere else without touching this file.
 */
const DEFAULT_PHONE = "917038573273";

/** Digits only, country code included. Empty string when unset. */
const rawPhone = (process.env.NEXT_PUBLIC_CONTACT_PHONE || DEFAULT_PHONE).replace(/[^\d]/g, "");

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
