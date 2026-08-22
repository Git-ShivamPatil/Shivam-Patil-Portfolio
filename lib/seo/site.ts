import { contactEmail } from "../site-contact";

/**
 * The single source of truth for who this site is about.
 *
 * Before this file, the same facts were written out four times — in
 * app/layout.tsx's metadata, in app/page.tsx's Person JSON-LD, in
 * app/opengraph-image.tsx and in the résumé — and they had already drifted:
 * the layout said "Software Engineer", the JSON-LD said "Software Development
 * Engineer", and /about said "SDE at Tata Consultancy Services". A crawler
 * reconciling those is guessing which one is the job title.
 *
 * Everything here is a plain constant so it can be imported by server
 * components, by `generateMetadata`, and by the JSON-LD builders in
 * ./structured-data.ts without any of them reaching for the database.
 */

/**
 * The site's origin, and the only place its default is written.
 *
 * **The default is the `www` form because that is the canonical host** — the
 * `link[rel=canonical]`, `og:url`, `sitemap.xml` and the registered OAuth
 * redirect URIs all use it. Seven files used to inline this same expression,
 * and they had already split: app/api/openapi/route.ts defaulted to `www`
 * while lib/seo/site.ts, app/robots.ts, lib/mail.ts and three API routes
 * defaulted to the bare apex. Production sets `NEXT_PUBLIC_SITE_URL`, so the
 * split was invisible there — but any environment that does not (a preview
 * without the variable, CI, a fresh clone) emitted a `robots.txt` whose
 * sitemap URL pointed at the non-canonical host while the OpenAPI document's
 * `servers[]` pointed at the canonical one. Two documents disagreeing about
 * which origin the site lives at is precisely the signal a crawler resolves by
 * picking one and ignoring the other.
 */
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shivamsfolio.com";

export const person = {
  name: "Shivam Patil",
  /** The title used in <title> tags and JSON-LD `jobTitle`. One wording, everywhere. */
  jobTitle: "Software Engineer",
  /** The longer form, for prose and for JSON-LD `description`. */
  role: "Software Development Engineer",
  employer: "Tata Consultancy Services",
  location: { city: "Mumbai", region: "Maharashtra", country: "India" },
  email: contactEmail,
  alumniOf: "Pune University",
  degree: "B.Tech, Artificial Intelligence and Data Science",
  github: "https://github.com/Git-ShivamPatil",
  linkedin: "https://www.linkedin.com/in/shivam--patil/",
  /**
   * Stored WITHOUT the `?hl=en` Instagram appends in a browser session. That
   * parameter is a locale hint belonging to whoever copied the link, not part
   * of the profile's address — shipping it would force English on every
   * visitor who follows it, including the ones Instagram would otherwise serve
   * in their own language.
   */
  instagram: "https://www.instagram.com/shivampatil.999/",
  /** x.com, not twitter.com: the redirect still works, but the canonical host
   *  is what `sameAs` should claim if it is claiming an identity. */
  twitter: "https://x.com/shivamp_9",
} as const;

/**
 * The terms this site is trying to be found for.
 *
 * **These are not decoration, and they are not a `<meta name="keywords">`
 * play.** Google has ignored that tag since 2009 and this list is never
 * rendered into one. What it is for is consistency: it is the vocabulary that
 * page titles, descriptions, JSON-LD `knowsAbout` and the on-page copy all
 * draw from, so that the same phrasing reinforces itself across the site
 * instead of six pages each inventing their own wording for the same skill.
 *
 * Ordered by how much of the site actually evidences them. `C++`, `Rust` and
 * `Go` sit at the top because there is a published project behind each; a term
 * with nothing behind it earns a bounce, and a bounce is worse than never
 * ranking.
 */
export const coreTopics = [
  "C++",
  "Rust",
  "Go",
  "Golang",
  "Python",
  "TypeScript",
  "distributed systems",
  "backend engineering",
  "systems programming",
  "AI engineering",
  "retrieval-augmented generation",
  "LLM inference",
  "concurrency",
  "high-throughput APIs",
  "site reliability engineering",
  "Kubernetes",
  "PostgreSQL",
  "observability",
] as const;

/**
 * The title suffix. Kept here rather than repeated in 30 files, because it also
 * has to be *subtracted* — `title.template` in the root layout would append it
 * to pages that already carry it, producing "About — Shivam Patil — Shivam
 * Patil". See lib/seo/metadata.ts, which owns that rule.
 */
export const titleSuffix = `${person.name} — ${person.jobTitle}`;
