import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { withLease } from "./lock";

/**
 * P18 — the transactional outbox and its dead-letter queue.
 *
 * **The problem this solves is not "we need a queue".** It is that two writes
 * to different systems cannot be made atomic. A contact form that saves a row
 * and then sends an email has four outcomes, and two of them are wrong: the row
 * saved and the email vanished, or the email went and the row did not. Wrapping
 * them in a try/catch does not fix it — it just picks which failure to have.
 *
 * The outbox makes it one write. The event goes into the same database
 * transaction as the row, so either both are there or neither is, and a worker
 * turns events into side effects afterwards. The side effect becomes
 * *eventually* certain rather than immediately uncertain, which is the trade
 * every message broker is actually selling.
 *
 * **The DLQ is the part people skip.** Retrying forever turns one poison
 * message into a permanent load, and giving up silently loses it. `DEAD` is a
 * third state: stopped, kept, and countable — so `/api/metrics` can alert on it
 * and a human can look.
 */

export type OutboxTopic =
  | "contact.received"
  | "booking.confirmed"
  | "newsletter.confirmed"
  | "index.rebuild";

export const MAX_ATTEMPTS = 6;

/**
 * Backoff schedule, in seconds: 10s, 40s, 90s, 160s, 250s.
 *
 * Quadratic rather than exponential. Doubling reaches hours by the sixth
 * attempt, which for a portfolio's contact email means a message that fails
 * twice arrives tomorrow — technically delivered, practically lost. Quadratic
 * keeps the whole retry budget inside about ten minutes while still backing off
 * hard enough not to hammer a struggling upstream.
 */
export function backoffMs(attempts: number): number {
  return Math.min(attempts * attempts * 10_000, 600_000);
}

/**
 * Enqueue inside an existing transaction.
 *
 * Takes the transaction client rather than the global one, and that is the
 * entire point: called with `prisma` it would commit separately and the
 * atomicity this exists for would be gone.
 */
export function enqueueIn(
  tx: Prisma.TransactionClient,
  topic: OutboxTopic,
  payload: Prisma.InputJsonValue,
) {
  return tx.outboxEvent.create({ data: { topic, payload } });
}

/** Enqueue on its own, for callers with nothing to be atomic with. */
export async function enqueue(topic: OutboxTopic, payload: Prisma.InputJsonValue) {
  return prisma.outboxEvent.create({ data: { topic, payload } });
}

export interface DrainResult {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
}

export type Handler = (payload: unknown) => Promise<void>;

/**
 * Claim due events for this worker.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes two workers safe without a lock
 * between them: each takes rows the other has not, rather than blocking on the
 * same head of the queue. It is the standard Postgres queue primitive, and the
 * reason this needs no broker to be concurrent-safe.
 *
 * The lease around `drainOutbox` is belt and braces — this claim is already
 * correct on its own — but it keeps a slow run from stacking up behind itself
 * when the cron fires again.
 */
async function claim(limit: number): Promise<{ id: string; topic: string; payload: unknown; attempts: number }[]> {
  return prisma.$queryRaw`
    WITH due AS (
      SELECT "id" FROM "OutboxEvent"
      WHERE "status" = 'PENDING' AND "nextAttemptAt" <= NOW()
      ORDER BY "nextAttemptAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxEvent" AS o
    SET "attempts" = o."attempts" + 1
    FROM due
    WHERE o."id" = due."id"
    RETURNING o."id", o."topic", o."payload", o."attempts"
  `;
}

/**
 * Process one batch.
 *
 * Bounded by `limit` because this runs in a function with a wall clock. The
 * unprocessed remainder is not lost — it is still PENDING and due, so the next
 * run takes it.
 */
export async function drainOutbox(
  handlers: Record<string, Handler>,
  limit = 25,
): Promise<DrainResult> {
  const result: DrainResult = { claimed: 0, done: 0, retried: 0, dead: 0 };

  const outcome = await withLease(
    "outbox-drain",
    async () => {
      const events = await claim(limit);
      result.claimed = events.length;

      for (const event of events) {
        const handler = handlers[event.topic];

        // An unknown topic is dead on arrival rather than retried forever: no
        // number of retries will produce a handler that was never written.
        if (!handler) {
          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: "DEAD", lastError: `no handler for topic "${event.topic}"` },
          });
          result.dead += 1;
          continue;
        }

        try {
          await handler(event.payload);
          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: "DONE", processedAt: new Date(), lastError: null },
          });
          result.done += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const exhausted = event.attempts >= MAX_ATTEMPTS;

          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: exhausted
              ? { status: "DEAD", lastError: message.slice(0, 500) }
              : {
                  status: "PENDING",
                  nextAttemptAt: new Date(Date.now() + backoffMs(event.attempts)),
                  // Truncated, and only ever the message. The payload can carry
                  // a visitor's own words and has no business in an error log.
                  lastError: message.slice(0, 500),
                },
          });

          if (exhausted) result.dead += 1;
          else result.retried += 1;
        }
      }

      return result;
    },
    { ttlMs: 120_000 },
  );

  // Not an error: another worker holds the lease and is doing exactly this.
  return outcome.ran ? (outcome.result ?? result) : result;
}

/** Counts by status, for /api/metrics and the admin view. */
export async function outboxDepth(): Promise<Record<string, number>> {
  const rows = await prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

/**
 * Put a dead event back in the queue.
 *
 * A DLQ nobody can drain from is a bin. Attempts reset to zero because the
 * operator is asserting that whatever broke has been fixed.
 */
export async function replayDead(id: string) {
  return prisma.outboxEvent.update({
    where: { id },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
}
