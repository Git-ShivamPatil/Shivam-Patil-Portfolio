import { NextResponse } from "next/server";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import { checkIdempotency, hashBody, isValidKey, remember } from "./idempotency";
import { enqueueIn, type OutboxTopic } from "./outbox";

/**
 * P18 — the command boundary.
 *
 * The blueprint's write path is
 * `CQRS-Commands -> Redlock -> Idempotency-Key -> PostgreSQL -> DomainEvents`.
 * Most of those pieces already existed here in separate places; this is the one
 * function that runs them in that order, so a new write path gets all of it by
 * construction rather than by remembering.
 *
 * **What CQRS actually buys, in this codebase.** Not two databases and a
 * projection lag — that would be architecture cosplay at this size. It is the
 * discipline that a command returns *whether it was accepted*, and reads are a
 * separate path with their own shapes. lib/analytics/report.ts and
 * lib/realtime/live.ts are already pure read models over ledgers something else
 * writes; this names the write half.
 *
 * The ordering is not arbitrary:
 *
 * 1. **Idempotency first**, because a replay must not do any work at all — not
 *    even take a lock.
 * 2. **The transaction second**, with the domain event written *inside* it. That
 *    is the whole outbox pattern: the row and the intent to react to it commit
 *    together or not at all.
 * 3. **Remember the response last**, after the commit. Storing it before would
 *    let a retry replay a success that then rolled back.
 */

export interface CommandContext<TInput> {
  input: TInput;
  /** The transaction the handler must use — not the global client. */
  tx: Prisma.TransactionClient;
  /** Queue a domain event atomically with this command's writes. */
  emit: (topic: OutboxTopic, payload: Prisma.InputJsonValue) => Promise<unknown>;
}

export interface CommandResult {
  status: number;
  body: Prisma.InputJsonValue;
}

export interface CommandDefinition<TInput> {
  /** Used to scope idempotency keys, so two routes cannot collide on one key. */
  route: string;
  handler: (context: CommandContext<TInput>) => Promise<CommandResult>;
  /**
   * Transaction timeout. Deliberately short: a command holding a transaction
   * open while it waits on a third party is how a connection pool dies, and the
   * outbox exists precisely so it does not have to.
   */
  timeoutMs?: number;
}

/**
 * Run a command.
 *
 * `idempotencyKey` is whatever the caller sent in the header. An absent or
 * malformed key means the command simply runs without replay protection —
 * refusing would break every existing client, and the header is optional by
 * design.
 */
export async function runCommand<TInput>(
  definition: CommandDefinition<TInput>,
  input: TInput,
  options: { idempotencyKey?: string | null; rawBody?: string } = {},
): Promise<NextResponse> {
  const key = isValidKey(options.idempotencyKey ?? null) ? options.idempotencyKey! : null;
  const requestHash = hashBody(options.rawBody ?? JSON.stringify(input));

  if (key) {
    const outcome = await checkIdempotency(key, definition.route, requestHash);
    if (outcome.kind === "replay") {
      return NextResponse.json(outcome.body as Prisma.JsonValue, {
        status: outcome.status,
        // Says plainly that nothing new happened. A client debugging a retry
        // loop otherwise cannot tell a replay from a second execution.
        headers: { "Idempotency-Replayed": "true" },
      });
    }
    if (outcome.kind === "conflict") {
      return NextResponse.json(
        {
          error:
            "This Idempotency-Key was already used with a different request body. Use a new key per distinct request.",
        },
        { status: 422 },
      );
    }
  }

  let result: CommandResult;
  try {
    result = await prisma.$transaction(
      async (tx) =>
        definition.handler({
          input,
          tx,
          emit: (topic, payload) => enqueueIn(tx, topic, payload),
        }),
      { timeout: definition.timeoutMs ?? 10_000 },
    );
  } catch (error) {
    console.error(`[command] ${definition.route} failed:`, error);
    // Nothing is remembered on failure: a retry with the same key should be
    // allowed to actually retry.
    return NextResponse.json({ error: "Could not complete that request." }, { status: 500 });
  }

  // After the commit, and only for outcomes worth replaying. Remembering a 500
  // would pin a transient failure to that key for a day.
  if (key && result.status < 500) {
    await remember(key, definition.route, requestHash, result.status, result.body);
  }

  return NextResponse.json(result.body as Prisma.JsonValue, { status: result.status });
}
