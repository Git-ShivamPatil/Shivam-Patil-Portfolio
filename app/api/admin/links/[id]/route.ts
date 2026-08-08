import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireAdminApi } from "../../../../../lib/api-guards";
import { linkSchema } from "../../../../../lib/validations/link";
import { isNotFoundError, isUniqueConstraintError } from "../../../../../lib/prisma-errors";
import { isValidCode } from "../../../../../lib/growth/links";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  const { id } = await params;

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
    // Editing the code is allowed but re-validated: a rename that lands on a
    // reserved word would shadow a real route.
    if (code && !isValidCode(code.toLowerCase())) {
      return NextResponse.json({ error: "That code is reserved." }, { status: 400 });
    }

    const link = await prisma.referralLink.update({
      where: { id },
      data: {
        ...data,
        campaign: campaign || null,
        ...(code ? { code: code.toLowerCase() } : {}),
      },
    });
    return NextResponse.json({ link });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "That code is already in use." }, { status: 409 });
    }
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    console.error("PUT /api/admin/links/[id] failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  const { id } = await params;

  try {
    // Clicks cascade with the link (schema.prisma). That is intentional: a
    // deleted link's click rows are unattributable, and keeping orphans would
    // quietly skew every total on the dashboard.
    await prisma.referralLink.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    console.error("DELETE /api/admin/links/[id] failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
