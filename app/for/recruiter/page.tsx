import { pageMetadata } from "../../../lib/seo/metadata";
import Link from "next/link";
import { contactEmail, mailtoHref, telHref, whatsappHref } from "../../../lib/site-contact";
import "../for.css";

export const metadata = pageMetadata({
  title: "For Someone Hiring",
  description:
    "The work, the proof it runs, and three ways to reach Shivam Patil. Everything else on this site is one click away and none of it is on this page.",
  path: "/for/recruiter",
});

/**
 * The recruiter path.
 *
 * Three doors and nothing else, which is the whole design. A hiring reader
 * arrives with one question — can this person do the job — and the fastest
 * honest answer is the work, the evidence, and a way to make contact. The
 * referral links, the hobbies and the manifesto are all one route away on
 * /for/human and /for/theelderbrother; none of them belong in front of someone
 * deciding whether to open a calendar.
 */

const WORK_LINKS = [
  { href: "/projects", label: "Projects" },
  { href: "/achievements", label: "Achievements" },
  { href: "/experience", label: "Experience" },
  { href: "/certifications", label: "Certifications" },
  { href: "/skills", label: "Skills" },
];

/** The four things on this site that are running software rather than a page. */
const SHOWCASE_LINKS = [
  { href: "/terminal", label: "Terminal" },
  { href: "/compute", label: "Compute lab" },
  { href: "/ask", label: "Ask the site" },
  { href: "/data", label: "Data pipeline" },
];

export default function RecruiterPath() {
  const phone = telHref();
  const whatsapp = whatsappHref("Hi Shivam, I came from your portfolio.");

  return (
    <div className="path-shell">
      <section className="path-hero" data-reveal>
        <p className="eyebrow">
          <span className="live-dot" />
          Thanks for actually opening this
        </p>
        <h1 data-split>
          You have ten minutes. <em>Let&apos;s not waste them.</em>
        </h1>
        <p>
          Three doors below: the work itself, the parts of this site that are running software
          rather than describing it, and every way to reach me. I have kept everything else off this
          page on purpose — if you want the rest of me, it is in the menu.
        </p>
      </section>

      <section className="path-section" data-reveal>
        <h2>The work</h2>
        <p>
          Case studies with the architecture decisions and the trade-offs, not just screenshots.
        </p>
        <div className="path-cards">
          <div className="path-card">
            <h3>Projects, experience and proof</h3>
            <p>
              Seven end-to-end systems, the roles behind them, and the credentials — including the
              ones still in progress, marked as such rather than rounded up.
            </p>
            <div className="path-card-links">
              {WORK_LINKS.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="path-section" data-reveal>
        <h2>Things that actually run</h2>
        <p>
          Not a list of technologies. These are live on this domain, and each one is doing the thing
          it claims: a real shell, four compute backends measured in the browser, retrieval that
          refuses to answer what it cannot support, and a working lineage DAG over DuckDB.
        </p>
        <div className="path-cards">
          <div className="path-card">
            <h3>Open one and try to break it</h3>
            <p>
              The system-design page explains how each is built, including the parts that were
              deliberately not built and why.
            </p>
            <div className="path-card-links">
              {SHOWCASE_LINKS.map((link) => (
                <Link key={link.href} href={link.href} prefetch={false}>
                  {link.label}
                </Link>
              ))}
              <Link href="/system-design">How it all works</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="path-section" data-reveal>
        <h2>Reaching me</h2>
        <p>Any of these. The first two are fastest.</p>
        <div className="path-cards">
          <div className="path-card">
            <h3>Direct</h3>
            <p>{contactEmail}</p>
            <div className="path-card-links">
              <a href={mailtoHref("A role worth talking about")}>Email</a>
              {phone ? <a href={phone}>Call</a> : null}
              {whatsapp ? (
                <a href={whatsapp} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              ) : null}
              <Link href="/resume">Résumé</Link>
              <a href="https://www.linkedin.com/in/shivam--patil/" target="_blank" rel="noreferrer">
                LinkedIn ↗
              </a>
              <a href="https://github.com/Git-ShivamPatil" target="_blank" rel="noreferrer">
                GitHub ↗
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
