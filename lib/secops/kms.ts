import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * P22 — envelope encryption, the shape a KMS actually has.
 *
 * **Why not just encrypt the data with the master key.** Three reasons, and the
 * third is the one that decides it:
 *
 * 1. Every ciphertext under one key is more material for an attacker who ever
 *    obtains it, and AES-GCM has a hard limit on how many times one key may
 *    safely be used with random nonces (~2^32 before collision risk is real).
 * 2. A per-record key means compromising one record's key compromises one
 *    record.
 * 3. **Rotation.** Re-keying data encrypted directly under a master key means
 *    decrypting and re-encrypting every row. With envelopes, rotation only
 *    rewraps the small wrapped key — the bulk ciphertext is never touched, so
 *    rotating is O(rows) tiny writes instead of O(bytes) of the whole dataset.
 *    That difference is why every real KMS works this way.
 *
 * So: a random 256-bit data key (DEK) per record encrypts the payload, and the
 * master key encrypts the DEK. The stored envelope holds the wrapped DEK and
 * the ciphertext, never the DEK itself.
 *
 * **AES-256-GCM throughout**, so both layers are authenticated. CBC would
 * encrypt without detecting modification, which for a wrapped key means an
 * attacker can flip bits in the wrapped DEK and watch how the system fails —
 * a padding oracle with extra steps.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
/** 96 bits, which is what GCM is specified for; other lengths cost an extra GHASH pass. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Master keys, newest first, read from the environment.
 *
 * `KMS_MASTER_KEY` is version 1. `KMS_MASTER_KEY_V2`, `_V3` and so on are later
 * versions. Old versions must stay present after a rotation or every envelope
 * wrapped under them becomes undecryptable — which is the single most common
 * way a rotation causes an outage, and the reason this reads *all* versions
 * rather than one.
 */
function masterKeys(): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();

  const add = (version: number, raw: string | undefined) => {
    if (!raw) return;
    let key: Buffer;
    try {
      key = Buffer.from(raw, "base64");
    } catch {
      console.error(`[kms] master key v${version} is not valid base64 — ignoring`);
      return;
    }
    if (key.length !== KEY_BYTES) {
      // Loud, and without the value. A short key silently truncated or padded
      // would "work" while providing a fraction of the intended strength.
      console.error(
        `[kms] master key v${version} is ${key.length} bytes, expected ${KEY_BYTES} — ignoring`,
      );
      return;
    }
    keys.set(version, key);
  };

  add(1, process.env.KMS_MASTER_KEY);
  for (let version = 2; version <= 8; version += 1) {
    add(version, process.env[`KMS_MASTER_KEY_V${version}`]);
  }
  return keys;
}

export function isKmsConfigured(): boolean {
  return masterKeys().size > 0;
}

/** Version numbers currently loadable, ascending. */
export function availableKeyVersions(): number[] {
  return [...masterKeys().keys()].sort((a, b) => a - b);
}

/** The version new envelopes are wrapped under — always the highest available. */
export function currentKeyVersion(): number | null {
  const versions = availableKeyVersions();
  return versions.length === 0 ? null : versions[versions.length - 1];
}

export interface Envelope {
  /** Master key version the DEK is wrapped under. */
  v: number;
  /** DEK, encrypted under the master key. base64. */
  key: string;
  /** IV for the payload. base64. */
  iv: string;
  /** GCM tag for the payload. base64. */
  tag: string;
  /** The payload. base64. */
  data: string;
}

export class KmsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmsError";
  }
}

function requireKey(version: number): Buffer {
  const key = masterKeys().get(version);
  if (!key) {
    throw new KmsError(
      `no master key for version ${version} — it was removed from the environment while envelopes still reference it`,
    );
  }
  return key;
}

/** Wrap a DEK under a master key. Returns `iv || tag || ciphertext`, base64. */
function wrapKey(dek: Buffer, master: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, master, iv);
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), wrapped]).toString("base64");
}

function unwrapKey(wrapped: string, master: Buffer): Buffer {
  const raw = Buffer.from(wrapped, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new KmsError("wrapped key is truncated");

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, master, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // GCM's tag check failed. Never echo the reason or any partial plaintext —
    // distinguishing "wrong key" from "tampered ciphertext" is exactly the
    // oracle an attacker wants.
    throw new KmsError("wrapped key failed authentication");
  }
}

/**
 * Encrypt under a fresh data key.
 *
 * `aad` is bound into the payload's authentication tag without being encrypted.
 * Pass the record's identity — "booking:abc123" — and a ciphertext moved from
 * one row to another stops decrypting. Without it, an attacker with database
 * write access can swap two users' encrypted fields and both still decrypt
 * perfectly, because confidentiality was never the property that would have
 * caught it.
 */
export function encrypt(plaintext: string, aad?: string): Envelope {
  const version = currentKeyVersion();
  if (version === null) throw new KmsError("no master key configured");
  const master = requireKey(version);

  const dek = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dek, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));

  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    v: version,
    key: wrapKey(dek, master),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function decrypt(envelope: Envelope, aad?: string): string {
  const dek = unwrapKey(envelope.key, requireKey(envelope.v));

  const decipher = createDecipheriv(ALGORITHM, dek, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new KmsError("payload failed authentication");
  }
}

/**
 * Rotate an envelope to the newest master key.
 *
 * **The payload is never decrypted.** Only the wrapped DEK is unwrapped under
 * the old master and rewrapped under the new one, so rotating a million rows
 * touches a million ~60-byte fields rather than a million payloads — and the
 * plaintext never exists in memory during a rotation, which is the property
 * that makes running one on production defensible.
 *
 * Returns the envelope unchanged when it is already current, so a rotation
 * sweep is idempotent and can be re-run after an interruption.
 */
export function rewrap(envelope: Envelope): { envelope: Envelope; rotated: boolean } {
  const target = currentKeyVersion();
  if (target === null) throw new KmsError("no master key configured");
  if (envelope.v === target) return { envelope, rotated: false };

  const dek = unwrapKey(envelope.key, requireKey(envelope.v));
  const rewrapped = wrapKey(dek, requireKey(target));
  // Zero the unwrapped DEK. Not a strong guarantee in a GC'd runtime — V8 may
  // have copied it — but it costs nothing and shortens the window where a heap
  // dump contains a live data key.
  dek.fill(0);

  return { envelope: { ...envelope, v: target, key: rewrapped }, rotated: true };
}

/** Envelopes older than the current version, i.e. what a rotation sweep would touch. */
export function needsRotation(envelope: Envelope): boolean {
  const target = currentKeyVersion();
  return target !== null && envelope.v < target;
}

/**
 * Constant-time comparison of two secrets.
 *
 * Exported because the codebase already hand-rolls this in a couple of places
 * with a length guard in front, and getting that guard wrong (`timingSafeEqual`
 * throws rather than returning false on a length mismatch) is a live footgun.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
