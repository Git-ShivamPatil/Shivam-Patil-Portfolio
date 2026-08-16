/**
 * Referral and social links, transcribed from the source document.
 *
 * Static data in `app/*.ts`, the same shape `app/projects.ts`,
 * `app/skills.ts` and `app/certifications.ts` already use — these are facts
 * about one person, not rows anyone will edit through the admin, so a database
 * table would be a migration and a query for content that changes twice a year.
 *
 * **`pending` is the honest half of this file.** The document lists eighteen
 * apps and six socials but only supplies a URL for eleven of them. The rest are
 * recorded with `url: null` rather than dropped, and rather than guessed at:
 * a referral link is a payout identity, and inventing one either sends a
 * visitor to a stranger's code or to a 404. `certifications.ts` made the same
 * call for the same reason and the note there says so.
 *
 * Anything `pending` renders as a "link coming" state and mints no QR.
 */

export type ReferralCategory = "Payments" | "Credit & loans" | "Investing" | "Money transfer";

export interface Referral {
  name: string;
  category: ReferralCategory;
  /** Null when the source document named the app but gave no link. */
  url: string | null;
  /** The offer, in the words of the referral itself where it had any. */
  offer?: string;
  /** Some programmes pay on a typed code rather than the link alone. */
  code?: string;
}

export const referrals: Referral[] = [
  {
    name: "CRED",
    category: "Payments",
    url: "https://app.cred.club/spQx/b3ydj9kb",
    offer: "₹50 off any bill of ₹100 or more. Sign up within 10 days.",
  },
  {
    name: "Google Pay",
    category: "Payments",
    url: "https://gpay.app.goo.gl/invite-442i72v",
    offer: "₹21 on your first payment, if you are new or have not used it in 180 days.",
  },
  {
    name: "PhonePe",
    category: "Payments",
    url: "https://phon.pe/8bo1ib1h",
    offer: "Link a bank account, set a UPI PIN, done.",
  },
  {
    name: "slice",
    category: "Payments",
    url: "https://slice.bank.in/t?c=VA8h7P7&ic=SHIVA36851",
    offer: "₹500 on your first payment. Up to 3% cashback on scan & pay.",
    code: "SHIVA36851",
  },
  {
    name: "Fibe",
    category: "Credit & loans",
    url: "https://fbe1.in/omHN/aqas5na1",
    offer: "₹300 on your first loan. Up to ₹10 lakhs, one-time approval.",
  },
  {
    name: "KreditBee",
    category: "Credit & loans",
    url: "https://www.kreditbee.in/dl?kb=referrer&id=SHISEBF6J",
    offer: "₹75 in benefits.",
    code: "SHISEBF6J",
  },
  {
    name: "Wise",
    category: "Money transfer",
    url: "https://wise.com/invite/ilpc/shivamp682",
    offer: "Fee-free first transfer on the mid-market rate.",
  },

  // Named in the document, no link supplied. See the `pending` note above.
  { name: "Jupiter", category: "Payments", url: null },
  { name: "Binance", category: "Investing", url: null },
  { name: "Exness", category: "Investing", url: null },
  { name: "Zerodha", category: "Investing", url: null },
  { name: "Groww", category: "Investing", url: null },
  { name: "Navi", category: "Investing", url: null },
  { name: "INDmoney", category: "Investing", url: null },
  { name: "Angel One", category: "Investing", url: null },
  { name: "Upstox", category: "Investing", url: null },
];

export const referralCategories: ReferralCategory[] = [
  "Payments",
  "Credit & loans",
  "Investing",
  "Money transfer",
];

export interface SocialLink {
  name: string;
  url: string | null;
  handle?: string;
  /** Shown on the casual path only when it adds something a label does not. */
  note?: string;
}

export const socials: SocialLink[] = [
  {
    name: "Instagram",
    url: "https://www.instagram.com/shivampatil.999?igsh=MTBqdnRtbzNuZnQwMg%3D%3D&utm_source=qr",
    handle: "@shivampatil.999",
    note: "Nutrition consulting — diet plans, workouts, fitness.",
  },
  { name: "X", url: "https://x.com/shivamp_9?s=11", handle: "@shivamp_9" },
  {
    name: "Reddit",
    url: "https://www.reddit.com/u/give_it_a_shot_/s/utzWowVqlF",
    handle: "u/give_it_a_shot_",
  },
  {
    name: "LinkedIn",
    url: "https://www.linkedin.com/in/shivam--patil/",
    handle: "in/shivam--patil",
  },
  { name: "GitHub", url: "https://github.com/Git-ShivamPatil", handle: "Git-ShivamPatil" },
  // Listed in the document with no handle or invite link.
  { name: "Telegram", url: null },
];

/** Freelance platforms the document names without profile URLs. */
export const freelancePlatforms = ["Upwork", "Fiverr", "Freelancer"] as const;

export function referralsIn(category: ReferralCategory): Referral[] {
  return referrals.filter((referral) => referral.category === category);
}

/** Everything that can actually be linked to, and therefore QR-coded. */
export function liveReferrals(): Referral[] {
  return referrals.filter((referral) => referral.url !== null);
}
