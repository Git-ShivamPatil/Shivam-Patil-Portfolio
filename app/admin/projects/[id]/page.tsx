import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../lib/auth-guards";
import { prisma } from "../../../../lib/prisma";
import { ProjectForm, type ProjectFormInitial } from "../../../../components/admin/project-form";

export const metadata: Metadata = {
  title: "Admin · Edit project",
  robots: { index: false, follow: false },
};

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("/admin/projects");
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: { images: { orderBy: { order: "asc" } } },
  });
  if (!project) notFound();

  const initial: ProjectFormInitial = {
    slug: project.slug,
    number: project.number,
    category: project.category,
    title: project.title,
    shortTitle: project.shortTitle,
    summary: project.summary,
    outcome: project.outcome,
    accent: project.accent,
    useCase: project.useCase,
    published: project.published,
    order: project.order,
    stack: project.stack,
    tags: project.tags,
    implemented: project.implemented as [string, string][],
    architecture: project.architecture as unknown as ProjectFormInitial["architecture"],
    steps: project.steps as [string, string, string][],
    images: project.images.map((image) => ({ url: image.url, alt: image.alt })),
  };

  return (
    <div className="shell max-w-3xl py-10">
      <p className="text-app-muted mb-2 font-mono text-[10px] font-medium tracking-wider uppercase">
        Admin
      </p>
      <h1 className="text-app-fg mb-8 text-3xl font-bold tracking-tight">Edit project</h1>
      <ProjectForm id={project.id} initial={initial} />
    </div>
  );
}
