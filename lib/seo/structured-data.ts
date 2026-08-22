import { siteUrl, person, coreTopics } from "./site";

/**
 * JSON-LD builders.
 *
 * Before this file the entire site carried exactly one structured-data block:
 * a five-field `Person` on the homepage. That is enough for Google to know a
 * person exists and almost nothing else — no topics, no employer history, no
 * breadcrumbs, no per-project or per-article markup — so every page below the
 * homepage competed purely on prose.
 *
 * Everything below returns a plain object. The caller serialises it with
 * `jsonForScript` from lib/security/escape.ts, never `JSON.stringify`: a
 * string containing `</script` ends the element as far as the HTML parser is
 * concerned, whatever the JSON says, and several of these builders now take
 * database-backed text.
 *
 * **`@id` is load-bearing.** Each entity gets a stable URL-shaped id so blocks
 * on different pages refer to the *same* Person rather than declaring a new one
 * per page. Without it a crawler sees thirty unrelated people who happen to
 * share a name.
 */

export const PERSON_ID = `${siteUrl}/#person`;
export const SITE_ID = `${siteUrl}/#website`;

type JsonLd = Record<string, unknown>;

/**
 * The canonical Person. Emitted once, in the root layout, so every page inherits
 * it — the homepage no longer needs its own copy.
 *
 * `knowsAbout` is the field that carries the technical vocabulary. It is the
 * legitimate, documented way to tell a search engine what a person works on,
 * and it is the reason the coreTopics list exists.
 */
export function personJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": PERSON_ID,
    name: person.name,
    jobTitle: person.jobTitle,
    description: `${person.role} building high-throughput backend platforms, distributed systems and AI products in ${person.location.city}, ${person.location.country}.`,
    url: siteUrl,
    email: `mailto:${person.email}`,
    image: `${siteUrl}/logo.jpeg`,
    knowsAbout: [...coreTopics],
    address: {
      "@type": "PostalAddress",
      addressLocality: person.location.city,
      addressRegion: person.location.region,
      addressCountry: person.location.country,
    },
    worksFor: {
      "@type": "Organization",
      name: person.employer,
      // A bare `name` leaves Google to guess which of the several thousand
      // organisations with similar names this is. The URL disambiguates it
      // against an entity that already exists in the knowledge graph, which is
      // the whole mechanism by which employment gets attributed to a person.
      url: "https://www.tcs.com",
    },
    alumniOf: {
      "@type": "CollegeOrUniversity",
      name: person.alumniOf,
    },
    /**
     * `hasOccupation` rather than `jobTitle` alone.
     *
     * `jobTitle` is a string. `Occupation` is an entity, and it is the field
     * that carries the two things a string cannot: the skill set attached to
     * the role, and where the role is performed. Both are above `knowsAbout` in
     * specificity — `knowsAbout` says "this person knows about Rust", an
     * Occupation with `skills` says "this person is employed as a software
     * engineer, and Rust is part of that job".
     *
     * `jobTitle` stays as well. They are not alternatives; consumers that read
     * one frequently do not read the other.
     */
    hasOccupation: {
      "@type": "Occupation",
      name: person.role,
      occupationalCategory: "15-1252.00 Software Developers",
      skills: [...coreTopics].join(", "),
      occupationLocation: {
        "@type": "City",
        name: person.location.city,
      },
    },
    /**
     * `sameAs` is the identity-resolution field: it is how a crawler decides
     * that the "Shivam Patil" on this domain and the one on GitHub are one
     * person rather than two. LinkedIn first, deliberately — it is the profile
     * with the strongest independent corroboration of the employment claim
     * above, and the order is a weak but real hint at which to trust.
     */
    sameAs: [person.linkedin, person.github, person.twitter, person.instagram],
  };
}

/**
 * The certifications page, as a list of credentials.
 *
 * `EducationalOccupationalCredential` is the type Google documents for exactly
 * this: a course or exam a person has completed. The key field is
 * `credentialCategory`, and the key discipline is that `url` must point at
 * something a human can actually use to verify the claim — which is why this
 * takes the same `credentialUrl` the page renders as a link, and omits the
 * field entirely rather than inventing one when a certificate has no public
 * verification page.
 */
