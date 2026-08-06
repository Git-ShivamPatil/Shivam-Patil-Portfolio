import Link from "next/link";

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
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <Link href="/reach-out" className="nav-cta">
          Let&apos;s talk <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </header>
  );
}
