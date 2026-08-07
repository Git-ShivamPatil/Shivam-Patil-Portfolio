import { prisma } from "../lib/prisma";
import type { Project as PrismaProject, ProjectImage } from "../lib/generated/prisma/client";

export type ProjectAccent = "cyan" | "violet" | "orange" | "lime" | "blue" | "pink";

export type ArchitectureNodeType = "input" | "core" | "store" | "output";

export interface ArchitectureNode {
  title: string;
  detail: string;
  type: ArchitectureNodeType;
}

export interface ProjectImageItem {
  url: string;
  alt: string;
}

export interface Project {
  slug: string;
  number: string;
  category: string;
  title: string;
  shortTitle: string;
  summary: string;
  outcome: string;
  accent: ProjectAccent;
  stack: string[];
  tags: string[];
  useCase: string;
  implemented: [string, string][];
  architecture: ArchitectureNode[];
  steps: [string, string, string][];
  images: ProjectImageItem[];
}

// Prisma's Json columns type as `JsonValue` on read — these fields are only
// ever written by the admin CRUD form (lib/validations/project.ts), which
// enforces the tuple/object shape server-side, so this cast is safe.
function toProject(row: PrismaProject & { images?: ProjectImage[] }): Project {
  return {
    slug: row.slug,
    number: row.number,
    category: row.category,
    title: row.title,
    shortTitle: row.shortTitle,
    summary: row.summary,
    outcome: row.outcome,
    accent: row.accent,
    stack: row.stack,
    tags: row.tags,
    useCase: row.useCase,
    implemented: row.implemented as [string, string][],
    architecture: row.architecture as unknown as ArchitectureNode[],
    steps: row.steps as [string, string, string][],
    images: (row.images ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((image) => ({ url: image.url, alt: image.alt })),
  };
}

/** Published projects, in admin-defined order — used by the homepage list, sitemap, and next-project pagination. */
export async function getProjects(): Promise<Project[]> {
  const rows = await prisma.project.findMany({
    where: { published: true },
    orderBy: { order: "asc" },
    include: { images: true },
  });
  return rows.map(toProject);
}

export async function getProjectBySlug(slug: string): Promise<Project | undefined> {
  const row = await prisma.project.findUnique({ where: { slug }, include: { images: true } });
  return row && row.published ? toProject(row) : undefined;
}

/** All distinct tags across published projects, for the homepage filter UI. */
export async function getProjectTags(): Promise<string[]> {
  const rows = await prisma.project.findMany({
    where: { published: true },
    select: { tags: true },
  });
  return Array.from(new Set(rows.flatMap((row) => row.tags))).sort();
}
