import Link from "next/link";
import { ArrowUpRight } from "../components/icons";
import { AnimatedMetric } from "../components/animated-metric";
import { AudiencePicker } from "../components/entry/audience-picker";
import { JsonLd } from "../components/seo/json-ld";
import { getProjects } from "./projects";
import { pageMetadata } from "../lib/seo/metadata";
import { personJsonLd, webSiteJsonLd, itemListJsonLd } from "../lib/seo/structured-data";
import { ROUTE_GROUPS, routesInGroup, SITE_ROUTES } from "../lib/site-routes";

/**
 * The homepage had **no `metadata` export at all**, so it inherited the root
 * layout's. That cost it three things:
 *
 * - **No canonical.** The page competed in search with its own `?ref=` and
 *   `?utm_` variants — and P10's referral system generates exactly those, so
 *   this was not hypothetical.
 * - **A description that described the site, not the page**, and that the same
 *   thirty other routes were also using.
 * - **No mention of a single language.** "C++", "Rust" and "Golang" appeared
 *   nowhere in the rendered homepage, in the title, or in the description.
 */
export const metadata = pageMetadata({
  // **This title carries the name itself, and it has to.** `title.template` in
  // the root layout appends " — Shivam Patil" to child segments, but Next.js
  // does not apply a template to the segment that defines it — and app/page.tsx
  // is that segment. Verified in the build output: every other route rendered
  // "… — Shivam Patil" while the homepage rendered its bare string.
  //
  // So the one page that most needs the name in its title is the one page the
  // template cannot give it to. Written out in full here, name first, because
  // the homepage is what ranks for the name.
  title: "Shivam Patil — Software Engineer | C++, Rust, Go & AI",
  description:
    "Software engineer building high-throughput backend platforms and distributed systems in C++, Rust, Go and Python. Six case studies, with the reasoning.",
  path: "/",
});

/**
 * The hub grid, now generated from the route registry.
 *
 * It used to be a hand-written array of eight cards. That array was one of three
 * copies of the site's route map — the drawer had nineteen links, the sitemap
 * had seventeen paths, and this had eight — and the three had drifted far enough
 * apart that ten indexable pages appeared in the drawer and in neither of the
 * others. Reading from `lib/site-routes.ts` means the homepage map, the drawer,
 * the footer directory and the sitemap cannot disagree again.
 *
 * The other change is that it is **grouped** rather than flat. Eight unlabelled
 * peers asked the visitor to work out which of them they wanted; five headed
 * groups tell them. "See it running" in particular needed the heading, because
 * the ten pages under it — a terminal, a WASM benchmark, an in-browser database,
 * a chaos lab — have nothing in common except that they are all live and all
 * clickable, which is precisely what the heading now says.
 */
export const revalidate = 300;

export default async function Home() {
  const projects = await getProjects();

  return (
    <>
      {/* Person and WebSite are emitted here rather than in the root layout on
          purpose: the homepage is the canonical URL for both `@id`s, and every
          other page's JSON-LD refers back to them by id rather than restating
          them. See lib/seo/structured-data.ts. */}
      <JsonLd
        data={[
          personJsonLd(),
          webSiteJsonLd(),
          itemListJsonLd(
            "Sections of shivamsfolio.com",
            SITE_ROUTES.filter((route) => route.href !== "/").map((route) => ({
              name: route.label,
              href: route.href,
              description: route.blurb,
            })),
          ),
        ]}
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
          {/* The languages are named here, in prose, and that is a deliberate
              SEO change rather than keyword stuffing.

              Before this, the strings "C++", "Rust" and "Golang" appeared in
              exactly one place in the entire rendered site: the skill chips on
              /skills, which come out of the database. The homepage — the page
              every other one links back to, and the one that ranks for the
              name — did not contain them at all. A search engine cannot
              associate a person with a language the person's own front page
              never mentions. */}
          <p className="hero-intro">
            I&apos;m Shivam Patil — a software engineer working in <strong>C++</strong>,{" "}
            <strong>Rust</strong>, <strong>Go</strong> and <strong>Python</strong> on
            high-throughput backend platforms, distributed systems, and AI products that have to
            survive real traffic.
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

      {/* The map.

          Rendered as five headed groups rather than one flat grid of eight. The
          headings are the whole point: a visitor who wants to know what was
          built and a visitor who wants to poke at something live are looking for
          different things, and an ungrouped card wall made them read all eight
          to find out which was which. */}
      <section className="section shell" data-reveal>
        <div className="section-heading">
          <p className="eyebrow">The map</p>
          <h2>
            Everything here, <em>sorted.</em>
          </h2>
          <p>
            Every card is a real page with one job. Nothing on this list is a section of this page.
          </p>
        </div>

        {ROUTE_GROUPS.filter((group) => group.id !== "elsewhere").map((group) => {
          const routes = routesInGroup(group.id).filter((route) => route.href !== "/");
          if (routes.length === 0) return null;
          return (
            <div className="hub-section" key={group.id}>
              <div className="hub-section-head">
                <h3>{group.label}</h3>
                <p>{group.blurb}</p>
              </div>
              <div className="hub-grid" data-stagger>
                {routes.map((route) => (
                  <Link
                    key={route.href}
                    href={route.href}
                    className="hub-card"
                    prefetch={route.prefetch}
                  >
                    <span className="hub-card-label">{route.label}</span>
                    <span className="hub-card-copy">{route.blurb}</span>
                    {route.technicalLabel ? (
                      <span className="hub-card-note">{route.technicalLabel}</span>
                    ) : null}
                    <ArrowUpRight />
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <AudiencePicker />

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
