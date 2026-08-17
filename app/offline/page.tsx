import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline — Shivam Patil",
  description: "You are offline. This page was cached ahead of time.",
  // Never index the fallback. A crawler that reaches it would file it as the
  // content of whatever URL it was serving in place of.
  robots: { index: false, follow: false },
};

/**
 * P23 — the offline fallback, precached at service-worker install.
 *
 * Fully static and links only to routes the shell can plausibly reach, because
 * a fallback page whose own assets need the network is not a fallback. No
 * images, no fonts beyond the ones already loaded, no client JavaScript.
 */
export default function OfflinePage() {
  return (
    <div className="shell py-16">
      <section className="page-hero">
        <p className="eyebrow">No connection</p>
        <h1>
          You are offline,
          <br />
          <em>and this page knew that in advance.</em>
        </h1>
        <p className="page-lede">
          This document was cached when the service worker installed, which is why it is here at
          all. Pages themselves are deliberately never served from cache — a stale document
          referencing JavaScript that no longer exists is a white screen, and a white screen is
          worse than an honest one.
        </p>
        <p className="page-lede">
          Anything written into the contact form while offline is queued and sent when the
          connection returns, including if this tab is closed first — provided the browser supports
          Background Sync. Safari does not, and there it sends on your next visit instead.
        </p>
        <p>
          <Link className="button-link" href="/">
            Try the homepage
          </Link>
        </p>
      </section>
    </div>
  );
}
