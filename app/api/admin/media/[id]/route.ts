import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../../lib/prisma";
import { requireAdminApi } from "../../../../../lib/api-guards";
import { isNotFoundError } from "../../../../../lib/prisma-errors";
import { getStorageConfig, deleteObject } from "../../../../../lib/storage/s3";

export const runtime = "nodejs";

const patchSchema = z.object({ alt: z.string().max(300) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  try {
    const asset = await prisma.mediaAsset.update({
      where: { id },
      data: { alt: parsed.data.alt },
    });
    return NextResponse.json({ asset });
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    console.error("PATCH /api/admin/media/[id] failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;
  const { id } = await params;

  try {
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    // Object first, row second. The other order can leave a row pointing at a
    // deleted object — a broken image in the library with no way to retry.
    // This order can leave an orphaned object, which costs a little storage
    // and nothing else, and the delete is retryable.
    const config = getStorageConfig();
    if (config) {
      const removed = await deleteObject(config, asset.key);
      if (!removed) {
        return NextResponse.json(
          { error: "Couldn't delete the stored file. The asset was kept." },
          { status: 502 },
        );
      }
    }

    await prisma.mediaAsset.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    console.error("DELETE /api/admin/media/[id] failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
