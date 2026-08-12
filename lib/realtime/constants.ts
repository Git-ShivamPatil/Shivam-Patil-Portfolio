/**
 * P11 — realtime constants and payload shapes.
 *
 * Separate from `presence.ts` for one concrete reason: `presence.ts` imports
 * Prisma, and the browser-side tracker needs the heartbeat interval. Importing
 * it from there would pull the database client into the client bundle. Same
 * split, same reason, as `lib/analytics/constants.ts` against `collect.ts`.
 *
 * Nothing in this file may import anything server-only.
 */

/** A presence row counts as online while its lastSeenAt is inside this window. */
export const PRESENCE_TTL_MS = 45_000;

/** How often the browser beats. Two beats per TTL absorbs one lost request. */
export const PRESENCE_HEARTBEAT_MS = 20_000;

/**
 * Rows older than this are deleted, not merely ignored.
 *
 * Reads already filter on the TTL, so a stale row costs storage and not
 * correctness. Deleting at 30x the TTL rather than at the TTL itself means a
 * visitor who backgrounds a tab for ten minutes and comes back keeps their
 * original `startedAt`, so a session survives a nap.
 */
export const PRESENCE_EXPIRY_MS = PRESENCE_TTL_MS * 30;

/** How often the live dashboard's stream re-reads Postgres. */
export const LIVE_POLL_MS = 4_000;

/**
 * Stream lifetime.
 *
 * Short on purpose, for two reasons. A serverless function has a maximum
 * duration, and whatever that number is on the current plan, closing first
 * means `EventSource` sees a clean end and reconnects on its own schedule
 * rather than seeing a network error when the platform reaps us — both
 * recover, but only one is a decision. And a reconnect re-runs the admin guard,
 * so a dashboard left open on an unattended screen cannot outlive the session
 * that opened it by more than this.
 */
export const LIVE_STREAM_MS = 50_000;

export type PresenceRole = "VISITOR" | "OWNER";

export interface PresencePath {
  path: string;
  count: number;
}

export interface PresenceSnapshot {
  /** Is the site owner behind an admin screen right now? */
  ownerOnline: boolean;
  /** Distinct visitor tabs inside the freshness window. */
  visitors: number;
  /** Where those tabs are, busiest first. */
  paths: PresencePath[];
  /** ISO 3166-1 alpha-2 codes present right now, deduplicated. */
  countries: string[];
  /** Server clock at the moment of the read; the client renders relative to it. */
  at: string;
}

export const EMPTY_PRESENCE: PresenceSnapshot = {
  ownerOnline: false,
  visitors: 0,
  paths: [],
  countries: [],
  at: new Date(0).toISOString(),
};

/** One recent interaction, as the live dashboard shows it. */
export interface LiveEvent {
  id: string;
  type: string;
  path: string;
  target: string;
  device: string;
  country: string | null;
  at: string;
}

/** One recent page view. */
export interface LiveView {
  id: string;
  path: string;
  device: string;
  country: string | null;
  at: string;
}

export interface LiveSnapshot {
  presence: PresenceSnapshot;
  /** Page views in the last 5 and 60 minutes. */
  viewsLast5m: number;
  viewsLast60m: number;
  eventsLast60m: number;
  recentEvents: LiveEvent[];
  recentViews: LiveView[];
  /** Views per minute over the last 30 minutes, oldest first — the sparkline. */
  perMinute: number[];
}

/**
 * A presence token is `crypto.randomUUID()` with the dashes stripped.
 *
 * Validated rather than trusted, because the value lands in a unique column: an
 * unbounded string from an anonymous endpoint would let a caller choose their
 * own row keys and mint one per request.
 */
export function isPresenceToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}
