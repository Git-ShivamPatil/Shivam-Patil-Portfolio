import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma";
import { requireAdminApi } from "../../../../lib/api-guards";
import {
  getStorageConfig,
  presignUrl,
  publicUrlFor,
  buildObjectKey,
} from "../../../../lib/storage/s3";
import { validateUpload, HEADER_BYTES } from "../../../../lib/storage/validate";

export const runtime = "nodejs";

const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  bytes: z.number().int().positive(),
  // SHA-256 hex of the *compressed* blob — doubles as the dedupe key and the
  // object key, so it must be exactly 64 hex characters.
  checksum: z.string().regex(/^[a-f0-9]{64}$/, "Invalid checksum."),
  header: z.array(z.number().int().min(0).max(255)).min(HEADER_BYTES).max(64),
  folder: z.string().max(40).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  alt: z.string().max(300).optional(),
});

export async function GET() {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  try {
    const assets = await prisma.mediaAsset.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ assets, storageConfigured: getStorageConfig() !== null });
  } catch (error) {
    console.error("GET /api/admin/media failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

/**
 * Issue a presigned upload URL.
 *
 * The bytes go browser -> R2 directly; this route only decides *whether* they
 * may. That is why validation happens here on the header the client sends
 * rather than on the finished object: it is the last point we control before
 * the upload, and re-downloading the object afterwards to check it would cost
 * the bandwidth the direct upload was meant to save.
 */
export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const config = getStorageConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Object storage isn't configured. Set S3_* in the environment." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = uploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const input = parsed.data;

  const verdict = validateUpload({
    header: Uint8Array.from(input.header),
    declaredMime: input.contentType,
    bytes: input.bytes,
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 415 });
  }

  try {
    // Content-addressed: the same bytes are the same asset. Re-uploading a
    // file already in the library returns the existing row instead of paying
    // to store a second identical copy.
    const existing = await prisma.mediaAsset.findUnique({ where: { checksum: input.checksum } });
    if (existing) {
      return NextResponse.json({ asset: existing, duplicate: true, uploadUrl: null });
    }

    const key = buildObjectKey(input.folder ?? "uploads", input.checksum, verdict.type.extension);
    const uploadUrl = presignUrl(config, {
      key,
      method: "PUT",
      contentType: verdict.type.mime,
      expiresIn: 600,
    });

    return NextResponse.json({
      uploadUrl,
      key,
      // Sent back so the client PUTs with exactly the type that was signed —
      // a mismatch fails the signature check at R2.
      contentType: verdict.type.mime,
      publicUrl: publicUrlFor(config, key),
      duplicate: false,
    });
  } catch (error) {
    console.error("POST /api/admin/media failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

const confirmSchema = z.object({
  key: z.string().min(1).max(300),
  url: z.string().url(),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  bytes: z.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  folder: z.string().max(40).optional(),
  alt: z.string().max(300).optional(),
});

/**
 * Record an asset after the browser's PUT succeeded.
 *
 * Split from POST because the row must only exist once the object really
 * does. Writing it upfront would leave a library full of entries pointing at
 * 404s whenever an upload was cancelled mid-flight.
 */
export async function PUT(request: Request) {
  const guard = await requireAdminApi();
  if ("error" in guard) return guard.error;

  const body = await request.json().catch(() => null);
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { folder = "uploads", alt = "", ...data } = parsed.data;

  try {
    // Upsert, not create: a retried confirm after a flaky response must not
    // fail on the unique checksum.
    const asset = await prisma.mediaAsset.upsert({
      where: { checksum: data.checksum },
      create: {
        ...data,
        folder,
        alt,
        uploadedById: guard.session.user.id,
      },
      update: { alt },
    });
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    console.error("PUT /api/admin/media failed:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
