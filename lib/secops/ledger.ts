import { createHash } from "node:crypto";
import { prisma } from "../prisma";

/**
 * P22 — the hash-chained audit ledger.
 *
 * Every entry commits to the one before it, so editing history is detectable:
 * change any field of any row and its hash no longer matches, and neither does
 * every hash after it.
 *
 * **Tamper-evident, not tamper-proof, and the difference matters.** Anyone with
 * write access to Postgres can edit a row *and recompute the rest of the
 * chain*, producing a ledger that verifies perfectly. A hash chain alone buys
 * exactly one thing: an attacker cannot make a *quiet* edit. Making it
 * tamper-proof requires publishing the chain head somewhere they do not control
 * — a notary, a counterparty, a transparency log. Nothing here does that, and
 * `/security` says so rather than implying otherwise.
 */

/** The prevHash of the first entry. Sixty-four zeros, so the genesis row is obvious. */
export const GENESIS_HASH = "0".repeat(64);

export interface LedgerRecord {
  seq: number;
  actor: string;
  action: string;
  target: string | null;
  metadata: unknown;
  prevHash: string;
  createdAt: Date;
}

/**
 * Canonical bytes for one entry.
 *
 * **The whole security of the chain is in this function being unambiguous.** If
 * two different entries can serialise to the same string, the chain proves
 * nothing about which one was recorded. So every field is length-prefixed
 * rather than delimiter-joined: with `actor|action`, an actor literally named
 * `a|b` and an action `c` produce the same bytes as actor `a` and action `b|c`.
 * That is not a hypothetical — it is the standard way length-extension and
 * field-splitting bugs get into hashing code.
 *
 * `JSON.stringify` on metadata is stable enough here because the object is
 * built by this codebase and re-serialised from the same Prisma JSON value on
 * verify. It would NOT be safe if metadata came from a client, where key order
 * is attacker-controlled — noted because that is exactly the kind of assumption
 * that stops being true later.
 */
export function canonicalise(
  record: Omit<LedgerRecord, "createdAt"> & { createdAt: Date },
): string {
  const parts = [
    String(record.seq),
    record.actor,
    record.action,
    record.target ?? "",
    JSON.stringify(record.metadata ?? null),
    record.prevHash,
    record.createdAt.toISOString(),
  ];
  return parts.map((part) => `${part.length}:${part}`).join("");
}

export function hashEntry(record: LedgerRecord): string {
  return createHash("sha256").update(canonicalise(record), "utf8").digest("hex");
}

/**
 * Advisory lock key for the ledger.
 *
 * An arbitrary constant — Postgres advisory locks are just a namespace of
 * 64-bit integers, and this one is only ever taken by the function below.
 */
const LEDGER_LOCK = 0x5ec0_9a11;

export interface AppendInput {
  actor: string;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append one entry, under a lock.
 *
 * **The lock is the correctness argument, not a performance detail.** Appending
 * means "read the current head, hash against it, insert". Two concurrent
 * appends both read the same head and both write entries claiming the same
 * `prevHash` — a forked chain, which verification then reports as corruption
 * even though nothing was tampered with. Serialisable isolation would also fix
 * it, at the cost of retry loops on every writer; a transaction-scoped advisory
 * lock is cheaper and says what it means.
 *
 * `pg_advisory_xact_lock` rather than `pg_advisory_lock`: the transaction-scoped
 * form releases when the transaction ends, including when it aborts. The
 * session-scoped form would leak a held lock on any error path and deadlock
 * every subsequent append — and on a pooled connection it would leak into
 * whichever request got that connection next.
 */
export async function append(input: AppendInput): Promise<{ seq: number; hash: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LEDGER_LOCK})`;

    const head = await tx.auditEntry.findFirst({
      orderBy: { seq: "desc" },
      select: { hash: true },
    });

    const prevHash = head?.hash ?? GENESIS_HASH;

    // The row is created first so the database assigns `seq` and `createdAt`,
    // then hashed and updated with the result. Hashing before insert would mean
    // guessing both — and a hash computed over a guessed timestamp is a hash
    // over something that is not what got stored.
    const created = await tx.auditEntry.create({
      data: {
        actor: input.actor,
        action: input.action,
        target: input.target ?? null,
        metadata: (input.metadata ?? {}) as never,
        prevHash,
        hash: "",
      },
    });

    const hash = hashEntry({
      seq: created.seq,
      actor: created.actor,
      action: created.action,
      target: created.target,
      metadata: created.metadata,
      prevHash: created.prevHash,
      createdAt: created.createdAt,
    });

    await tx.auditEntry.update({ where: { seq: created.seq }, data: { hash } });
    return { seq: created.seq, hash };
  });
}

/**
 * Record an event without ever failing the thing being recorded.
 *
 * Used from request paths. An audit write that can 500 a booking has made the
 * system less reliable in the name of accountability, which is the wrong trade
 * for this application — the ledger here records interesting events, it is not
 * a regulatory requirement where the correct behaviour would be to refuse the
 * operation instead.
 */
export async function record(input: AppendInput): Promise<void> {
  try {
    await append(input);
  } catch (error) {
    console.error(
      `[ledger] could not record ${input.action}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export type ChainFault =
  | { kind: "hash-mismatch"; seq: number; expected: string; found: string }
  | { kind: "broken-link"; seq: number; expected: string; found: string }
  | { kind: "sequence-gap"; seq: number; after: number };

export interface VerifyResult {
  ok: boolean;
  checked: number;
  faults: ChainFault[];
  head: string | null;
}

/**
 * Recompute the chain and report every fault, not just the first.
 *
 * Stopping at the first mismatch would be enough to answer "is this ledger
 * intact", and useless for the question actually asked after a breach, which is
 * "what was changed". A single edited row produces one `hash-mismatch` at that
 * row and one `broken-link` at the next; a wholesale rewrite produces a
 * mismatch at every row. The shape of the fault list is the diagnosis.
 */
export function verifyChain(entries: (LedgerRecord & { hash: string })[]): VerifyResult {
  const faults: ChainFault[] = [];
  let previous: (LedgerRecord & { hash: string }) | null = null;

  for (const entry of entries) {
    const expected = hashEntry(entry);
    if (expected !== entry.hash) {
      faults.push({ kind: "hash-mismatch", seq: entry.seq, expected, found: entry.hash });
    }

    const expectedPrev = previous ? previous.hash : GENESIS_HASH;
    if (entry.prevHash !== expectedPrev) {
      faults.push({
        kind: "broken-link",
        seq: entry.seq,
        expected: expectedPrev,
        found: entry.prevHash,
      });
    }

    // A gap means rows were deleted. The chain would still link correctly if an
    // attacker deleted a contiguous run and re-hashed, so this is only a signal
    // when the sequence itself is trusted — but a gap with intact hashes either
    // side is a strong sign of exactly that rewrite.
    if (previous && entry.seq !== previous.seq + 1) {
      faults.push({ kind: "sequence-gap", seq: entry.seq, after: previous.seq });
    }

    previous = entry;
  }

  return {
    ok: faults.length === 0,
    checked: entries.length,
    faults,
    head: previous?.hash ?? null,
  };
}

/** Read the whole chain and verify it. */
export async function verifyLedger(limit = 500): Promise<VerifyResult & { entries: number }> {
  const entries = await prisma.auditEntry.findMany({ orderBy: { seq: "asc" }, take: limit });
  const result = verifyChain(entries);
  return { ...result, entries: entries.length };
}

export async function recentEntries(limit = 25) {
  return prisma.auditEntry.findMany({ orderBy: { seq: "desc" }, take: limit });
}
