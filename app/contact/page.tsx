import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight } from "../../components/icons";
import { ContactForm } from "../../components/contact-form";
import { BrandWatermark } from "../../components/brand-watermark";

const services: [string, string][] = [
  ["Backend & APIs", "High-throughput services, clear API contracts, and reliable integrations."],
  [
    "Distributed systems",
    "Scalable design, queues, caching, observability, and graceful failure paths.",
  ],
  ["AI product systems", "RAG, agent orchestration, evaluation harnesses, and governed delivery."],
];

export const metadata: Metadata = {
  title: "Contact — Shivam Patil",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <BrandWatermark placement="top-right" />
      <section className="contact-hero shell" data-reveal>
        <p className="eyebrow">Contact</p>
        <h1>
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
          <div className="service-list" data-reveal data-reveal-delay="2">
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
        </div>
        <Link href="/reach-out" className="button button-solid" data-magnetic>
          View contact details <ArrowUpRight />
        </Link>
      </section>
    </>
  );
}
