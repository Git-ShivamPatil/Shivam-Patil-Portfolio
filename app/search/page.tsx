import Link from "next/link";
import type { Metadata } from "next";
import { search } from "../../lib/search";

export const metadata: Metadata = {
  title: "Search — Shivam Patil",
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const results = q.trim() ? await search(q) : [];

  return (
    <>
      <section className="page-hero shell">
        <p className="eyebrow">Search</p>
        <h1>
          Find something
          <br />
          <em>specific.</em>
        </h1>
        <form action="/search" method="GET" className="search-form">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search projects and posts…"
            aria-label="Search"
            autoFocus
          />
          <button type="submit" className="button button-solid">
            Search
          </button>
        </form>
      </section>

      <div className="search-results shell">
        {q.trim() && results.length === 0 && (
          <p className="blog-empty">No results for &ldquo;{q}&rdquo;.</p>
        )}
        {results.map((result) => (
          <Link
            key={`${result.type}-${result.slug}`}
            href={result.type === "project" ? `/projects/${result.slug}` : `/blog/${result.slug}`}
            className="search-result-item"
          >
            <span className="search-result-type">{result.type}</span>
            <div>
              <h2>{result.title}</h2>
              <p>{result.excerpt}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
