import Link from "next/link";
import type { Metadata } from "next";
import { pageMetadata } from "../../../lib/seo/metadata";
import { JsonLd } from "../../../components/seo/json-ld";
import { blogPostJsonLd, breadcrumbJsonLd } from "../../../lib/seo/structured-data";
import { notFound } from "next/navigation";
import { prisma } from "../../../lib/prisma";
import { readOrFallback } from "../../../lib/db-read";
import { RelatedPages } from "../../../components/seo/related-pages";
import { relatedPages, queryFor } from "../../../lib/seo/related";

// Revalidate rather than prerender-once: if the build could not reach the
// database, the empty prerender heals on the next revalidation instead of
// being frozen into the deployment.
export const revalidate = 300;

export async function generateStaticParams() {
  // An empty list is a valid answer here - it just means "prerender nothing,
  // render these on demand", which is exactly the right behaviour when the
  // database is unreachable at build time (CI has no database at all).
  return readOrFallback(
    "blog/generateStaticParams",
    async () => {
      const posts = await prisma.blogPost.findMany({
        where: { published: true },
        select: { slug: true },
      });
      return posts.map(({ slug }) => ({ slug }));
    },
    [] as { slug: string }[],
  );
}

async function getPost(slug: string) {
  return readOrFallback(
    "blog/getPost",
    async () => {
      const post = await prisma.blogPost.findUnique({ where: { slug } });
      return post && post.published ? post : null;
    },
    null,
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "Blog" };
  return pageMetadata({
    title: post.title,
    description: post.excerpt,
    path: `/blog/${post.slug}`,
    type: "article",
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  // Content is plain text authored in the admin CRUD — paragraphs are
  // separated by a blank line, no markdown/HTML parsing involved.
  const paragraphs = post.content.split(/\n{2,}/).filter(Boolean);

  // P27 — see the note in app/projects/[slug]/page.tsx. A post previously
  // linked only back to /blog, so it was a leaf in the crawlable graph.
  const related = await relatedPages({
    self: `/blog/${slug}`,
    query: queryFor([post.title, post.excerpt, post.tags]),
  });

  return (
    <>
      <JsonLd
        data={[
          blogPostJsonLd(post),
          breadcrumbJsonLd([
            { name: "Blog", href: "/blog" },
            { name: post.title, href: `/blog/${post.slug}` },
          ]),
        ]}
      />
      <article className="blog-post shell">
        <Link href="/blog" className="back-link">
          ← All posts
        </Link>
        <p className="eyebrow">
          {post.publishedAt?.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
        <h1>{post.title}</h1>
        {post.tags.length > 0 && (
          <ul className="skill-chip-list">
            {post.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
        <div className="blog-post-body">
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </article>

      <RelatedPages pages={related} />
    </>
  );
}
