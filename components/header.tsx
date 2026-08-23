import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "./theme-toggle";
import { NavDrawer } from "./nav/nav-drawer";
import { PaletteButton } from "./entry/palette-hint";
import { primaryRoutes } from "../lib/site-routes";

/**
 * The header, reduced to three zones: who, where, and how to get anywhere.
 *
 * ### What left, and where it went instead
 *
 * The bar carried nine controls — hamburger, photo, wordmark, four nav links, a
 * search icon, a theme toggle, a phone icon and a mail icon. Under a brief of
 * "only what is required" that is four separate ways to start a task competing
 * inside 76 pixels, and the two icon groups were the weakest of them:
 *
 * - **The search icon** linked to /search. The palette beside it searches the
 *   same index without a navigation, so the icon was a second door onto one
 *   room. /search is still in the footer, still in the palette, still in the
 *   sitemap — only the duplicate entrance is gone.
 * - **The phone and mail icons** are contact channels, and contact is not a
 *   thing you do from a header on the way somewhere else. Both now live on
 *   /contact, the page whose own description promises "email, phone and the
 *   fastest way to reach" — they went to the footer first, and moved again
 *   when the footer directory was removed. **Neither channel was removed** —
 *   `telHref()` still gates the phone on NEXT_PUBLIC_CONTACT_PHONE exactly as
 *   it did here.
 *
 * ### The nav is centred by grid, not by margins
 *
 * `1fr auto 1fr` puts the links in the middle of the BAR rather than in the
 * middle of the space left over, so the row does not shift sideways when the
 * wordmark's font swaps or a fifth primary route is added. The previous layout
 * used `margin-left: auto` on the nav, which is how it ended up pinned to the
 * actions instead.
 */
export function Header() {
  return (
    <header className="site-header">
      {/* NOT `.shell`. Every other block on the site is held inside a centred
          1180px column, and the header used to be too — which put the wordmark
          50px in from the left edge at 1280px and the actions 50px in from the
          right. A top bar is chrome for the window, not content within it, so
          it runs edge to edge with a small gutter and the two ends sit where a
          browser toolbar's would. */}
      <div className="header-inner">
        <div className="header-lead">
          <Link href="/" className="wordmark" aria-label="Shivam Patil home">
            {/* Rendered at 62px for a 31px slot so it stays sharp on 2x
                displays, and `priority` because it sits in the header on every
                page — left lazy it pops in after first paint on every single
                navigation. alt is empty on purpose: the parent link already
                carries aria-label="Shivam Patil home", so describing the image
                here would make a screen reader announce the same thing twice. */}
            <Image
              src="/logo.jpeg"
              alt=""
              width={62}
              height={62}
              className="wordmark-mark"
              priority
            />
            <span>Shivam Patil</span>
          </Link>
        </div>

        {/* The primary routes, read from the shared registry rather than
            written out here — including their ORDER, which is stated in
            PRIMARY_ORDER rather than inherited from where each entry sits in
            that file. Their
            prefetch flags come from the registry too, so the rule stays in one
            place: ON for the static and ISR routes, which come off the CDN, OFF
            for the server-rendered ones where a prefetch is a real render plus
            Neon queries nobody asked for. */}
        <nav className="header-nav" aria-label="Main navigation">
          {/* data-underline draws a rule out from the left edge of the word on
              hover and retracts it the way it came. It replaces a colour-only
              hover, which announces "this is a link" only after the pointer has
              already found it. See app/motion.css. */}
          {primaryRoutes().map((route) => (
            <Link key={route.href} href={route.href} prefetch={route.prefetch} data-underline>
              {/* `navLabel` where a route sets one — only /system-design does.
                  See the field's note in lib/site-routes.ts for why it is not
                  `technicalLabel`, which would have renamed two other items in
                  this same bar. */}
              {route.navLabel ?? route.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          {/* The hamburger moved from the far left to here, and it had to: the
              wordmark is the leftmost thing in the bar now, and nothing may sit
              between it and the edge. It still ships with the panel it controls
              (components/nav/nav-drawer.tsx) so the open state never crosses a
              component boundary and this file stays a server component — the
              photo above is a `priority` image on every page and should not be
              waiting on a client bundle.

              It stays visible at every width, not just below the nav's
              breakpoint. The drawer is the only place left that lists all
              twenty-nine routes with a sentence each, now that the footer
              directory is gone. */}
          <NavDrawer />
          <ThemeToggle />
          {/* Last, so it is the rightmost control in the bar. */}
          <PaletteButton />
        </div>
      </div>
    </header>
  );
}
