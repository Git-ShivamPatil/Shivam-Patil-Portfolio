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

      {/* The eleven-link row that used to sit here is now a group in the drawer
          (components/nav/nav-drawer.tsx). It was the site's only link source for
          /skills, /experience, /certifications, /achievements and /resume, so it
          was mirrored into the drawer before it was deleted here rather than
          moved — those five routes would otherwise have been orphaned. Nothing
          replaces it: a second link list at the bottom of every page is exactly
          the clutter the drawer exists to absorb. */}
      <div className="shell footer-inner">
        <p>© {new Date().getFullYear()} Shivam Patil. Built with clarity and intent.</p>
      </div>
    </footer>
  );
}
