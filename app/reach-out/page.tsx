import { pageMetadata } from "../../lib/seo/metadata";
import { ArrowUpRight } from "../../components/icons";
import type { BrandIconName } from "../../components/icons";
import { IconReveal } from "../../components/icon-reveal";
import { CopyButton } from "../../components/copy-button";
import { LocationMap } from "../../components/location-map";
import { downloadHref } from "../../lib/analytics/downloads";

export const metadata = pageMetadata({
  title: "Reach Out",
  description:
    "Send Shivam Patil a message about a software engineering role, a system worth solving, or a collaboration. It reaches him directly, not a queue.",
  path: "/reach-out",
});

interface ContactChannel {
  label: string;
  value: string;
  href: string;
  note: string;
  /**
   * The brand mark the row's ordinal reveals on hover. Five rows that all
   * looked alike now identify themselves before the label is read — see the
   * ordinal slot in the markup below and `.icon-reveal` in app/motion.css.
   */
  icon: BrandIconName;
  /** Present only for channels worth copying (email, phone numbers). */
  copyValue?: string;
}

/**
 * Ordered by how fast a reply comes back, not by how important the channel
 * sounds. A contact list sorted by the owner's preference makes the reader
 * guess; sorted by latency it answers the only question they have.
 */
const contactChannels: ContactChannel[] = [
  {
    label: "Email",
    value: "shivampatilinfo@gmail.com",
    href: "mailto:shivampatilinfo@gmail.com",
    note: "Roles, contracts, long questions",
    icon: "mail",
    copyValue: "shivampatilinfo@gmail.com",
  },
  {
    label: "LinkedIn",
    value: "linkedin.com/in/shivam--patil",
    href: "https://www.linkedin.com/in/shivam--patil/",
    note: "Recruiters, referrals, InMail",
    icon: "linkedin",
  },
  {
    label: "WhatsApp",
    value: "+91 70385 73273",
    href: "https://wa.me/917038573273",
    note: "Short questions, fastest reply",
    icon: "whatsapp",
    copyValue: "+91 70385 73273",
  },
  {
    label: "Phone",
    value: "+91 70385 73273",
    href: "tel:+917038573273",
    note: "IST, 10:00-20:00",
    icon: "phone",
    copyValue: "+91 70385 73273",
  },
  {
    label: "GitHub",
    value: "github.com/Git-ShivamPatil",
    href: "https://github.com/Git-ShivamPatil",
    note: "Source, issues, PRs",
    icon: "github",
  },
];

export default function ReachOutPage() {
  return (
    <section className="reach-page shell">
      <div className="reach-intro" data-reveal>
        <p className="eyebrow">Reach out</p>
        <h1 data-split>
          Find the
          <br />
          <em>right channel.</em>
        </h1>
        <p>
          Five channels, <strong>ordered by how fast I answer</strong>. Every one{" "}
          <strong>reaches me directly</strong> — no queue, no assistant, no form that goes nowhere.
        </p>
      </div>
      <div className="channel-list" data-stagger>
        {contactChannels.map((channel, index) => (
          <div key={channel.label} className="channel-row">
            <a
              href={channel.href}
              target={channel.href.startsWith("http") ? "_blank" : undefined}
              rel={channel.href.startsWith("http") ? "noreferrer" : undefined}
              className="channel-row-link"
              data-nudge
            >
              {/* The ordinal is the reveal slot.
                  It is the right place for it rather than the <small> label
                  beside it, for two reasons: the label renders at 9px, where a
                  brand mark is a smudge, and the ordinal is the one string in
                  the row that carries no information the reader needs — it
                  numbers five items they can already count. Trading it for the
                  mark that identifies the channel is a strict gain, and the
                  58px column it sits in is already reserved, so nothing moves.

                  It stays in the DOM (translated, not removed), so the row's
                  accessible name is unchanged. */}
              <span>
                <IconReveal label={String(index + 1).padStart(2, "0")} icon={channel.icon} />
              </span>
              <div>
                <small>{channel.label}</small>
                <strong>{channel.value}</strong>
              </div>
              <p>{channel.note}</p>
            </a>
            <div className="channel-row-actions">
              {channel.copyValue ? (
                <CopyButton value={channel.copyValue} label={`Copy ${channel.label}`} />
              ) : null}
              <a
                href={channel.href}
                target={channel.href.startsWith("http") ? "_blank" : undefined}
                rel={channel.href.startsWith("http") ? "noreferrer" : undefined}
                aria-label={`Open ${channel.label}`}
                className="channel-row-arrow"
              >
                <ArrowUpRight />
              </a>
            </div>
          </div>
        ))}
      </div>
      <div className="reach-map" data-reveal>
        <div className="reach-map-copy">
          <p className="eyebrow">Where I work from</p>
          <h2>
            Mumbai —
            <br />
            <em>remote-friendly.</em>
          </h2>
          <p>
            <strong>IST, UTC+5:30.</strong> Full working overlap with Europe; evening overlap with
            US East.
          </p>
        </div>
        <LocationMap />
      </div>

      <div className="resume-download" data-reveal>
        <div>
          <p className="eyebrow">Résumé</p>
          <h2>
            A closer look
            <br />
            at the <em>details.</em>
          </h2>
        </div>
        <a
          href={downloadHref("resume")}
          target="_blank"
          className="button button-solid"
          data-magnetic
          data-lift
          data-analytics-id="resume-reach-out"
          data-analytics-id-label="Résumé — from /reach-out"
        >
          View latest résumé <ArrowUpRight />
        </a>
      </div>
    </section>
  );
}
