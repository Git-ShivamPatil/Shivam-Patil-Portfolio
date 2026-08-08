import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "../../../../../lib/prisma";
import { requireAdminApi } from "../../../../../lib/api-guards";
import { projectSchema } from "../../../../../lib/validations/project";
import { isNotFoundError, isUniqueConstraintError } from "../../../../../lib/prisma-errors";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  const { id } = await params;

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
    // Images have no independent identity worth diffing here — replace the
    // set wholesale inside a transaction rather than reconciling adds/
    // removes/reorders row by row.
    const project = await prisma.$transaction(async (tx) => {
      await tx.projectImage.deleteMany({ where: { projectId: id } });
      return tx.project.update({
        where: { id },
        data: {
          ...data,
          images: { create: images.map((image, order) => ({ ...image, order })) },
        },
        include: { images: true },
      });
    });
    revalidatePath("/", "layout");
    return NextResponse.json({ project });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
    }
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    console.error("PUT /api/admin/projects/[id] failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  const { id } = await params;

  try {
    await prisma.project.delete({ where: { id } });
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    console.error("DELETE /api/admin/projects/[id] failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
