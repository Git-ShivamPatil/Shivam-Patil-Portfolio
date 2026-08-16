/**
 * Referral and social links, transcribed from the source document.
 *
 * Static data in `app/*.ts`, the same shape `app/projects.ts`,
 * `app/skills.ts` and `app/certifications.ts` already use — these are facts
 * about one person, not rows anyone will edit through the admin, so a database
 * table would be a migration and a query for content that changes twice a year.
 *
 * **Only links that exist are here.** The source document also named Jupiter,
 * Binance, Exness, Zerodha, Groww, Navi, INDmoney, Angel One, Upstox and
 * Telegram without supplying a URL for any of them. They were briefly carried
 * as `pending` rows and are now dropped outright: a referral row with no link
 * is a dead end that costs a scroll and pays nothing, and guessing the URL is
 * worse than omitting it — a referral link is a payout identity, so a wrong one
 * either credits a stranger or 404s.
 *
 * `url` is therefore a required string, and every consumer can rely on that
 * rather than branching on null. Re-adding an app is a one-line entry the day
 * its link exists.
 */

export type ReferralCategory = "Payments" | "Credit & loans" | "Money transfer";

export interface Referral {
  name: string;
  category: ReferralCategory;
  url: string;
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
];

/** Only categories that still have rows. "Investing" left with its apps. */
export const referralCategories: ReferralCategory[] = [
  "Payments",
  "Credit & loans",
  "Money transfer",
];

export interface SocialLink {
  name: string;
  url: string;
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
];

export function referralsIn(category: ReferralCategory): Referral[] {
  return referrals.filter((referral) => referral.category === category);
}
