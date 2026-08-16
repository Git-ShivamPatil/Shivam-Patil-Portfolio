import Link from "next/link";
import { ArrowUpRight } from "../components/icons";
import { AnimatedMetric } from "../components/animated-metric";
import { getProjects } from "./projects";
import { jsonForScript } from "../lib/security/escape";

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

/**
 * The hub grid.
 *
 * This replaced three sections that each duplicated a page that already
 * existed and did the job better: the project list (now /projects, which owns
 * the filter), the about statement (whose three principles were
 * character-for-character the ones on /about), and the skills marquee (a flat
 * name list, where /skills groups the same data and adds the server-rendered
 * graph). The homepage was carrying weaker copies of half the site, which is
 * why most visitors never left it.
 *
 * Every href here is a route that exists and is rendered by its own page —
 * nothing in this grid is an anchor into this page.
 *
 * `prefetch: false` marks the same routes the nav marks — /services, /stats
 * and /ask (plus /search, which is not in this grid). The first two are
 * server-rendered per request, so a prefetch on hover is a real render nobody
 * asked for; the measured cost of leaving it on is recorded in the nav's own
 * prefetch comment.
 */
const HUB: { href: string; label: string; copy: string; note: string; prefetch?: false }[] = [
  {
    href: "/projects",
    label: "Projects",
    copy: "End-to-end builds, each with the architecture behind it, the trade-offs it forced, and the commands to run it.",
    note: "Case studies",
  },
  {
    href: "/system-design",
    label: "System design",
    copy: "How this site actually works: the request path, the data model, and the decisions worth defending.",
    note: "Raft election, running live",
  },
  {
    href: "/stats",
    label: "Live stats",
    copy: "GitHub and LeetCode pulled from their public APIs, cached with a stale-on-error fallback.",
    note: "Updates itself",
    prefetch: false,
  },
  {
    href: "/about",
    label: "About",
    copy: "Where I came from, what I work on now, and the three principles I keep coming back to.",
    note: "The longer version",
  },
  {
    href: "/skills",
    label: "Skills",
    copy: "The tools I reach for, grouped — plus a graph of which project actually evidences which skill.",
    note: "Laid out on the server",
  },
  {
    href: "/services",
    label: "Work with me",
    copy: "Paid, focused sessions on throughput ceilings, failure modes, and the architecture underneath them.",
    note: "Book a slot",
    prefetch: false,
  },
  {
    href: "/blog",
    label: "Blog",
    copy: "Write-ups on distributed systems, AI products, and the reasoning behind the decisions.",
    note: "Notes from the build",
  },
  {
    href: "/ask",
    label: "Ask",
    copy: "Hybrid retrieval over everything published here, answered by quoting the site back to you, with sources.",
    note: "Optional model runs on your machine",
    prefetch: false,
  },
];

// The project list moved to /projects, but the hero caption still counts it,
// and that count is read from the database behind a fallback. A build that
// cannot reach the database prerenders `01 / 00`, so the page must be able to
// re-render rather than being frozen as static output — the same window
// /projects carries for the same reason.
export const revalidate = 300;

export default async function Home() {
  // The count is all the homepage takes from the database now. It goes through
  // getProjects() rather than a bare count query because that is the read with
  // the fallback on it; a database blip degrades the caption, not the page.
  const projects = await getProjects();
  return (
    <>
      {/* P13: serialised through jsonForScript rather than JSON.stringify. A
          JSON string containing "</script" ends the element as far as the HTML
          parser is concerned, whatever the JSON says. The input here is static
          today — but that is a property of today's data, not of the code. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonForScript(personJsonLd) }}
      />
      <section className="hero shell">
        <div className="hero-copy reveal">
          <p className="eyebrow">
            <span className="live-dot" />
            Available for impactful engineering work
          </p>
          {/* No <br /> in here on purpose. A hard break pins the wrap to one
              place at every viewport width, so the heading broke identically
              on a 1440px desktop and a 380px phone and the type could never
              be sized to the line. It reflows now. The <em> stays because the
              Playfair italic is the design signature, and data-split stays
              because SplitText walks text nodes and the e2e suite asserts the
              attribute resolves. */}
          <h1 data-split>
            Build systems that <em>hold up.</em>
          </h1>
          <p className="hero-intro">
            I&apos;m Shivam Patil — a software engineer focused on high-throughput backend
            platforms, distributed systems, and thoughtful AI products.
          </p>
          <div className="hero-actions">
            <Link href="/projects" className="button button-solid" data-magnetic>
              Explore my work <ArrowUpRight />
            </Link>
            <Link href="/reach-out" className="button button-text" data-magnetic>
              Start a conversation <span>→</span>
            </Link>
          </div>
        </div>
        <div
          className="hero-visual reveal reveal-delay"
          data-parallax-pointer="1.6"
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
        <div className="shell proof-grid" data-stagger>
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

      <section className="section shell" data-reveal>
        <div className="section-heading">
          <p className="eyebrow">The map</p>
          <h2>
            Everything else, <em>one click away.</em>
          </h2>
          <p>
            Each card is a page in its own right. This one points at them rather than absorbing
            them.
          </p>
        </div>
        <div className="hub-grid" data-stagger>
          {HUB.map((item) => (
            <Link key={item.href} href={item.href} className="hub-card" prefetch={item.prefetch}>
              <span className="hub-card-label">{item.label}</span>
              <span className="hub-card-copy">{item.copy}</span>
              <span className="hub-card-note">{item.note}</span>
              <ArrowUpRight />
            </Link>
          ))}
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
