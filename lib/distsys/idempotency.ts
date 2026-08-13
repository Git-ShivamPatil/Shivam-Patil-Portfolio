import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";

/**
 * P18 — `Idempotency-Key`, generalised.
 *
 * P7 already keys payment creation on one, which is where the money is. This
 * makes it available to any POST route: a client that never saw the response —
 * because the connection dropped, or the phone changed networks mid-submit —
 * can retry with the same key and get **the original response**, not a second
 * contact message.
 *
 * **Returning the stored response is the whole feature.** Answering a repeat
 * with 409 would be correct and useless: the client retried precisely because
 * it does not know what happened, so the only helpful reply is what happened.
 *
 * **The request hash is the safety catch.** A key reused with a *different*
 * body is a bug in the caller — usually a key generated once and reused for
 * every request — and replaying the old response would hide it forever. That
 * gets a 422 instead, which is the same thing Stripe does and for the same
 * reason.
 */

/** How long a key is honoured. Long enough for any retry, short enough to prune. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Bounded because it lands in a primary key from an untrusted header. */
const MAX_KEY_LENGTH = 200;

export function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function isValidKey(key: string | null): key is string {
  return typeof key === "string" && key.length >= 8 && key.length <= MAX_KEY_LENGTH;
}

export type IdempotencyOutcome =
  | { kind: "fresh" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" };

/**
 * Check a key before doing the work.
 *
 * Note what this does *not* do: it does not reserve the key. Two genuinely
 * concurrent requests with the same key can both see "fresh" and both proceed —
 * which is why `remember` below inserts rather than upserts, and why the caller
 * treats a unique-violation there as "someone else got there first". Reserving
 * up front would need the reservation and the work to be one transaction, and
 * the work here includes sending email.
 */
export async function checkIdempotency(
  key: string,
  route: string,
  requestHash: string,
): Promise<IdempotencyOutcome> {
  try {
    const existing = await prisma.idempotencyRecord.findUnique({ where: { key } });
    if (!existing) return { kind: "fresh" };

    // Expired records are treated as absent rather than deleted here: the prune
    // job owns deletion, and a read path that writes is a read path that can
    // fail under load.
    if (existing.expiresAt.getTime() < Date.now()) return { kind: "fresh" };

    // Same key, different route or different body.
    if (existing.route !== route || existing.requestHash !== requestHash) {
      return { kind: "conflict" };
    }

    return { kind: "replay", status: existing.status, body: existing.response };
  } catch (error) {
    // Degrade to non-idempotent rather than refusing the request. The failure
    // mode of "no replay protection" is a duplicate; the failure mode of
    // "reject everything" is an outage.
    console.error(
      `[idempotency] lookup failed, proceeding without: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { kind: "fresh" };
  }
}

/** Store the response so a retry can be answered with it. */
export async function remember(
  key: string,
  route: string,
  requestHash: string,
  status: number,
  response: Prisma.InputJsonValue,
): Promise<void> {
  try {
    await prisma.idempotencyRecord.create({
      data: {
        key,
        route,
        requestHash,
        status,
        response,
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });
  } catch {
    // A unique violation means a concurrent request with the same key stored
    // its response first. Both did the work — that race is inherent without a
    // reservation — but the client will at least get one consistent answer on
    // any later retry.
  }
}

/** Drop expired records. Called by the retention cron. */
export async function pruneIdempotency(now = Date.now(), batch = 2_000): Promise<number> {
  const stale = await prisma.idempotencyRecord.findMany({
    where: { expiresAt: { lt: new Date(now) } },
    select: { key: true },
    take: batch,
  });
  if (stale.length === 0) return 0;
  const result = await prisma.idempotencyRecord.deleteMany({
    where: { key: { in: stale.map((row) => row.key) } },
  });
  return result.count;
}
