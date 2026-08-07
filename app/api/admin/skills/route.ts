import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "../../../../lib/prisma";
import { requireAdminApi } from "../../../../lib/api-guards";
import { skillSchema } from "../../../../lib/validations/skill";
import { isUniqueConstraintError } from "../../../../lib/prisma-errors";

export async function GET() {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const skills = await prisma.skill.findMany({ orderBy: [{ category: "asc" }, { order: "asc" }] });
  return NextResponse.json({ skills });
}

export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const body = await request.json().catch(() => null);
  const parsed = skillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  try {
    const skill = await prisma.skill.create({ data: parsed.data });
    revalidatePath("/", "layout");
    return NextResponse.json({ skill }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "That skill already exists in this category." },
        { status: 409 },
      );
    }
    console.error("POST /api/admin/skills failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
