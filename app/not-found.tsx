import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight } from "../components/icons";

export const metadata: Metadata = {
  title: "404 — Shivam Patil",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <section className="error-page shell">
      <p className="eyebrow">404</p>
      <h1>
        This path
        <br />
        doesn&apos;t <em>resolve.</em>
      </h1>
      <p>
        The page you&apos;re looking for doesn&apos;t exist, or moved. Let&apos;s get you back on a
        known route.
      </p>
      <Link href="/" className="button button-solid">
        Back to home <ArrowUpRight />
      </Link>
    </section>
  );
}
