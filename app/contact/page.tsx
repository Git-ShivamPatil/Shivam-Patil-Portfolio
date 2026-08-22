import Link from "next/link";
import { pageMetadata } from "../../lib/seo/metadata";
import { ArrowUpRight } from "../../components/icons";
import { ContactForm } from "../../components/contact-form";
import { BrandWatermark } from "../../components/brand-watermark";
import { contactEmail, mailtoHref, telHref } from "../../lib/site-contact";

const services: [string, string][] = [
  ["Backend & APIs", "High-throughput services, clear API contracts, and reliable integrations."],
  [
    "Distributed systems",
    "Scalable design, queues, caching, observability, and graceful failure paths.",
  ],
  ["AI product systems", "RAG, agent orchestration, evaluation harnesses, and governed delivery."],
];

export const metadata = pageMetadata({
  title: "Contact",
  description:
    "Email, phone and the fastest way to reach a software engineer in Mumbai working on distributed systems, backend platforms and AI products.",
  path: "/contact",
});

export default function ContactPage() {
  const phone = telHref();

  return (
    <>
      <BrandWatermark placement="top-right" />
      <section className="contact-hero shell" data-reveal>
        <p className="eyebrow">Contact</p>
        <h1 data-split>
          Let&apos;s make the
          <br />
          hard part <em>work.</em>
        </h1>
        <p>
          I&apos;m interested in engineering roles and conversations about distributed platforms,
          production AI, or a system that needs to become more reliable.
        </p>
        <Link href="mailto:shivampatilinfo@gmail.com" className="email-display">
          shivampatilinfo@gmail.com <ArrowUpRight />
        </Link>
      </section>
      <section className="contact-body shell">
        <div className="contact-callout">
          <span className="live-dot" />
          <p>Currently open to opportunities</p>
        </div>
        <div className="contact-grid-large">
          <div data-reveal>
            <p className="eyebrow">Where I help</p>
            <h2>
              Engineering that
              <br />
              keeps its <em>promise.</em>
            </h2>
          </div>
          <div className="service-list" data-reveal data-reveal-delay="2" data-stagger>
            {services.map(([title, description], index) => (
              <article key={title}>
                <span>0{index + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="contact-form-section shell">
        <div className="contact-callout">
          <p className="eyebrow">Or send a message directly</p>
        </div>
        <ContactForm />
      </section>
      <section className="contact-quick shell" data-reveal>
        <div>
          <p className="eyebrow">Prefer another channel?</p>
          <h2>
            All the ways
            <br />
            to reach me.
          </h2>
          {/* The phone lives here now.
              It used to be an unlabelled icon in the header, then a "Call me"
              entry in the footer directory, and both are gone — the header was
              trimmed to three zones and the directory was removed at the
              owner's request. That left this page's own description promising
              "Email, phone and the fastest way to reach..." while the page
              rendered no phone number at all, which is the kind of quiet lie a
              redesign leaves behind.

              `telHref()` gates it on NEXT_PUBLIC_CONTACT_PHONE exactly as it
              always has: a `tel:` built from a placeholder is worse than an
              absent link, because it looks live, it is tappable, and it fails
              in the visitor's dialler rather than on the page. */}
          <ul className="contact-quick-channels">
            <li>
              <a href={mailtoHref()}>{contactEmail}</a>
            </li>
            {phone ? (
              <li>
                <a href={phone}>{phone.replace("tel:", "")}</a>
              </li>
            ) : null}
          </ul>
        </div>
        <Link href="/reach-out" className="button button-solid" data-magnetic>
          Send a message instead <ArrowUpRight />
        </Link>
      </section>
    </>
  );
}
