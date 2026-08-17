import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

/**
 * P22 — mutual authentication, moved from the transport layer to the
 * application layer.
 *
 * **Why this is not mTLS, stated first so nothing here is mistaken for it.**
 * Real mutual TLS authenticates the *connection*: the client presents a
 * certificate during the handshake, the server validates it against a CA, and
 * every byte afterwards is attributable before a single application byte is
 * read. That is a property of the TLS terminator. On Vercel, TLS is terminated
 * by the platform's edge and the client certificate — if one were even
 * requested — is never surfaced to the function. The blueprint's Envoy/Kong
 * gateway is where this would live, and there is no gateway here.
 *
 * So this authenticates the *request* instead, with a detached signature the
 * server verifies before doing any work. Compared with mTLS:
 *
 * - **It still proves who is calling**, cryptographically, with a private key
 *   that never crosses the wire — the actual security goal.
 * - **It also binds the request body**, which mTLS does not. mTLS authenticates
 *   the channel; anything the authenticated client sends down it is trusted.
 *   A signature over the body means a compromised proxy cannot alter a request
 *   it is permitted to forward.
 * - **It does not protect the handshake or metadata**, and it authenticates per
 *   request rather than per connection, so it pays a signature verification on
 *   every call where mTLS pays one per connection.
 * - **It cannot reject an unauthenticated peer before the request body is
 *   read**, which is a real DoS difference.
 *
 * Ed25519 rather than RSA or HMAC: signatures are 64 bytes, verification is
 * fast enough to sit on a request path, and unlike HMAC the verifying side
 * never holds a secret capable of *producing* a signature — so a compromise of
 * this server does not let an attacker impersonate a client to anyone else.
 */

/** How far a request's timestamp may be from ours before it is refused. */
export const CLOCK_SKEW_MS = 5 * 60_000;

export interface SignedRequestParts {
  method: string;
  /** Path and query, no scheme or host. */
  path: string;
  /** Raw request body, exactly as it will be transmitted. */
  body: string;
  /** Milliseconds since the epoch. */
  timestamp: number;
  /** Unique per request, for replay detection. */
  nonce: string;
  /** Which key signed it. */
  keyId: string;
}

/**
 * The bytes that get signed.
 *
 * Length-prefixed for the same reason the audit ledger's canonical form is: a
 * delimiter-joined string lets one field's contents impersonate a field
 * boundary, so `POST|/a/b|…` and `POST|/a|b|…` would sign identically. With a
 * signature that is not a cosmetic bug — it means an attacker who controls part
 * of one field can move the boundary and have the server authenticate a request
 * that was never made.
 *
 * The body is hashed rather than included, so signing does not require holding
 * a whole upload in memory twice, and the canonical string stays a fixed size.
 */
export function canonicalRequest(parts: SignedRequestParts): string {
  const bodyHash = createHash("sha256").update(parts.body, "utf8").digest("hex");
  const fields = [
    parts.method.toUpperCase(),
    parts.path,
    bodyHash,
    String(parts.timestamp),
    parts.nonce,
    parts.keyId,
  ];
  return fields.map((field) => `${field.length}:${field}`).join("");
}

/** Sign with a PEM-encoded Ed25519 private key. */
export function signRequest(parts: SignedRequestParts, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  // Ed25519 signs the message directly — the algorithm argument must be null,
  // because Ed25519 does its own hashing internally and passing a digest name
  // is an error rather than a preference.
  return sign(null, Buffer.from(canonicalRequest(parts), "utf8"), key).toString("base64");
}

export type VerdictReason =
  "ok" | "unknown-key" | "bad-signature" | "expired" | "future-dated" | "replayed" | "malformed";

export interface VerifyOptions {
  /** Public keys by key id, PEM-encoded. */
  keys: Map<string, string>;
  /** Returns true if the nonce has been seen. Must record it as a side effect. */
  seenNonce?: (nonce: string) => boolean;
  now?: number;
}

export interface SignatureVerdict {
  ok: boolean;
  reason: VerdictReason;
  keyId: string | null;
}

