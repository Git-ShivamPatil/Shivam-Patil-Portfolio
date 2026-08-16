import type { Metadata } from "next";
import { LinkQr } from "../../../components/entry/link-qr";
import { InviteCard } from "../../../components/entry/invite-card";
import {
  referralCategories,
  referralsIn,
  socials,
  freelancePlatforms,
  type Referral,
} from "../../referrals";
import "../for.css";

export const metadata: Metadata = {
  title: "For another human being — Shivam Patil",
  description:
    "Referral links worth using, the places I actually post, and an invite. Scan or tap — every link has its own QR.",
  alternates: { canonical: "/for/human" },
};

/**
 * The casual path.
 *
 * Every live link carries a QR beside it, generated on the server at build
 * time. That is not decoration: this page is most useful when it is being read
 * on a laptop by someone who wants the app on their phone, and a code removes
 * the "send yourself the link" step entirely.
 *
 * Entries the source document named without a URL render as a pending row
 * rather than being hidden, because "he uses Zerodha" is still true and worth
 * saying — and inventing a referral link would send a stranger's payout to the
 * wrong account or to a 404.
 */

function ReferralRow({ referral }: { referral: Referral }) {
  return (
    <li className="link-row">
      <div>
        <span className="link-row-name">
          {referral.url ? (
            <a href={referral.url} target="_blank" rel="noreferrer">
              {referral.name} ↗
            </a>
          ) : (
            referral.name
          )}
        </span>
        {referral.offer ? <p className="link-row-offer">{referral.offer}</p> : null}
        {referral.code ? <span className="link-row-code">CODE {referral.code}</span> : null}
        {!referral.url ? (
          <p className="link-row-pending">Referral link not published yet.</p>
        ) : null}
      </div>
      {referral.url ? <LinkQr url={referral.url} label={referral.name} size={84} /> : null}
    </li>
  );
}

export default function HumanPath() {
  return (
    <div className="path-shell">
      <section className="path-hero" data-reveal>
        <p className="eyebrow">
          <span className="live-dot" />
          Good, a person
        </p>
        <h1 data-split>
          Come in, take <em>whatever&apos;s useful.</em>
        </h1>
        <p>
          Apps I actually use, with the referral bonus attached where there is one. Every live link
          has a QR next to it, so if you are reading this on a laptop you can point your phone at it
          and skip the part where you message yourself a link.
        </p>
      </section>

      {referralCategories.map((category) => {
        const rows = referralsIn(category);
        if (rows.length === 0) return null;
        return (
          <section className="path-section" key={category} data-reveal>
            <h2>{category}</h2>
            <ul className="link-stack">
              {rows.map((referral) => (
                <ReferralRow key={referral.name} referral={referral} />
              ))}
            </ul>
          </section>
        );
      })}

      <section className="path-section" data-reveal>
        <h2>Where I actually am</h2>
        <p>
          Different places, genuinely different content. The Instagram one is fitness, not code.
        </p>
        <ul className="link-stack">
          {socials.map((social) => (
            <li className="link-row" key={social.name}>
              <div>
                <span className="link-row-name">
                  {social.url ? (
                    <a href={social.url} target="_blank" rel="noreferrer">
                      {social.name} ↗
                    </a>
                  ) : (
                    social.name
                  )}
                </span>
                {social.handle ? <p className="link-row-offer">{social.handle}</p> : null}
                {social.note ? <p className="link-row-offer">{social.note}</p> : null}
                {!social.url ? <p className="link-row-pending">Handle not published yet.</p> : null}
              </div>
              {social.url ? <LinkQr url={social.url} label={social.name} size={84} /> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="path-section" data-reveal>
        <h2>An invite</h2>
        <InviteCard />
      </section>

      <section className="path-section" data-reveal>
        <h2>Outside the screen</h2>
        <p>
          Lifting and nutrition are the ones I will talk about for too long — I write diet and
          workout plans for people, which is what the Instagram above is for. Otherwise: combat
          sports, travel, and taking apart systems that were not built to be taken apart. I also
          take freelance work on {freelancePlatforms.join(", ")}.
        </p>
      </section>
    </div>
  );
}
