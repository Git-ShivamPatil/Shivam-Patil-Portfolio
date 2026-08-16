import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "./theme-toggle";
import { NavDrawer } from "./nav/nav-drawer";
import { SearchIcon } from "./icons";

export function Header() {
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
        {/* The top bar carries four things and nothing else: System design,
            Search, the theme toggle and Contact. The other seven links, the
            auth avatar and the "Let's talk" pill moved into the drawer, along
            with the prefetch rationale that used to live here — see the comment
            on NAV_GROUPS in components/nav/nav-drawer.tsx.

            /search keeps prefetch={false} for the reason it always had: it is a
            `ƒ` dynamic route, so a prefetch is a server render plus a Neon
            query, measured at 384ms of waste on a page nobody had asked for.
            /system-design and /contact are static, so theirs stays on. */}
        <nav className="header-nav" aria-label="Main navigation">
          <Link href="/system-design">System design</Link>
        </nav>
        <div className="header-actions">
          <Link href="/search" aria-label="Search" className="header-search-link" prefetch={false}>
            <SearchIcon />
          </Link>
          <ThemeToggle />
          <Link href="/contact">Contact</Link>
        </div>
      </div>
    </header>
  );
}
