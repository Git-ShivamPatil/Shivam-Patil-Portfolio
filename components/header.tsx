import Link from "next/link";
import { ThemeToggle } from "./theme-toggle";
import { AuthNav } from "./auth-nav";
import { SearchIcon } from "./icons";

export function Header() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="wordmark" aria-label="Shivam Patil home">
          <span className="wordmark-mark">SP</span>
          <span>Shivam Patil</span>
        </Link>
        {/* prefetch is left ON for the static/ISR routes — those are served from
            the CDN, so a warm cache costs nothing and navigation stays instant.
            It is turned OFF only for the `ƒ` dynamic routes, where each prefetch
            is a full server render plus Neon queries. The header is on every
            page, so that fired on every single page load for pages nobody had
            asked for — measured at 538ms (/services), 568ms (/stats) and 384ms
            (/search) of pure waste while the main thread was still hydrating. */}
        <nav className="primary-nav" aria-label="Main navigation">
          <Link href="/#work">Selected work</Link>
          <Link href="/services" prefetch={false}>
            Services
          </Link>
          <Link href="/stats" prefetch={false}>
            Stats
          </Link>
          <Link href="/blog">Blog</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <div className="header-actions">
          <Link href="/search" aria-label="Search" className="header-search-link" prefetch={false}>
            <SearchIcon />
          </Link>
          <ThemeToggle />
          <AuthNav />
          <Link href="/reach-out" className="nav-cta">
            Let&apos;s talk <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
