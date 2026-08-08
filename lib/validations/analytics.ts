import { z } from "zod";
import {
  GRID_X,
  GRID_Y,
  MAX_EVENTS_PER_BATCH,
  MAX_LABEL_LENGTH,
  MAX_PATH_LENGTH,
  MAX_TARGET_LENGTH,
} from "../analytics/constants";

/**
 * P10 — the ingest payload.
 *
 * Every bound in this file exists because `/api/analytics/collect` is
 * **anonymous and writes rows**. The rate limiter caps how many requests a
 * caller can make; this schema caps how much damage any one accepted request
 * can do. Without the array caps a single 200-response request could insert
 * thousands of rows, which is a far cheaper attack than sending thousands of
 * requests.
 *
 * `.strict()` throughout: an unexpected key means the client and server have
 * drifted, and silently ignoring it is how a field ends up quietly never being
 * recorded.
 */

/**
 * One aggregated heatmap cell.
 *
 * The browser pre-aggregates — five clicks in the same cell arrive as one
 * entry with `n: 5` rather than five entries. That keeps the batch small and,
 * more importantly, means the wire format carries no ordering: the sequence in
 * which someone clicked around a page is a behavioural trail, and there is no
 * reason for it to leave the browser.
 */
const cellSchema = z
  .object({
    x: z
      .number()
      .int()
      .min(0)
      .max(GRID_X - 1),
    y: z
      .number()
      .int()
      .min(0)
      .max(GRID_Y - 1),
    // Capped so one payload cannot claim a cell was clicked a million times.
    n: z.number().int().min(1).max(50),
  })
  .strict();

const eventSchema = z
  .object({
    type: z.enum(["click", "download", "outbound", "rage"]),
    target: z.string().min(1).max(MAX_TARGET_LENGTH),
    label: z.string().max(MAX_LABEL_LENGTH).optional(),
    path: z.string().max(MAX_PATH_LENGTH).optional(),
  })
  .strict();

export const collectSchema = z
  .object({
    /**
     * Browser-minted id for this navigation, and the row's idempotency key.
     * Bounded to the shape of a UUID plus slack — it is only ever compared for
     * equality, so anything longer is storage with no purpose.
     */
    viewId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Invalid view id."),
    path: z.string().min(1).max(MAX_PATH_LENGTH),
    referrer: z.string().max(500).optional(),
    /** IANA zone from the browser — a fallback for when the edge has no geo. */
    timezone: z.string().max(40).optional(),
    /** Visible dwell time. Re-clamped server-side; this only rejects nonsense. */
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .optional(),
    scrollDepth: z.number().int().min(0).max(100).optional(),
    cells: z.array(cellSchema).max(MAX_EVENTS_PER_BATCH).optional(),
    events: z.array(eventSchema).max(MAX_EVENTS_PER_BATCH).optional(),
  })
  .strict();

export type CollectPayload = z.infer<typeof collectSchema>;
export type CollectCell = z.infer<typeof cellSchema>;
export type CollectEvent = z.infer<typeof eventSchema>;
