import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/seo/site";

/**
 * Paths no crawler should take, for reasons that have nothing to do with
 * secrecy — each is already gated server-side.
 *
 * `/api/` is here because it is machinery, not content. `/admin/` and
 * `/account/` 307 to login anyway. `/d/` is the counted-download redirect
 * (P10): the PDF it points at stays crawlable at its real path, but a crawler
 * following the redirect would be counted as a person taking the résumé. The
 * UA check in `recordDownload` is the belt; this is the braces, and it also
 * saves the request.
 */
const PRIVATE = ["/api/", "/admin/", "/account/", "/d/"];

/**
 * The two API paths that ARE content, and the reason this file grew rules.
 *
 * `/api/openapi` is a hand-written OpenAPI 3.1 description of every public
 * endpoint here — the most machine-legible artifact on the domain, and the one
 * thing a model asked "what can this site do?" could answer from in a single
 * fetch. `/api/graphql` refuses mutations, subscriptions and introspection by
 * name (P24), so a crawler reaching it can read a documented subset and
 * nothing else.
 *
 * Both sat behind a blanket `Disallow: /api/`. Nothing was protecting them;
 * they were collateral from a rule aimed at machinery.
 *
 * **Longest-match, not first-match.** `/api/openapi` is a longer prefix than
 * `/api/`, and the major crawlers resolve a conflict by specificity rather
 * than by order in the file. That is the mechanism this depends on, and it is
 * why the broad `Disallow` can stay alongside these.
 */
const PUBLIC_API = ["/api/openapi", "/api/graphql"];

/**
 * Crawlers that feed an assistant rather than a search index.
 *
 * **These are allowed on purpose, and it is a decision worth being able to
 * reverse in one edit.** The audience for this site includes people who will
 * ask a model about a candidate before they ever open a browser tab, so an
 * assistant that cannot read the case studies is a channel closed. The cost is
 * the usual one: this content becomes training and retrieval material for
 * systems that will not send a referrer. That trade is deliberate — the site
 * publishes nothing it would mind being quoted — but if it ever stops being
 * the right one, moving a name from this list into a `Disallow: /` rule is the
 * whole change.
 *
 * `Google-Extended` is not a crawler at all: it is the token that governs
 * whether Gemini may use content Googlebot already fetched. Listing it here
 * grants that separately from search indexing, which is exactly the split it
 * exists to express.
 */
const ASSISTANT_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "cohere-ai",
  "Meta-ExternalAgent",
  "Amazonbot",
  "DuckAssistBot",
  "MistralAI-User",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE,
      },
      {
        userAgent: ASSISTANT_AGENTS,
        allow: ["/", ...PUBLIC_API],
        disallow: PRIVATE,
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    /**
     * The canonical origin, declared.
     *
     * Not every crawler reads `host`, but the ones that do use it to collapse
     * apex-vs-www into one property — and this site has both resolving. It is
     * the same claim `link[rel=canonical]` and the sitemap already make; saying
     * it in a third place costs one line and removes the chance that a crawler
     * arriving at the apex treats it as a separate site.
     */
    host: siteUrl,
  };
}
