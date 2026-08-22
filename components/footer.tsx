import { person } from "../lib/seo/site";
import { mailtoHref } from "../lib/site-contact";

/**
 * The footer, reduced to one row of links.
 *
 * ### This reverses a reversal, and the reasoning is worth keeping
 *
 * Three things used to live here: a newsletter signup band, the site's full
 * route directory, and a copyright line. All three are gone.
 *
 * The directory is the interesting one, because it was **deliberately
 * reinstated** at one point after being deleted. The argument then was that
 * every link on the site otherwise depended on JavaScript — the nav drawer is
 * a client component that portals into `<body>` and renders nothing on the
 * server — so with no directory here, a crawler saw a site with almost no text
 * links in it, and §55a recorded twenty of thirty-three URLs never being
 * crawled as a result.
 *
 * **That cost has been re-accepted with eyes open.** It was put to the owner
 * with the §55a history attached and the answer was to remove it anyway. Every
 * route is still in `sitemap.xml` (declared from robots.txt), still in
 * `/llms.txt`, still in the command palette, and still in the drawer; what is
 * given up is the inbound-link signal, not reachability. If organic traffic to
 * the long-tail pages drops, this is the first place to look, and restoring it
 * is re-rendering `ROUTE_GROUPS` here.
 *
 * The newsletter moved to `/newsletter` — a form under every case study and
 * every lab was the largest remaining block of noise on the site, and it now
 * has an address it can be linked to. Nothing about the subscription changed.
 *
 * Still a server component. No JavaScript renders any of these links.
 */
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        {/* Plain anchors for everything that leaves the site: handing an
            external URL to the client router asks it to prefetch a route that
            does not exist. `me` on each profile is the microformats relation
            for "another profile of the same person" — the same claim the
            Person JSON-LD makes with `sameAs`, in the form that reads without
            parsing a script tag. */}
        <nav className="footer-inner-meta" aria-label="Elsewhere">
          <a href={mailtoHref()}>email</a>
          <a href={person.twitter} rel="me noreferrer noopener" target="_blank">
            twitter
          </a>
          <a href={person.github} rel="me noreferrer noopener" target="_blank">
            github
          </a>
          <a href={person.linkedin} rel="me noreferrer noopener" target="_blank">
            linkedin
          </a>
          <a href={person.instagram} rel="me noreferrer noopener" target="_blank">
            instagram
          </a>
        </nav>
      </div>
    </footer>
  );
}
