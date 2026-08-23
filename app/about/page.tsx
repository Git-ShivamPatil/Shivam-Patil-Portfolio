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
            I&apos;m Shivam Patil — <strong>SDE at Tata Consultancy Services</strong>, Mumbai.{" "}
            <strong>1.7 years</strong> shipping Python and FastAPI services in production, and
            building low-latency systems in Rust, C++ and Go outside work.
          </p>
        </div>
        <AboutPhoto />
      </section>

      <section className="about-page-story shell">
        <div data-reveal>
          <p className="eyebrow">How I got here</p>
          <p>
            <strong>B.Tech in Artificial Intelligence and Data Science</strong>, Pune University. In
            production that has meant two things: the <strong>REST APIs and data pipelines</strong>{" "}
            under a high-traffic system, and the <strong>retrieval and evaluation layers</strong>{" "}
            behind a production RAG chatbot.
          </p>
          <p>
            Outside work I chase the same trade-offs at a different scale — a rate limiter that
            stays <strong>correct under failure</strong>, an inference server that stays{" "}
            <strong>fast under load</strong>, an agent runtime that stays{" "}
            <strong>auditable under autonomy</strong>.
          </p>
        </div>
        <div data-reveal data-reveal-delay="2">
          <p className="eyebrow">The approach</p>
          <div className="principles">
            <div>
              <span>01</span>
              <strong>Failure modes are features</strong>
              <p>The degradation path ships with the happy path, not after it.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Measure before claiming</strong>
              <p>Unmeasured is unknown. Every number on this site has a source.</p>
            </div>
            <div>
              <span>03</span>
              <strong>Legible under load</strong>
              <p>A system nobody can read is a system nobody can operate.</p>
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