/**
 * Verify a signed request.
 *
 * **Order matters.** Cheap structural checks first, then the timestamp, then
 * the replay check, and the signature last — verification is the most expensive
 * step, so an attacker who can make the server do it for free on garbage has a
 * cheap amplification. The one thing that must NOT be reordered is the replay
 * check: it has to happen after the signature would have been valid but before
 * the caller acts, and here it sits before verification only because the nonce
 * store is cheaper and a replayed request is rejected either way.
 *
 * Every failure returns the same shape and the caller is expected to answer
 * with one status. Telling a caller *which* check they failed hands them a
 * tuning oracle — "the timestamp was fine but the signature was wrong" tells an
 * attacker their clock work succeeded.
 */
export function verifyRequest(
  parts: SignedRequestParts,
  signature: string,
  options: VerifyOptions,
): SignatureVerdict {
  const now = options.now ?? Date.now();

  if (!parts.keyId || !parts.nonce || !Number.isFinite(parts.timestamp)) {
    return { ok: false, reason: "malformed", keyId: null };
  }

  const publicKeyPem = options.keys.get(parts.keyId);
  if (!publicKeyPem) return { ok: false, reason: "unknown-key", keyId: parts.keyId };

  const age = now - parts.timestamp;
  if (age > CLOCK_SKEW_MS) return { ok: false, reason: "expired", keyId: parts.keyId };
  // Future-dated is rejected too. Without it, a captured request could be
  // signed with a timestamp hours ahead and replayed later, and the window
  // would be an attacker-chosen length rather than ours.
  if (age < -CLOCK_SKEW_MS) return { ok: false, reason: "future-dated", keyId: parts.keyId };

  if (options.seenNonce?.(parts.nonce)) {
    return { ok: false, reason: "replayed", keyId: parts.keyId };
  }

  let valid = false;
  try {
    valid = verify(
      null,
      Buffer.from(canonicalRequest(parts), "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, "base64"),
    );
  } catch {
    // A malformed key or signature encoding. Same answer as an invalid
    // signature — the caller learns only that it did not authenticate.
    return { ok: false, reason: "bad-signature", keyId: parts.keyId };
  }

  return valid
    ? { ok: true, reason: "ok", keyId: parts.keyId }
    : { ok: false, reason: "bad-signature", keyId: parts.keyId };
}

/**
 * A bounded nonce cache.
 *
 * **Per-instance, and that is a real hole rather than a simplification.** On
 * serverless, a replayed request routed to a different instance sees an empty
 * cache and is accepted. The timestamp window bounds the damage to
 * CLOCK_SKEW_MS, and closing it properly needs shared state — Redis `SET NX EX`
 * keyed on the nonce, with the TTL set to the skew window, which is the same
 * shape lib/rate-limit.ts already uses. Stated here because a replay cache that
 * quietly does not work across instances is worse than none: it invites the
 * assumption that replay is handled.
 *
 * The TTL only needs to cover the skew window. A nonce older than that is
 * already rejected by the timestamp check, so remembering it longer costs
 * memory to duplicate a check that already happened.
 */
export function createNonceCache(windowMs = CLOCK_SKEW_MS, maxEntries = 10_000) {
  const seen = new Map<string, number>();

  return (nonce: string, now = Date.now()): boolean => {
    // Sweep before checking, so an expired nonce is genuinely forgotten rather
    // than reported as replayed.
    if (seen.size > maxEntries) {
      for (const [key, at] of seen) {
        if (now - at > windowMs) seen.delete(key);
      }
      // Still full after sweeping: the window is saturated with live nonces.
      // Dropping the oldest is the only option that keeps this bounded, and it
      // is the point at which replay protection is genuinely degraded — so it
      // is loud.
      if (seen.size > maxEntries) {
        console.error(`[signing] nonce cache saturated at ${seen.size} — replay window degraded`);
        const oldest = [...seen.entries()].sort((a, b) => a[1] - b[1]).slice(0, maxEntries / 2);
        for (const [key] of oldest) seen.delete(key);
      }
    }

    const previous = seen.get(nonce);
    if (previous !== undefined && now - previous <= windowMs) return true;

    seen.set(nonce, now);
    return false;
  };
}
