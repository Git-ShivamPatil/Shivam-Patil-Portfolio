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
        <nav className="primary-nav" aria-label="Main navigation">
          <Link href="/#work">Selected work</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <div className="header-actions">
          <Link href="/search" aria-label="Search" className="header-search-link">
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