export function credentialsJsonLd(
  items: { name: string; issuer: string; year?: string; credentialUrl?: string }[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Certifications",
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "EducationalOccupationalCredential",
        name: item.name,
        credentialCategory: "certificate",
        recognizedBy: { "@type": "Organization", name: item.issuer },
        ...(item.year ? { dateCreated: item.year } : {}),
        ...(item.credentialUrl ? { url: item.credentialUrl } : {}),
        about: { "@id": PERSON_ID },
      },
    })),
  };
}

/**
 * The WebSite entity, carrying a SearchAction.
 *
 * The SearchAction is what lets Google render a search box directly in the
 * result for this domain. It points at /search, which is a real route that
 * accepts `?q=` — a SearchAction pointing at a URL that does not handle the
 * parameter is worse than none, because it renders a box that returns nothing.
 */
export function webSiteJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": SITE_ID,
    url: siteUrl,
    name: `${person.name} — ${person.jobTitle}`,
    publisher: { "@id": PERSON_ID },
    inLanguage: "en",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * Breadcrumbs, which Google renders in place of the raw URL in a result.
 *
 * `items` is ordered root-first and must NOT include the current page's own
 * trailing entry twice. Pass path segments as [label, href] pairs; "Home" is
 * prepended here so no caller has to remember it.
 */
export function breadcrumbJsonLd(items: { name: string; href: string }[]): JsonLd {
  const all = [{ name: "Home", href: "/" }, ...items];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: all.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${siteUrl}${item.href === "/" ? "" : item.href}`,
    })),
  };
}

/**
 * A project case study, as CreativeWork.
 *
 * Deliberately NOT `SoftwareApplication`: that type is for something a visitor
 * can install or run, and it asks for `offers`, `operatingSystem` and
 * `applicationCategory`. These pages are write-ups *about* software. Claiming
 * the richer type to chase a richer result is the kind of markup that gets a
 * site a manual action.
 */
export function projectJsonLd(project: {
  slug: string;
  title: string;
  summary: string;
  category: string;
  stack: string[];
  tags: string[];
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    "@id": `${siteUrl}/projects/${project.slug}#project`,
    url: `${siteUrl}/projects/${project.slug}`,
    name: project.title,
    headline: project.title,
    description: project.summary,
    genre: project.category,
    keywords: [...new Set([...project.stack, ...project.tags])].join(", "),
    author: { "@id": PERSON_ID },
    creator: { "@id": PERSON_ID },
    isPartOf: { "@id": SITE_ID },
    inLanguage: "en",
  };
}

/** A blog post. `BlogPosting` rather than `Article` — it is the narrower, truer type. */
export function blogPostJsonLd(post: {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: Date | string | null;
  updatedAt: Date | string;
}): JsonLd {
  const published = post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${siteUrl}/blog/${post.slug}#post`,
    url: `${siteUrl}/blog/${post.slug}`,
    headline: post.title,
    description: post.excerpt,
    // Omitted rather than faked when the post has no publish date: Google
    // treats a datePublished that disagrees with the visible page as a quality
    // signal against the page.
    ...(published ? { datePublished: published } : {}),
    dateModified: new Date(post.updatedAt).toISOString(),
    author: { "@id": PERSON_ID },
    publisher: { "@id": PERSON_ID },
    isPartOf: { "@id": SITE_ID },
    inLanguage: "en",
  };
}

/**
 * The /about page as a ProfilePage.
 *
 * This is the type Google documents for "a page about one person", and it is
 * what makes an about page eligible to be treated as the authoritative profile
 * rather than as one more content page that mentions a name.
 */
export function profilePageJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": `${siteUrl}/about#profile`,
    url: `${siteUrl}/about`,
    mainEntity: { "@id": PERSON_ID },
    isPartOf: { "@id": SITE_ID },
    inLanguage: "en",
  };
}

/**
 * An FAQ block. Used by the pages that genuinely answer discrete questions.
 *
 * The rule Google enforces: every question and answer here must be *visible on
 * the page*. These builders are therefore always called with the same array the
 * page renders, never with a parallel copy written for the crawler.
 */
export function faqJsonLd(entries: { question: string; answer: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

/**
 * An ItemList, for the index pages (/projects, /blog, /skills).
 *
 * A list page that only says "here are some things" ranks on its own prose. An
 * ItemList tells the crawler what the page is an index *of*, which is what lets
 * /projects rank for a query about a thing on it.
 */
export function itemListJsonLd(
  name: string,
  items: { name: string; href: string; description?: string }[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: `${siteUrl}${item.href}`,
      ...(item.description ? { description: item.description } : {}),
    })),
  };
}
