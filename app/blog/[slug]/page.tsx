import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "../../../lib/prisma";

export async function generateStaticParams() {
  const posts = await prisma.blogPost.findMany({
    where: { published: true },
    select: { slug: true },
  });
  return posts.map(({ slug }) => ({ slug }));
}

async function getPost(slug: string) {
  const post = await prisma.blogPost.findUnique({ where: { slug } });
  return post && post.published ? post : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "Blog — Shivam Patil" };
  return {
    title: `${post.title} — Shivam Patil`,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { title: `${post.title} — Shivam Patil`, description: post.excerpt },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  // Content is plain text authored in the admin CRUD — paragraphs are
  // separated by a blank line, no markdown/HTML parsing involved.
  const paragraphs = post.content.split(/\n{2,}/).filter(Boolean);

  return (
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
  );
}
