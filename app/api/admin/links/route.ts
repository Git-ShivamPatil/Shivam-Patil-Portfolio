import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireAdminApi } from "../../../../lib/api-guards";
import { linkSchema } from "../../../../lib/validations/link";
import { isUniqueConstraintError } from "../../../../lib/prisma-errors";
import { generateUniqueCode, isValidCode } from "../../../../lib/growth/links";

export async function GET() {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  try {
    const links = await prisma.referralLink.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    return NextResponse.json({ links });
  } catch (error) {
    console.error("GET /api/admin/links failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const body = await request.json().catch(() => null);
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { code, campaign, ...data } = parsed.data;

  try {
    // A blank code means "mint one". A supplied one is re-checked against the
    // reserved list here, because the zod regex only proves the *shape* — it
    // cannot know that "api" would shadow a route.
    const finalCode = code ? code.toLowerCase() : await generateUniqueCode();
    if (!isValidCode(finalCode)) {
      return NextResponse.json({ error: "That code is reserved." }, { status: 400 });
    }

    const link = await prisma.referralLink.create({
      data: { ...data, code: finalCode, campaign: campaign || null },
    });
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "That code is already in use." }, { status: 409 });
    }
    console.error("POST /api/admin/links failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
