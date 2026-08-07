import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";
import { DeleteButton } from "../../../components/admin/delete-button";

export const metadata: Metadata = {
  title: "Admin · Blogs — Shivam Patil",
  robots: { index: false, follow: false },
};

export default async function AdminBlogsPage() {
  await requireAdmin("/admin/blogs");
  const posts = await prisma.blogPost.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="shell py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
            Admin
          </p>
          <h1 className="text-app-fg text-3xl font-bold tracking-tight">Blogs</h1>
          <p className="text-app-muted mt-2 text-sm">{posts.length} total</p>
        </div>
        <Link
          href="/admin/blogs/new"
          className="bg-app-ink text-app-lime rounded-full px-4 py-2 text-sm font-bold"
        >
          New post
        </Link>
      </div>

      <div className="border-app-line overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-app-line text-app-muted border-b text-xs tracking-wide uppercase">
              <th className="px-4 py-3 font-semibold">Title</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Created</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.id} className="border-app-line border-b last:border-0">
                <td className="text-app-fg px-4 py-3 font-medium">{post.title}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      post.published
                        ? "bg-app-lime/30 text-app-fg"
                        : "bg-app-line/40 text-app-muted"
                    }`}
                  >
                    {post.published ? "Published" : "Draft"}
                  </span>
                </td>
                <td className="text-app-muted px-4 py-3">
                  {post.createdAt.toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/blogs/${post.id}`}
                      className="text-app-fg text-xs font-semibold hover:underline"
                    >
                      Edit
                    </Link>
                    <DeleteButton
                      endpoint={`/api/admin/blogs/${post.id}`}
                      confirmText={`Delete "${post.title}"? This can't be undone.`}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {posts.length === 0 && (
              <tr>
                <td colSpan={4} className="text-app-muted px-4 py-8 text-center">
                  No posts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
