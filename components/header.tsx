import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "./theme-toggle";
import { NavDrawer } from "./nav/nav-drawer";
import { SearchIcon, PhoneIcon, MailIcon } from "./icons";
import { mailtoHref, telHref } from "../lib/site-contact";
import { primaryRoutes } from "../lib/site-routes";

export function Header() {
  const phoneHref = telHref();
  return (
    <header className="site-header">
      <div className="shell header-inner">
        {/* First child, so the hamburger sits at the shell's left edge. It ships
            with the panel it controls (components/nav/nav-drawer.tsx) so the
            open state never crosses a component boundary and this file can stay
            a server component — the photo below is a `priority` image on every
            page, and it should not be waiting on a client bundle. */}
        <NavDrawer />
        <Link href="/" className="wordmark" aria-label="Shivam Patil home">
          {/* Was a circle containing the letters "SP". Now the actual photo.
              Rendered at 62px for a 31px slot so it stays sharp on 2x displays,
              and `priority` because it sits in the header on every page — left
              lazy it pops in after first paint on every single navigation.
              alt is empty on purpose: the parent link already carries
              aria-label="Shivam Patil home", so describing the image here would
              make a screen reader announce the same thing twice. */}
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
        {/* The four routes a first-time visitor is most likely to want, read
            from the shared registry rather than written out here.

            It carried exactly ONE link before this — "System design" — with
            everything else behind the hamburger. That is a defensible bar for a
            site whose visitors already know their way around, and the wrong one
            for a portfolio: the two questions a stranger arrives with are "what
            has he built" and "what does he know", and neither had a link on
            screen. `primaryRoutes()` answers both, plus About and a way to make
            contact.

            Their prefetch flags come from the registry too, so the rule stays
            in one place: ON for the static and ISR routes, which come off the
            CDN, OFF for the server-rendered ones where a prefetch is a real
            render plus Neon queries nobody asked for. /search keeps
            prefetch={false} below for that reason — 384ms measured. */}
        <nav className="header-nav" aria-label="Main navigation">
          {primaryRoutes().map((route) => (
            <Link key={route.href} href={route.href} prefetch={route.prefetch}>
              {route.label}
            </Link>
          ))}
        </nav>
        {/* The two direct channels sit at the end of the bar, as icons.

            The phone button renders only when NEXT_PUBLIC_CONTACT_PHONE is set
            — see lib/site-contact.ts. A `tel:` built from a placeholder is
            worse than an absent button: it looks live, it is tappable, and it
            fails in the visitor's dialler rather than on the page. Email is
            always present because its address is not a secret and does not
            depend on configuration.

            Both are plain anchors, not <Link>: `tel:` and `mailto:` are
            external schemes, and handing them to the client router asks it to
            prefetch a route that does not exist. */}
        <div className="header-actions">
          <Link href="/search" aria-label="Search" className="header-search-link" prefetch={false}>
            <SearchIcon />
          </Link>
          <ThemeToggle />
          <div className="header-contact">
            {phoneHref ? (
              <a href={phoneHref} className="header-icon-link" aria-label="Call Shivam Patil">
                <PhoneIcon />
              </a>
            ) : null}
            <a href={mailtoHref()} className="header-icon-link" aria-label="Email Shivam Patil">
              <MailIcon />
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
