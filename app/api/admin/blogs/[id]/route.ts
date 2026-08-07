import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "../../../../../lib/prisma";
import { requireAdminApi } from "../../../../../lib/api-guards";
import { blogPostSchema } from "../../../../../lib/validations/blog";
import { isUniqueConstraintError } from "../../../../../lib/prisma-errors";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = blogPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const { coverImage, published, ...data } = parsed.data;

  try {
    const existing = await prisma.blogPost.findUnique({
      where: { id },
      select: { published: true, publishedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Post not found." }, { status: 404 });
    }
    // Only stamp publishedAt the moment a post first goes live — later edits
    // to an already-published post shouldn't bump its publish date.
    const publishedAt = published ? (existing.publishedAt ?? new Date()) : null;

    const post = await prisma.blogPost.update({
      where: { id },
      data: { ...data, coverImage: coverImage || null, published, publishedAt },
    });
    revalidatePath("/", "layout");
    return NextResponse.json({ post });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
    }
    console.error("PUT /api/admin/blogs/[id] failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  const { id } = await params;

  try {
    await prisma.blogPost.delete({ where: { id } });
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/admin/blogs/[id] failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
