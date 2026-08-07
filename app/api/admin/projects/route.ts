import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "../../../../lib/prisma";
import { requireAdminApi } from "../../../../lib/api-guards";
import { projectSchema } from "../../../../lib/validations/project";
import { isUniqueConstraintError } from "../../../../lib/prisma-errors";

export async function GET() {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const projects = await prisma.project.findMany({
    orderBy: { order: "asc" },
    include: { images: true },
  });
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const body = await request.json().catch(() => null);
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const { images, ...data } = parsed.data;

  try {
    const project = await prisma.project.create({
      data: {
        ...data,
        images: { create: images.map((image, order) => ({ ...image, order })) },
      },
      include: { images: true },
    });
    // Homepage, /projects/[slug], and the sitemap are statically generated —
    // without this, a newly created/edited/deleted project wouldn't show up
    // live until the next full redeploy.
    revalidatePath("/", "layout");
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
    }
    console.error("POST /api/admin/projects failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
