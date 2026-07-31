import Link from "next/link";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        <p>© {new Date().getFullYear()} Shivam Patil. Built with clarity and intent.</p>
        <div className="footer-links">
          <a href="https://github.com/Git-ShivamPatil" target="_blank" rel="noreferrer">GitHub ↗</a>
          <a href="https://www.linkedin.com/in/shivam--patil/" target="_blank" rel="noreferrer">LinkedIn ↗</a>
          <Link href="/reach-out">Reach out</Link>
        </div>
      </div>
    </footer>
  );
}
