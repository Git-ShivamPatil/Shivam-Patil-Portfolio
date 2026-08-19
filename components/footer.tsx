import Link from "next/link";
import { NewsletterForm } from "./newsletter-form";
import { PushToggle } from "./push-toggle";
import { ROUTE_GROUPS, routesInGroup } from "../lib/site-routes";
import { person } from "../lib/seo/site";
import { mailtoHref } from "../lib/site-contact";

/**
 * The footer, which is now the site's directory.
 *
 * **This reverses an earlier decision, deliberately.** An eleven-link row used
 * to sit here; it was removed when the navigation drawer was built, with the
 * note that "a second link list at the bottom of every page is exactly the
 * clutter the drawer exists to absorb". That argument is sound about *clutter*
 * and wrong about *this site*, for two reasons that were not weighed at the
 * time:
 *
 * 1. **Every link on the site then depended on JavaScript.** The drawer is a
 *    `"use client"` component that portals into `<body>` and renders its links
 *    only after hydration. With the footer row gone, the entire route map — all
 *    twenty-plus pages — was behind a hydration boundary and a click. A crawler
 *    that does not execute the drawer, and a reader on a slow connection before
 *    hydration, both saw a site with exactly one text link in it
 *    (`/system-design`, in the header).
 *
 * 2. **A drawer is a place you have to know to look.** The brief for this pass
 *    was that the site should work for "a four year old and an eighty year
 *    old". A hamburger icon is learned convention, not self-evident; a labelled
 *    list at the bottom of the page is where people have looked for a site
 *    directory for twenty-five years.
 *
 * So the row is back, but not as the row that was deleted. That one was eleven
 * bare labels; this is every public route, grouped, each with a sentence saying
 * what it is. It is a directory rather than a link dump, which is the thing
 * that makes it worth the vertical space.
 *
 * It is a server component and stays one. No JavaScript is involved in
 * rendering any of these links.
 */
export function Footer() {
  const year = new Date().getFullYear();

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

      {/* `aria-label` rather than a visible heading for the whole block: the
          group headings below are the real structure, and a wrapping "Site
          directory" heading would add a level to the outline for no reader
          benefit. */}
      <nav className="footer-directory shell" aria-label="Site directory">
        {ROUTE_GROUPS.filter((group) => group.id !== "elsewhere").map((group) => {
          const routes = routesInGroup(group.id);
          if (routes.length === 0) return null;
          return (
            <div key={group.id} className="footer-directory-group">
              <h2 className="footer-directory-label">{group.label}</h2>
              <ul>
                {routes.map((route) => {
                  // Same name/description split as the drawer: without it the
                  // link's accessible name is the label AND the sentence under
                  // it, so a screen-reader user hears two lines for each of
                  // twenty-six links before reaching the next one. Both ids
                  // point at visible text, so nothing is announced that is not
                  // on screen. `f-` prefixed so they cannot collide with the
                  // drawer's ids, which are built from the same hrefs and are
                  // in the document at the same time.
                  const slug = route.href.replace(/\W+/g, "-");
                  return (
                    <li key={route.href}>
                      <Link
                        href={route.href}
                        prefetch={route.prefetch}
                        aria-labelledby={`f-label-${slug}`}
                        aria-describedby={`f-blurb-${slug}`}
                      >
                        <span className="footer-directory-link-label" id={`f-label-${slug}`}>
                          {route.label}
                        </span>
                        <span className="footer-directory-link-blurb" id={`f-blurb-${slug}`}>
                          {route.blurb}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        <div className="footer-directory-group">
          <h2 className="footer-directory-label">Elsewhere</h2>
          <ul>
            <li>
              {/* Plain anchors, not <Link>: these leave the site, and handing an
                  external URL to the client router asks it to prefetch a route
                  that does not exist. */}
              <a href={person.github} target="_blank" rel="noreferrer noopener">
                <span className="footer-directory-link-label">
                  GitHub <span aria-hidden="true">↗</span>
                </span>
                <span className="footer-directory-link-blurb">The source for all of this.</span>
              </a>
            </li>
            <li>
              <a href={person.linkedin} target="_blank" rel="noreferrer noopener">
                <span className="footer-directory-link-label">
                  LinkedIn <span aria-hidden="true">↗</span>
                </span>
                <span className="footer-directory-link-blurb">The professional version.</span>
              </a>
            </li>
            <li>
              <a href={mailtoHref()}>
                <span className="footer-directory-link-label">Email me</span>
                <span className="footer-directory-link-blurb">{person.email}</span>
              </a>
            </li>
          </ul>
        </div>
      </nav>

      <div className="shell footer-inner">
        <p>
          © {year} {person.name}. Built with clarity and intent.
        </p>
        {/* The sitemap link is for people, not crawlers — crawlers find
            /sitemap.xml from robots.txt. It is here because "show me
            everything" is a real request and this is where people look for it. */}
        <p className="footer-inner-meta">
          <Link href="/search" prefetch={false}>
            Search this site
          </Link>
          <span aria-hidden="true">·</span>
          <a href="/sitemap.xml">Sitemap</a>
        </p>
      </div>
    </footer>
  );
}
