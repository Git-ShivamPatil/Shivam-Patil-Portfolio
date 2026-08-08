import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { presignUrl, buildObjectKey, getStorageConfig } from "../lib/storage/s3";
import {
  sniffMimeType,
  validateUpload,
  ALLOWED_TYPES,
  allowedTypeFor,
} from "../lib/storage/validate";

/**
 * P9 — storage.
 *
 * Two things here are worth pinning hard. The signer, because a wrong
 * canonical request fails at R2 with an opaque 403 and no way to tell which
 * of the six inputs was wrong. And the validator, because it is the only
 * thing standing between "admin uploads a file" and "our origin serves
 * attacker-controlled content under a type we vouched for".
 */

const config = {
  accountEndpoint: "https://account.r2.cloudflarestorage.com",
  bucket: "portfolio",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "auto",
  publicBaseUrl: "https://cdn.example.com",
};

describe("presignUrl", () => {
  it("emits every parameter SigV4 requires", () => {
    const url = new URL(presignUrl(config, { key: "uploads/abc.webp" }));

    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(
      /^AKIAIOSFODNN7EXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/,
    );
    expect(url.searchParams.get("X-Amz-Date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses path-style addressing with the bucket first", () => {
    const url = new URL(presignUrl(config, { key: "uploads/abc.webp" }));
    expect(url.pathname).toBe("/portfolio/uploads/abc.webp");
    expect(url.host).toBe("account.r2.cloudflarestorage.com");
  });

  it("signs content-type when one is given, and not when it isn't", () => {
    const withType = new URL(
      presignUrl(config, { key: "k.webp", contentType: "image/webp" }),
    ).searchParams.get("X-Amz-SignedHeaders");
    const without = new URL(presignUrl(config, { key: "k.webp" })).searchParams.get(
      "X-Amz-SignedHeaders",
    );

    // Signing the type is what stops the browser uploading something other
    // than what the server validated.
    expect(withType).toBe("content-type;host");
    expect(without).toBe("host");
  });

  it("produces a different signature for a different key", () => {
    const a = new URL(presignUrl(config, { key: "a.webp" })).searchParams.get("X-Amz-Signature");
    const b = new URL(presignUrl(config, { key: "b.webp" })).searchParams.get("X-Amz-Signature");
    expect(a).not.toBe(b);
  });

  it("produces a different signature for a different method", () => {
    const put = new URL(presignUrl(config, { key: "a.webp", method: "PUT" })).searchParams.get(
      "X-Amz-Signature",
    );
    const del = new URL(presignUrl(config, { key: "a.webp", method: "DELETE" })).searchParams.get(
      "X-Amz-Signature",
    );
    expect(put).not.toBe(del);
  });

  it("keeps the signature out of the signed query string", () => {
    // X-Amz-Signature must not be part of the canonical query it signs —
    // including it is the classic way to build a signer that never verifies.
    const url = presignUrl(config, { key: "a.webp" });
    const beforeSignature = url.slice(0, url.indexOf("&X-Amz-Signature="));
    expect(beforeSignature).not.toContain("X-Amz-Signature");
  });

  it("percent-encodes reserved characters in the key", () => {
    const url = presignUrl(config, { key: "uploads/a b+c.webp" });
    expect(url).toContain("a%20b%2Bc.webp");
  });
});

describe("buildObjectKey", () => {
  it("is content-addressed, not filename-addressed", () => {
    const key = buildObjectKey("uploads", "a".repeat(64), "webp");
    expect(key).toBe(`uploads/${"a".repeat(32)}.webp`);
  });

  it("strips path traversal out of the folder and extension", () => {
    // A key is concatenated straight into the object path, so "../" here
    // would write outside the intended prefix.
    const key = buildObjectKey("../../etc", "b".repeat(64), "../sh");
    expect(key).not.toContain("..");
    expect(key).not.toContain("/etc");
    expect(key.startsWith("etc/")).toBe(true);
    expect(key.endsWith(".sh")).toBe(true);
  });

  it("falls back to sane defaults when both parts are stripped empty", () => {
    const key = buildObjectKey("///", "c".repeat(64), "!!!");
    expect(key).toBe(`uploads/${"c".repeat(32)}.bin`);
  });
});

describe("getStorageConfig", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns null when storage isn't configured, rather than throwing", () => {
    // The degradation rule: no keys means a read-only media library, not a
    // broken admin area.
    expect(getStorageConfig()).toBeNull();
  });

  it("returns null when the configuration is only partly set", () => {
    process.env.S3_ENDPOINT = "https://x.r2.cloudflarestorage.com";
    process.env.S3_BUCKET = "portfolio";
    expect(getStorageConfig()).toBeNull();
  });

  it("builds a config once every required key is present", () => {
    process.env.S3_ENDPOINT = "https://x.r2.cloudflarestorage.com/";
    process.env.S3_BUCKET = "portfolio";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";

    const result = getStorageConfig();
    expect(result).not.toBeNull();
    // Trailing slashes must be stripped or every URL gets a double slash.
    expect(result!.accountEndpoint).toBe("https://x.r2.cloudflarestorage.com");
    expect(result!.region).toBe("auto");
  });
});

