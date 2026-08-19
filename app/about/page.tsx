import Link from "next/link";
import { pageMetadata } from "../../lib/seo/metadata";
import { ArrowUpRight } from "../../components/icons";
import { AboutPhoto } from "../../components/about-photo";
import { BrandWatermark } from "../../components/brand-watermark";
import { JsonLd } from "../../components/seo/json-ld";
import { breadcrumbJsonLd, profilePageJsonLd } from "../../lib/seo/structured-data";

export const metadata = pageMetadata({
  title: "About",
  description:
    "Software engineer in Mumbai building distributed systems and AI products. Where I came from, how I work, and the three principles I keep returning to.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <>
      {/* ProfilePage is the type Google documents for "a page about one
          person", and it is what makes /about eligible to be treated as the
          authoritative profile rather than as one more page that mentions a
          name. It points at the same Person `@id` the homepage declares. */}
      <JsonLd data={[profilePageJsonLd(), breadcrumbJsonLd([{ name: "About", href: "/about" }])]} />
      <BrandWatermark placement="bottom-right" />
      <section className="about-hero shell">
        <div className="about-hero-copy" data-reveal>
          <p className="eyebrow">About</p>
          <h1 data-split>
            Software engineer,
            <br />
            <em>systems-minded.</em>
          </h1>
          <p>
            I&apos;m Shivam Patil — a software engineer based in Mumbai, India, with 1.5+ years of
            experience designing high-throughput distributed systems and delivering production-grade
            applications, currently working as an SDE at Tata Consultancy Services.
          </p>
        </div>
        <AboutPhoto />
      </section>

      <section className="about-page-story shell">
        <div data-reveal>
          <p className="eyebrow">How I got here</p>
          <p>
            I studied Artificial Intelligence and Data Science at Pune University, and that
            intersection — classical systems engineering meeting modern AI — is still where I do my
            best work. In production, that&apos;s meant building the REST APIs and data pipelines a
            high-traffic system depends on, and separately, tuning the retrieval and evaluation
            layers behind a production RAG chatbot.
          </p>
          <p>
            Outside of work, I build end-to-end systems that force me to reason about the same
            trade-offs at a different scale: a rate limiter that has to stay correct under failure,
            an inference server that has to stay fast under load, an agent runtime that has to stay
            auditable under autonomy.
          </p>
        </div>
        <div data-reveal data-reveal-delay="2">
          <p className="eyebrow">The approach</p>
          <div className="principles">
            <div>
              <span>01</span>
              <strong>Build for the edge cases</strong>
              <p>Graceful failures are part of the product, not an afterthought.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Make it observable</strong>
              <p>If it isn&apos;t measured, it isn&apos;t known.</p>
            </div>
            <div>
              <span>03</span>
              <strong>Keep the interface human</strong>
              <p>Complex systems deserve calm, legible UX.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="about-page-cta shell" data-reveal>
        <h2>
          Curious about the <em>details?</em>
        </h2>
        <div className="about-page-cta-actions">
          <Link href="/resume" className="button button-light" data-magnetic>
            View résumé <ArrowUpRight />
          </Link>
          <Link href="/reach-out" className="button button-outline-light" data-magnetic>
            Reach out <ArrowUpRight />
          </Link>
        </div>
      </section>
    </>
  );
}
