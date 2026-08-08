import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "../../lib/prisma";
import { readOrFallback } from "../../lib/db-read";

export const metadata: Metadata = {
  title: "Blog — Shivam Patil",
  description: "Notes on distributed systems, AI products, and building things that hold up.",
  alternates: { canonical: "/blog" },
};

// See app/page.tsx - fallback-backed content must not be frozen static.
export const revalidate = 300;

export default async function BlogIndexPage() {
  const posts = await readOrFallback(
    "blog/list",
    () =>
      prisma.blogPost.findMany({
        where: { published: true },
        orderBy: { publishedAt: "desc" },
        select: { slug: true, title: true, excerpt: true, tags: true, publishedAt: true },
      }),
    [],
  );

  return (
    <>
      <section className="page-hero shell">
        <p className="eyebrow">Blog</p>
        <h1>
          Notes from
          <br />
          <em>the build.</em>
        </h1>
        <p>Write-ups on systems, AI products, and the decisions behind them.</p>
      </section>

      <div className="blog-list shell">
        {posts.length === 0 ? (
          <p className="blog-empty">Nothing published yet — check back soon.</p>
        ) : (
          posts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="blog-list-item">
              <div>
                <span className="blog-list-date">
                  {post.publishedAt?.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <h2>{post.title}</h2>
                <p>{post.excerpt}</p>
                {post.tags.length > 0 && (
                  <ul className="skill-chip-list">
                    {post.tags.map((tag) => (
                      <li key={tag}>{tag}</li>
                    ))}
                  </ul>
                )}
              </div>
              <span className="blog-list-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
