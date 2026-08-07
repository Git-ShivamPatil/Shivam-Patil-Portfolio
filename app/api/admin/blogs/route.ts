import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "../../../../lib/prisma";
import { requireAdminApi } from "../../../../lib/api-guards";
import { blogPostSchema } from "../../../../lib/validations/blog";
import { isUniqueConstraintError } from "../../../../lib/prisma-errors";

export async function GET() {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const posts = await prisma.blogPost.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ posts });
}

export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

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
    const post = await prisma.blogPost.create({
      data: {
        ...data,
        coverImage: coverImage || null,
        published,
        publishedAt: published ? new Date() : null,
        authorId: guard.session.user.id,
      },
    });
    revalidatePath("/", "layout");
    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "That slug is already in use." }, { status: 409 });
    }
    console.error("POST /api/admin/blogs failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
