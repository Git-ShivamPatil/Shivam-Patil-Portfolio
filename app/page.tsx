import Link from "next/link";
import { ArrowUpRight } from "../components/icons";
import { AnimatedMetric } from "../components/animated-metric";
import { ProjectFilter } from "../components/project-filter";
import { getProjects } from "./projects";
import { getSkillNames } from "./skills";

const personJsonLd = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: "Shivam Patil",
  jobTitle: "Software Development Engineer",
  url: "https://shivamsfolio.com",
  sameAs: ["https://www.linkedin.com/in/shivam--patil/", "https://github.com/Git-ShivamPatil"],
  worksFor: {
    "@type": "Organization",
    name: "Tata Consultancy Services",
  },
};

export default async function Home() {
  const [projects, skills] = await Promise.all([getProjects(), getSkillNames()]);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />
      <section className="hero shell">
        <div className="hero-copy reveal">
          <p className="eyebrow">
            <span className="live-dot" />
            Available for impactful engineering work
          </p>
          <h1>
            Build systems
            <br />
            that <em>hold up.</em>
          </h1>
          <p className="hero-intro">
            I&apos;m Shivam Patil — a software engineer focused on high-throughput backend
            platforms, distributed systems, and thoughtful AI products.
          </p>
          <div className="hero-actions">
            <Link href="/#work" className="button button-solid" data-magnetic>
              Explore my work <ArrowUpRight />
            </Link>
            <Link href="/reach-out" className="button button-text" data-magnetic>
              Start a conversation <span>→</span>
            </Link>
          </div>
        </div>
        <div
          className="hero-visual reveal reveal-delay"
          aria-label="An abstract diagram representing a resilient distributed system"
        >
          <div className="orbital-field">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="center-core">
              <span>SP</span>
              <i />
            </div>
            <div className="signal-node node-one">
              <i />
              API
            </div>
            <div className="signal-node node-two">
              <i />
              AI
            </div>
            <div className="signal-node node-three">
              <i />
              SYS
            </div>
            <span className="star star-one" />
            <span className="star star-two" />
            <span className="star star-three" />
            <span className="star star-four" />
          </div>
          <div className="visual-caption">
            <span>01 / {String(projects.length).padStart(2, "0")}</span>
            <span>reliable by design</span>
          </div>
        </div>
      </section>

      <section className="proof-strip" data-reveal>
        <div className="shell proof-grid">
          <p>
            Engineering with
            <br />
            <strong>signal, not noise.</strong>
          </p>
          <div>
            <strong>
              <AnimatedMetric value="45K" />
            </strong>
            <span>requests / second</span>
          </div>
          <div>
            <strong>
              <AnimatedMetric value="8ms" />
            </strong>
            <span>p99 latency</span>
          </div>
          <div>
            <strong>
              <AnimatedMetric value="87%" />
            </strong>
            <span>agent task success</span>
          </div>
        </div>
      </section>

      <section id="work" className="section shell work-section">
        <div className="section-heading reveal">
          <p className="eyebrow">
            Selected projects <span>{String(projects.length).padStart(2, "0")}</span>
          </p>
          <h2>
            Technical work,
            <br />
            <em>made tangible.</em>
          </h2>
          <p>
            End-to-end system designs — from architecture and implementation decisions to commands
            for getting each project running.
          </p>
        </div>
        <ProjectFilter projects={projects} />
      </section>

      <section id="about" className="section shell about-section">
        <div className="about-statement reveal">
          <p className="eyebrow">The approach</p>
          <h2>
            I like the kind of
            <br />
            problems that get <em>clearer</em>
            <br />
            as you go deeper.
          </h2>
        </div>
        <div className="about-details" data-reveal data-reveal-delay="2">
          <p>
            At the intersection of systems engineering and AI, I work from the fundamentals: a
            useful contract, a dependable path through failure, and enough observability to tell
            what&apos;s real.
          </p>
          <div className="principles">
            <div>
              <span>01</span>
              <strong>Build for the edge cases</strong>
              <p>Graceful failures are part of the product.</p>
            </div>
            <div>
              <span>02</span>
              <strong>Make it observable</strong>
              <p>Measure the behaviour that matters.</p>
            </div>
            <div>
              <span>03</span>
              <strong>Keep the interface human</strong>
              <p>Complex systems deserve calm UX.</p>
            </div>
          </div>
          <Link href="/about" className="button button-text" data-magnetic>
            Read the full story <span>→</span>
          </Link>
        </div>
      </section>

      <section className="capabilities" data-reveal>
        <div className="shell capabilities-inner">
          <p className="eyebrow">Working set</p>
          <div className="skill-marquee" aria-label="Technical skills">
            {[...skills, ...skills].map((skill, index) => (
              <span key={`${skill}-${index}`}>
                {skill}
                <i>✦</i>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="contact-banner shell" data-reveal>
        <div className="contact-banner-grid">
          <div>
            <p className="eyebrow">Let&apos;s build</p>
            <h2>
              Have a system
              <br />
              worth <em>solving?</em>
            </h2>
          </div>
          <div className="contact-banner-copy">
            <p>
              I&apos;m open to software engineering roles and collaborations where sound engineering
              makes a measurable difference.
            </p>
            <Link href="/reach-out" className="button button-light" data-magnetic>
              Reach out <ArrowUpRight />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
