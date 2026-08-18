import type { Metadata } from "next";
import { siteUrl, person } from "./site";

/**
 * One helper that builds a route's `Metadata`, so every page gets the same set
 * of tags instead of each remembering a different subset.
 *
 * The audit that prompted this found the site's pages carrying, between them:
 * a title and a canonical (most), a title only (several), and neither
 * (app/page.tsx, which inherited the layout's). **Not one non-root page set
 * `openGraph` or `twitter`.** The effect is that every link to any page but the
 * homepage — pasted into Slack, LinkedIn, WhatsApp, a DM — unfurled with the
 * homepage's title and description, because those are what the root layout
 * supplies and nothing overrode them.
 *
 * ### The rules this encodes
 *
 * - **`title` is the page's own words, without the name suffix.** The root
 *   layout owns `title.template`, which appends "— Shivam Patil". Passing
 *   "About — Shivam Patil" here produces "About — Shivam Patil — Shivam Patil".
 *   So callers pass "About" and this file never adds the suffix either.
 *
 * - **`description` is required, and it is checked.** A description under ~70
 *   characters gets rewritten by Google from page text; over ~160 it is
 *   truncated mid-sentence. The dev-only assertion below is a guardrail, not a
 *   runtime dependency — it compiles away to nothing in production.
 *
 * - **`canonical` is always set, always root-relative.** `metadataBase` in the
 *   root layout resolves it. A missing canonical is how a page ends up
 *   competing with its own `?ref=` and `?utm_` variants, and this site's
 *   referral system (P10) generates exactly those.
 *
 * - **openGraph and twitter are derived, never hand-written.** They restate the
 *   title and description, which is what they should almost always be; a page
 *   that genuinely wants different social copy passes `ogTitle`/`ogDescription`.
 */
export function pageMetadata({
  title,
  description,
  path,
  ogTitle,
  ogDescription,
  type = "website",
  noIndex = false,
  images,
}: {
  /** The page's own title, WITHOUT "— Shivam Patil". */
  title: string;
  /** 70–160 characters. Written for a human deciding whether to click. */
  description: string;
  /** Root-relative, with a leading slash. "/" for the homepage. */
  path: string;
  ogTitle?: string;
  ogDescription?: string;
  type?: "website" | "article" | "profile";
  /** For pages that must not be indexed — /search, /account, the auth flows. */
  noIndex?: boolean;
  images?: { url: string; width?: number; height?: number; alt?: string }[];
}): Metadata {
  if (process.env.NODE_ENV === "development") {
    if (description.length < 70 || description.length > 160) {
      console.warn(
        `[seo] ${path}: description is ${description.length} chars; aim for 70–160. Google rewrites shorter ones and truncates longer ones.`,
      );
    }
  }

  const canonical = path;
  const absolute = `${siteUrl}${path === "/" ? "" : path}`;

  return {
    title,
    description,
    alternates: { canonical },
    // Explicit rather than inherited, because `robots` is one of the few fields
    // where the inherited value is the dangerous default: a page added later
    // that should be private would silently be indexable.
    robots: noIndex
      ? { index: false, follow: true }
      : { index: true, follow: true, googleBot: { index: true, follow: true } },
    openGraph: {
      type,
      url: absolute,
      siteName: person.name,
      title: ogTitle ?? title,
      description: ogDescription ?? description,
      locale: "en_US",
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle ?? title,
      description: ogDescription ?? description,
      ...(images ? { images: images.map((image) => image.url) } : {}),
    },
  };
}
