import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "../../../lib/auth-guards";
import { prisma } from "../../../lib/prisma";
import { DeleteButton } from "../../../components/admin/delete-button";

export const metadata: Metadata = {
  title: "Admin · Projects",
  robots: { index: false, follow: false },
};

export default async function AdminProjectsPage() {
  await requireAdmin("/admin/projects");
  const projects = await prisma.project.findMany({ orderBy: { order: "asc" } });

  return (
    <div className="shell py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
            Admin
          </p>
          <h1 className="text-app-fg text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-app-muted mt-2 text-sm">{projects.length} total</p>
        </div>
        <Link
          href="/admin/projects/new"
          className="bg-app-ink text-app-lime rounded-full px-4 py-2 text-sm font-bold"
        >
          New project
        </Link>
      </div>

      <div className="border-app-line overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-app-line text-app-muted border-b text-xs tracking-wide uppercase">
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Title</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} className="border-app-line border-b last:border-0">
                <td className="text-app-muted px-4 py-3">{project.order}</td>
                <td className="text-app-fg px-4 py-3 font-medium">{project.title}</td>
                <td className="text-app-muted px-4 py-3">{project.category}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      project.published
                        ? "bg-app-lime/30 text-app-fg"
                        : "bg-app-line/40 text-app-muted"
                    }`}
                  >
                    {project.published ? "Published" : "Draft"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/projects/${project.id}`}
                      className="text-app-fg text-xs font-semibold hover:underline"
                    >
                      Edit
                    </Link>
                    <DeleteButton
                      endpoint={`/api/admin/projects/${project.id}`}
                      confirmText={`Delete "${project.title}"? This can't be undone.`}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={5} className="text-app-muted px-4 py-8 text-center">
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
