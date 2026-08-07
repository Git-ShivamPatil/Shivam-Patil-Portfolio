import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../lib/auth-guards";
import { prisma } from "../../../../lib/prisma";
import { BlogForm } from "../../../../components/admin/blog-form";

export const metadata: Metadata = {
  title: "Admin · Edit post — Shivam Patil",
  robots: { index: false, follow: false },
};

export default async function EditBlogPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("/admin/blogs");
  const { id } = await params;

  const post = await prisma.blogPost.findUnique({ where: { id } });
  if (!post) notFound();

  return (
    <div className="shell max-w-3xl py-10">
      <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
        Admin
      </p>
      <h1 className="text-app-fg mb-8 text-3xl font-bold tracking-tight">Edit post</h1>
      <BlogForm
        id={post.id}
        initial={{
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          content: post.content,
          coverImage: post.coverImage ?? "",
          published: post.published,
          tags: post.tags,
        }}
      />
    </div>
  );
}
