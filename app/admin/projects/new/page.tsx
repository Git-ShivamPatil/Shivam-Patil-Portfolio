import type { Metadata } from "next";
import { requireAdmin } from "../../../../lib/auth-guards";
import { ProjectForm } from "../../../../components/admin/project-form";

export const metadata: Metadata = {
  title: "Admin · New project — Shivam Patil",
  robots: { index: false, follow: false },
};

export default async function NewProjectPage() {
  await requireAdmin("/admin/projects/new");

  return (
    <div className="shell max-w-3xl py-10">
      <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
        Admin
      </p>
      <h1 className="text-app-fg mb-8 text-3xl font-bold tracking-tight">New project</h1>
      <ProjectForm />
    </div>
  );
}
