import Link from "next/link";
import { ArrowUpRight } from "../icons";
import type { RelatedPage } from "../../lib/seo/related";

/**
 * P27 — the "related" block that carries the internal link graph.
 *
 * A server component with no state and no effects, deliberately: these links
 * exist to be *crawled*, so they must be in the server-rendered HTML. A client
 * component that fetched them after hydration would produce the same page for a
 * human and a blank one for the crawler this whole feature is aimed at — which
 * is the same failure mode the JavaScript navigation drawer already has (§55a).
 *
 * Renders nothing when there is nothing related, rather than an empty heading.
 * See lib/seo/related.ts for why the list is never padded to a fixed length.
 */
export function RelatedPages({
  pages,
  heading = "Related on this site",
}: {
  pages: RelatedPage[];
  heading?: string;
}) {
  if (pages.length === 0) return null;

  return (
    <section className="related-pages shell" data-reveal>
      <p className="eyebrow">{heading}</p>
      <ul>
        {pages.map((page) => (
          <li key={page.url}>
            <Link href={page.url}>
              <span className="related-pages__label">
                {page.label}
                <ArrowUpRight />
              </span>
              {page.blurb ? <span className="related-pages__blurb">{page.blurb}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
