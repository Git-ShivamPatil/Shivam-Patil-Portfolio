import { retrieve } from "../ai/retrieve";
import { readOrFallback } from "../db-read";
import { SITE_ROUTES, AUDIENCE_ROUTES } from "../site-routes";

/**
 * P27 — the internal link graph, derived from the retrieval index.
 *
 * ### The problem this exists for
 *
 * §55a, in Google's own words: twenty of thirty-three sitemap URLs with
 * `Last crawl: N/A`. Not blocked, not noindexed, not missing from the sitemap —
 * simply never fetched. Three of the seven inspected were *"URL is unknown to
 * Google"*, meaning Google had never heard of them at all.
 *
 * The cause is structural. Every page here sets correct metadata and every page
 * is in the sitemap, but the navigation is a JavaScript drawer, so the crawlable
 * link graph is far thinner than the site looks. A sitemap declares that a URL
 * exists; it is a weak signal about whether the URL is worth fetching. Links
 * from relevant pages are the strong one, and this site barely had any.
 *
 * ### Why this is generated rather than curated
 *
 * A hand-written "related" list is a fourth route map (see lib/seo/llms.ts for
 * what happened to the first three) and it goes stale the moment content moves.
 * This runs the site's own hybrid retriever over the page's own text, so the
 * graph densifies automatically as the corpus grows and it is always describing
 * the current index rather than someone's memory of it.
 *
 * It also means the internal links and the on-site search agree by
 * construction. If `/skills` is the best answer to a question about Rust, it is
 * also what a Rust case study links to.
 *
 * ### What it deliberately does not do
 *
 * No reciprocal-link forcing, no minimum link count, no padding a thin result
 * up to three. A page with one genuinely related neighbour links to one. Filler
 * links are the exact pattern that reads as manipulation to a crawler, and they
 * would also be lying to a visitor about what is on the other end.
 */

export interface RelatedPage {
  url: string;
  label: string;
  blurb: string;
}

/** Route labels and blurbs, so a link reads as a page rather than as a chunk heading. */
const ROUTE_LABELS = new Map(
  [...SITE_ROUTES, ...AUDIENCE_ROUTES].map((route) => [
    route.href,
    { label: route.label, blurb: route.blurb },
  ]),
);

export interface RelatedOptions {
  /** The page asking. Excluded from its own results. */
  self: string;
  /** Text to retrieve on — the page's own title, summary and vocabulary. */
  query: string;
  limit?: number;
}

/**
 * Pages most related to `query`, excluding the asking page.
 *
 * **Over-fetches, then dedupes.** Retrieval returns *chunks*, and a long page
 * contributes several — asking for three chunks routinely yields one page three
 * times. It asks for four times the limit and collapses by URL, which is enough
 * headroom at this corpus size for the top few distinct pages to survive.
 *
 * Falls back to an empty list rather than throwing. A related-links block is an
 * enhancement; a case study that 500s because pgvector is unavailable is a far
 * worse outcome than one that renders without a footer section.
 */
export async function relatedPages(options: RelatedOptions): Promise<RelatedPage[]> {
  const limit = options.limit ?? 3;

  const chunks = await readOrFallback(
    `related/${options.self}`,
    () => retrieve(options.query, { limit: limit * 4 }),
    [],
  );

  const seen = new Set<string>([options.self]);
  const out: RelatedPage[] = [];

  for (const chunk of chunks) {
    if (seen.has(chunk.url)) continue;
    seen.add(chunk.url);

    const known = ROUTE_LABELS.get(chunk.url);
    out.push({
      url: chunk.url,
      // A registered route's registry label beats the chunk's title: the
      // registry is written in plain language for a human, and the chunk title
      // is whatever the corpus builder derived. For /projects/x and /blog/x —
      // which are not in the registry — the chunk title IS the page title.
      label: known?.label ?? chunk.title,
      blurb: known?.blurb ?? chunk.heading ?? "",
    });

    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Build a retrieval query from a page's own vocabulary.
 *
 * Title and summary carry the topic; stack and tags carry the rare terms that
 * the lexical half of the retriever is good at and the hashed embedding is not.
 * Joined rather than weighted, because `retrieve` already handles term
 * weighting and a second weighting scheme here would fight it.
 */
export function queryFor(parts: (string | string[] | null | undefined)[]): string {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .slice(0, 400);
}
