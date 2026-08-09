import Link from "next/link";
import { NewsletterForm } from "./newsletter-form";
import { PushToggle } from "./push-toggle";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell footer-signup" data-reveal>
        <div>
          <p className="eyebrow">Newsletter</p>
          <h2>
            Occasional notes on
            <br />
            <em>systems that hold up.</em>
          </h2>
          <p className="footer-signup-copy">
            Architecture decisions, failure modes worth knowing about, and the occasional teardown.
            No cadence promises, no tracking pixels, one-click unsubscribe.
          </p>
        </div>
        <div className="footer-signup-actions">
          <NewsletterForm />
          <PushToggle />
        </div>
      </div>

      <div className="shell footer-inner">
        <p>© {new Date().getFullYear()} Shivam Patil. Built with clarity and intent.</p>
        <div className="footer-links">
          {/* Same rule as the header: prefetch off for `ƒ` dynamic routes only.
              The footer is also on every page, so these two were a second
              server render + DB round trip per page load. */}
          <Link href="/services" prefetch={false}>
            Work with me
          </Link>
          <Link href="/stats" prefetch={false}>
            Live stats
          </Link>
          <Link href="/system-design">System design</Link>
          <Link href="/skills">Skills</Link>
          <Link href="/experience">Experience</Link>
          <Link href="/certifications">Certifications</Link>
          <Link href="/achievements">Achievements</Link>
          <Link href="/resume">Résumé</Link>
          <a href="https://github.com/Git-ShivamPatil" target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          <a href="https://www.linkedin.com/in/shivam--patil/" target="_blank" rel="noreferrer">
            LinkedIn ↗
          </a>
          <Link href="/reach-out">Reach out</Link>
        </div>
      </div>
    </footer>
  );
}
