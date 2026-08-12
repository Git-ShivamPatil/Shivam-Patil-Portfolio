import { z } from "zod";

/**
 * P11 — the heartbeat payload.
 *
 * Anonymous and row-writing, so every field is bounded at the schema boundary
 * before it reaches a column. `token` is the strictest of them because it is
 * the table's unique key: an unbounded string here would let a caller choose
 * their own row identifiers and mint one per request.
 */
export const heartbeatSchema = z.object({
  /** `crypto.randomUUID()` with the dashes removed. */
  token: z.string().regex(/^[0-9a-f]{32}$/),
  /** Normalised client-side and re-normalised server-side; see lib/analytics/normalize.ts. */
  path: z.string().min(1).max(512),
  /** Set on `pagehide` so a leaving tab frees its row instead of waiting out the TTL. */
  leaving: z.boolean().optional(),
});

export type HeartbeatPayload = z.infer<typeof heartbeatSchema>;
