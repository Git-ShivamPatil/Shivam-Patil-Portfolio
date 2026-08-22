import { NewsletterForm } from "../../components/newsletter-form";
import { PushToggle } from "../../components/push-toggle";
import { pageMetadata } from "../../lib/seo/metadata";
import "./newsletter.css";

export const metadata = pageMetadata({
  title: "Newsletter",
  description:
    "Occasional notes on distributed systems and the failure modes worth knowing about. Double opt-in, one-click unsubscribe, no tracking pixels.",
  path: "/newsletter",
});

/**
 * The newsletter, given its own address.
 *
 * ### Why it moved off every page
 *
 * This was a two-column band in the footer, which meant every one of the
 * twenty-eight routes ended with a signup form — including the ones a visitor
 * reaches while doing something else entirely, like reading a case study or
 * running a query against DuckDB. A permanent ask under unrelated content is
 * the definition of noise under this site's brief, and it was the largest
 * single block of it left.
 *
 * ### What it gains by being a page
 *
 * A URL. The form could not be linked to, shared, or landed on before — the
 * only way to reach it was to scroll past whatever you were actually reading.
 * It is now in the sitemap, the palette, the drawer and the route registry
 * like everything else, which means it can be the destination of a link in a
 * talk, a bio, or a reply.
 *
 * **Nothing about the subscription itself changed.** Same component, same
 * double opt-in against /api/newsletter/subscribe, same one-click unsubscribe.
 * `PushToggle` comes with it because the two are the same decision from a
 * visitor's point of view — "tell me when there is something new" — and
 * splitting them across two pages would ask that question twice.
 */
export default function NewsletterPage() {
  return (
    <section className="newsletter-page">
      <div className="shell newsletter-page-inner">
        <p className="eyebrow">Newsletter</p>
        <h1>
          Occasional notes on <em>systems that hold up.</em>
        </h1>
        <p className="newsletter-page-copy">
          Architecture decisions, failure modes worth knowing about, and the occasional teardown. No
          cadence promises, no tracking pixels, one-click unsubscribe.
        </p>

        <div className="newsletter-page-actions">
          <NewsletterForm />
          <PushToggle />
        </div>

        <p className="newsletter-page-note">
          Confirming is a second step: the address you enter gets an email with a link in it, and
          nothing is added to the list until you follow that link. That is what stops someone else
          signing you up for it.
        </p>
      </div>
    </section>
  );
}
