import { pageMetadata } from "../../lib/seo/metadata";
import { ArrowUpRight } from "../../components/icons";
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
  /** Present only for channels worth copying (email, phone numbers). */
  copyValue?: string;
}

const contactChannels: ContactChannel[] = [
  {
    label: "Email",
    value: "shivampatilinfo@gmail.com",
    href: "mailto:shivampatilinfo@gmail.com",
    note: "Best for roles & collaborations",
    copyValue: "shivampatilinfo@gmail.com",
  },
  {
    label: "LinkedIn",
    value: "linkedin.com/in/shivam--patil",
    href: "https://www.linkedin.com/in/shivam--patil/",
    note: "Professional network",
  },
  {
    label: "WhatsApp",
    value: "+91 70385 73273",
    href: "https://wa.me/917038573273",
    note: "Quick message",
    copyValue: "+91 70385 73273",
  },
  {
    label: "Phone",
    value: "+91 70385 73273",
    href: "tel:+917038573273",
    note: "Mumbai, India · IST",
    copyValue: "+91 70385 73273",
  },
  {
    label: "GitHub",
    value: "github.com/Git-ShivamPatil",
    href: "https://github.com/Git-ShivamPatil",
    note: "Code and experiments",
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
          Whether it&apos;s a role, a technical conversation, or an idea worth prototyping —
          I&apos;d be glad to hear from you.
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
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
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
            I work IST hours and overlap comfortably with Europe most of the day, and with US East
            for a few hours each evening.
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
          data-analytics-id="resume-reach-out"
          data-analytics-id-label="Résumé — from /reach-out"
        >
          View latest résumé <ArrowUpRight />
        </a>
      </div>
    </section>
  );
}