describe("sniffMimeType", () => {
  const withHeader = (bytes: number[]) => Uint8Array.from([...bytes, ...new Array(16).fill(0)]);

  it("recognises each allowed image format by signature", () => {
    expect(sniffMimeType(withHeader([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMimeType(withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(sniffMimeType(withHeader([...Buffer.from("GIF89a")]))).toBe("image/gif");
    expect(sniffMimeType(withHeader([...Buffer.from("%PDF-1.7")]))).toBe("application/pdf");
  });

  it("requires the WEBP tag, not just a RIFF container", () => {
    const webp = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")];
    const wav = [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE")];
    expect(sniffMimeType(withHeader(webp))).toBe("image/webp");
    expect(sniffMimeType(withHeader(wav))).toBeNull();
  });

  it("accepts AVIF still-image brands and rejects the sequence brand", () => {
    const brand = (name: string) => withHeader([0, 0, 0, 0x20, ...Buffer.from("ftyp" + name)]);
    expect(sniffMimeType(brand("avif"))).toBe("image/avif");
    // `avis` is an image sequence — a video in an image's clothing.
    expect(sniffMimeType(brand("avis"))).toBeNull();
    expect(sniffMimeType(brand("mp42"))).toBeNull();
  });

  it("rejects SVG and HTML outright", () => {
    // Both are documents that can execute script when served from our origin.
    expect(sniffMimeType(withHeader([...Buffer.from("<svg xmlns=")]))).toBeNull();
    expect(sniffMimeType(withHeader([...Buffer.from("<!DOCTYPE html>")]))).toBeNull();
  });

  it("returns null for an empty or truncated header", () => {
    expect(sniffMimeType(new Uint8Array([]))).toBeNull();
    expect(sniffMimeType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("validateUpload", () => {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  it("accepts a well-formed upload", () => {
    const result = validateUpload({ header: png, declaredMime: "image/png", bytes: 1000 });
    expect(result.ok).toBe(true);
  });

  it("rejects a file whose bytes disagree with its declared type", () => {
    // The whole point: a PNG relabelled as PDF must not be stored as a PDF.
    const result = validateUpload({ header: png, declaredMime: "application/pdf", bytes: 1000 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("contents are PNG");
  });

  it("rejects a disallowed type regardless of what it claims to be", () => {
    const html = Uint8Array.from([...Buffer.from("<!DOCTYPE html>"), 0]);
    const result = validateUpload({ header: html, declaredMime: "image/png", bytes: 1000 });
    expect(result.ok).toBe(false);
  });

  it("rejects empty files", () => {
    expect(validateUpload({ header: png, declaredMime: "image/png", bytes: 0 }).ok).toBe(false);
  });

  it("enforces the per-type size ceiling, not just the global one", () => {
    // PNG's ceiling is 12MB while PDF's is 20MB, so a 15MB PNG is under the
    // global max and must still be refused.
    const result = validateUpload({
      header: png,
      declaredMime: "image/png",
      bytes: 15 * 1024 * 1024,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("PNG");
  });
});

describe("ALLOWED_TYPES", () => {
  it("does not include SVG", () => {
    expect(allowedTypeFor("image/svg+xml")).toBeUndefined();
  });

  it("maps every entry to a distinct extension", () => {
    const extensions = ALLOWED_TYPES.map((type) => type.extension);
    expect(new Set(extensions).size).toBe(extensions.length);
  });
});
