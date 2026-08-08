/**
 * P9 — file validation.
 *
 * The rule this file exists to enforce: a browser-supplied `type` and file
 * extension are claims, not facts. Both are trivially set to "image/webp" on
 * a file that is actually an HTML document or an SVG full of script — which,
 * served back from our own origin, is stored XSS. So the type is decided by
 * the leading bytes and nothing else, and the extension we store is derived
 * from that verdict rather than from the upload.
 */

export interface AllowedType {
  mime: string;
  extension: string;
  label: string;
  maxBytes: number;
}

const MB = 1024 * 1024;

/**
 * The allowlist. SVG is deliberately absent: it is an XML document that can
 * carry <script>, and there is no byte signature that distinguishes a safe one
 * from a hostile one. Vector assets belong in the repo, reviewed, not in a
 * user-facing upload path.
 */
export const ALLOWED_TYPES: AllowedType[] = [
  { mime: "image/webp", extension: "webp", label: "WebP", maxBytes: 8 * MB },
  { mime: "image/avif", extension: "avif", label: "AVIF", maxBytes: 8 * MB },
  { mime: "image/jpeg", extension: "jpg", label: "JPEG", maxBytes: 12 * MB },
  { mime: "image/png", extension: "png", label: "PNG", maxBytes: 12 * MB },
  { mime: "image/gif", extension: "gif", label: "GIF", maxBytes: 8 * MB },
  { mime: "application/pdf", extension: "pdf", label: "PDF", maxBytes: 20 * MB },
];

export const MAX_UPLOAD_BYTES = Math.max(...ALLOWED_TYPES.map((type) => type.maxBytes));

export function allowedTypeFor(mime: string): AllowedType | undefined {
  return ALLOWED_TYPES.find((type) => type.mime === mime.toLowerCase());
}

/** Comma-separated list for an <input type="file"> accept attribute. */
export function acceptAttribute(): string {
  return ALLOWED_TYPES.map((type) => type.mime).join(",");
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/**
 * Identify a file from its leading bytes.
 *
 * Returns null for anything not on the allowlist — including files whose
 * container we recognise but whose brand we don't (an AVIF-family `ftyp` that
 * is actually a video, say).
 */
export function sniffMimeType(bytes: Uint8Array): string | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  // GIF: "GIF87a" / "GIF89a"
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";

  // PDF: "%PDF-"
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";

  // RIFF container: "RIFF" ....(size) "WEBP"
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";

  // ISO-BMFF: 4-byte size, then "ftyp", then a brand. AVIF and HEIF share the
  // container, so the brand is what decides — and only still-image brands are
  // accepted, since `avis` is an image *sequence* (effectively a video).
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "mif1" || brand === "miaf") return "image/avif";
  }

  return null;
}

export interface ValidationSuccess {
  ok: true;
  type: AllowedType;
}

export interface ValidationFailure {
  ok: false;
  reason: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validate an upload's declared metadata against its actual first bytes.
 *
 * `declaredMime` is checked only so the error message can be specific about
 * the mismatch — the verdict itself comes from `header` every time.
 */
export function validateUpload(input: {
  header: Uint8Array;
  declaredMime: string;
  bytes: number;
}): ValidationResult {
  if (input.bytes <= 0) {
    return { ok: false, reason: "That file is empty." };
  }
  if (input.bytes > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / MB)}MB limit.`,
    };
  }

  const sniffed = sniffMimeType(input.header);
  if (!sniffed) {
    return {
      ok: false,
      reason: `That file type isn't supported. Allowed: ${ALLOWED_TYPES.map((t) => t.label).join(", ")}.`,
    };
  }

  const type = allowedTypeFor(sniffed);
  if (!type) {
    return { ok: false, reason: "That file type isn't supported." };
  }

  if (input.declaredMime && input.declaredMime.toLowerCase() !== sniffed) {
    // Not necessarily an attack — some browsers mislabel AVIF — but it is
    // always worth refusing, because the alternative is storing a file under
    // a content-type that does not describe it.
    return {
      ok: false,
      reason: `That file says it is ${input.declaredMime} but its contents are ${type.label}.`,
    };
  }

  if (input.bytes > type.maxBytes) {
    return {
      ok: false,
      reason: `${type.label} files are limited to ${Math.round(type.maxBytes / MB)}MB.`,
    };
  }

  return { ok: true, type };
}

/** Bytes of the header the client must send for sniffing to be conclusive. */
export const HEADER_BYTES = 16;
