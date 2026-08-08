/**
 * P9 — client-side image compression.
 *
 * The blueprint asks for "WebP/AVIF auto-compress". Doing that on the server
 * would mean `sharp` — a ~30MB native binary that has to cold-start inside a
 * serverless function, on a plan where that is the scarcest resource. Doing it
 * in the browser costs nothing on either side: the machine that already has
 * the file decodes it once, and what crosses the network is the *compressed*
 * result, so the upload is faster too.
 *
 * Encoder support is feature-detected rather than assumed. AVIF is smaller but
 * `canvas.toBlob` support is uneven, so the ladder is AVIF → WebP → original.
 * Falling back to the original is always safe: it was validated on the server
 * either way.
 */

export interface CompressOptions {
  /** Longest edge, in px. Larger images are scaled down proportionally. */
  maxDimension?: number;
  quality?: number;
  preferAvif?: boolean;
}

export interface CompressResult {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  originalBytes: number;
  compressedBytes: number;
}

const DEFAULT_MAX_DIMENSION = 2400;
const DEFAULT_QUALITY = 0.82;

/** Cached because it costs a canvas allocation and the answer never changes. */
let encoderSupport: Record<string, boolean> | null = null;

function supportsEncoding(mime: string): boolean {
  if (typeof document === "undefined") return false;
  if (encoderSupport?.[mime] !== undefined) return encoderSupport[mime];

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  // toDataURL falls back to image/png when it can't honour the request, so
  // the prefix is the actual test.
  const supported = canvas.toDataURL(mime).startsWith(`data:${mime}`);
  encoderSupport = { ...(encoderSupport ?? {}), [mime]: supported };
  return supported;
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/**
 * Compress an image file, returning the original untouched when compressing
 * would not help — a 40KB WebP re-encoded is usually *larger*, and a GIF would
 * lose its animation entirely.
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const {
    maxDimension = DEFAULT_MAX_DIMENSION,
    quality = DEFAULT_QUALITY,
    preferAvif = true,
  } = options;

  const unchanged = (width = 0, height = 0): CompressResult => ({
    blob: file,
    mime: file.type,
    width,
    height,
    originalBytes: file.size,
    compressedBytes: file.size,
  });

  // GIFs are animated; a canvas round-trip would silently flatten them to the
  // first frame. PDFs are not images at all.
  if (file.type === "image/gif" || file.type === "application/pdf") return unchanged();

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Undecodable here doesn't mean invalid — server-side validation is the
    // authority, so pass the bytes through rather than rejecting.
    return unchanged();
  }

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return unchanged(bitmap.width, bitmap.height);
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const candidates = [
    ...(preferAvif && supportsEncoding("image/avif") ? ["image/avif"] : []),
    ...(supportsEncoding("image/webp") ? ["image/webp"] : []),
  ];

  for (const mime of candidates) {
    const blob = await toBlob(canvas, mime, quality);
    // Only accept a re-encode that actually won. An already-optimised source
    // frequently comes out bigger, and shipping the bigger one would make
    // "auto-compress" a misnomer.
    if (blob && blob.size > 0 && (blob.size < file.size || scale < 1)) {
      return {
        blob,
        mime,
        width,
        height,
        originalBytes: file.size,
        compressedBytes: blob.size,
      };
    }
  }

  return unchanged(width, height);
}

/** SHA-256 of a blob, hex — the checksum used for dedupe and the object key. */
export async function checksumOf(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** First N bytes as a plain array, for the server's magic-byte check. */
export async function headerBytesOf(blob: Blob, count: number): Promise<number[]> {
  const slice = await blob.slice(0, count).arrayBuffer();
  return Array.from(new Uint8Array(slice));
}
