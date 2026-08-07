import type { Metadata } from "next";
import { requireAdmin } from "../../../../lib/auth-guards";
import { BlogForm } from "../../../../components/admin/blog-form";

export const metadata: Metadata = {
  title: "Admin · New post — Shivam Patil",
  robots: { index: false, follow: false },
};

export default async function NewBlogPage() {
  await requireAdmin("/admin/blogs/new");

  return (
    <div className="shell max-w-3xl py-10">
      <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
        Admin
      </p>
      <h1 className="text-app-fg mb-8 text-3xl font-bold tracking-tight">New post</h1>
      <BlogForm />
    </div>
  );
}
