import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight } from "../../../components/icons";

export const metadata: Metadata = {
  title: "Newsletter — Shivam Patil",
  robots: { index: false, follow: false },
};

const COPY: Record<string, { heading: string; body: string }> = {
  ok: {
    heading: "You're on the list.",
    body: "Subscription confirmed. Expect infrequent, technical notes — and an unsubscribe link in every one.",
  },
  already: {
    heading: "Already confirmed.",
    body: "This address was confirmed earlier, so there was nothing left to do. You're subscribed.",
  },
  invalid: {
    heading: "That link didn't work.",
    body: "It may have already been used, or been superseded by a newer confirmation email. Subscribing again will send a fresh link.",
  },
  error: {
    heading: "Something went wrong.",
    body: "The confirmation couldn't be recorded. Try the link again in a moment, or subscribe again for a new one.",
  },
  "unsubscribed-ok": {
    heading: "Unsubscribed.",
    body: "You won't receive any more emails. No hard feelings — the blog stays open to everyone.",
  },
  "unsubscribed-invalid": {
    heading: "Link not recognised.",
    body: "This unsubscribe link is no longer valid. If you're still receiving email, reply to any of it and I'll remove you by hand.",
  },
  "unsubscribed-error": {
    heading: "Something went wrong.",
    body: "The unsubscribe couldn't be recorded. Please try the link again shortly.",
  },
};

export default async function NewsletterConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const copy = COPY[status ?? "invalid"] ?? COPY.invalid;

  return (
    <section className="error-page shell" data-reveal>
      <p className="eyebrow">Newsletter</p>
      <h1>{copy.heading}</h1>
      <p>{copy.body}</p>
      <div className="hero-actions">
        <Link href="/blog" className="button button-solid" data-magnetic>
          Read the blog <ArrowUpRight />
        </Link>
        <Link href="/" className="button button-text" data-magnetic>
          Back home <span>→</span>
        </Link>
      </div>
    </section>
  );
}
