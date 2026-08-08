import {
  EXCLUDED_PREFIXES,
  GRID_X,
  GRID_Y,
  MAX_DURATION_MS,
  MAX_LABEL_LENGTH,
  MAX_PATH_LENGTH,
  MAX_TARGET_LENGTH,
} from "./constants";

/**
 * P10 — pure normalisation shared by the tracker and the ingest route.
 *
 * Everything here runs on **both** sides, and the server side runs it again on
 * values the browser sent. That double application is the point: the tracker's
 * normalisation is for correctness (so two spellings of the same page don't
 * split into two rows), and the server's is for safety (the endpoint is
 * anonymous, so every field arriving from it is attacker-controlled).
 */

/** Strip C0/C1 controls, which have no business in any stored dimension. */
function stripControls(value: string): string {
  return value.replace(/\p{Cc}/gu, "");
}

/**
 * Reduce a URL or path to the canonical page key.
 *
 * Query strings and fragments are dropped on purpose. `?ref=` is already
 * captured by P8's referral cookie, and keeping utm parameters here would
 * shatter one page into dozens of near-duplicate rows — which is exactly what
 * makes a heatmap useless, since each variant would collect a fraction of the
 * clicks.
 */
export function normalizePath(raw: unknown): string {
  if (typeof raw !== "string") return "/";

  let path = stripControls(raw).trim();
  if (!path) return "/";

  // An absolute URL is only ever sent by mistake or by hand. Take its path and
  // discard the origin rather than storing someone else's hostname as a page.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return "/";
    }
  }

  path = path.split("#")[0].split("?")[0];
  if (!path.startsWith("/")) path = `/${path}`;

  // Collapse repeated slashes. "//evil.com" is not a route, but it renders in
  // the dashboard, and a value that reads as an origin there is a needless
  // confusion at best.
  path = path.replace(/\/{2,}/g, "/");

  // Drop the trailing slash so "/services" and "/services/" are one page —
  // except at the root, which has nothing left to trim.
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";

  if (path.length > MAX_PATH_LENGTH) path = path.slice(0, MAX_PATH_LENGTH);
  return path;
}

/** Pages we never record: the admin area, auth screens, and API routes. */
export function isExcludedPath(path: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Host-only referrer, or null.
 *
 * Null covers three distinct cases that all mean the same thing for reporting
 * — no referrer, an unparseable one, and a same-site navigation. Recording our
 * own hostname as a traffic source would make the top-sources list say the
 * site's biggest referrer is itself.
 */
export function refererHost(referrer: unknown, selfHost?: string | null): string | null {
  if (typeof referrer !== "string" || !referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
    if (!host) return null;
    if (selfHost && host === selfHost.replace(/^www\./, "").toLowerCase()) return null;
    return host.slice(0, 100);
  } catch {
    return null;
  }
}

/**
 * Map a 0..1 fraction onto a bucket index.
 *
 * Clamped rather than rejected: a click can legitimately land at x = 1.0
 * exactly (the right edge), and a raw floor would put it in a bucket that does
 * not exist.
 *
 * NaN and ±Infinity are handled differently on purpose. NaN carries no
 * information — the browser reports it for a coordinate on an element caught
 * mid-transform — so it goes to the first bucket. An infinity does carry a
 * direction, which is a real (if degenerate) measurement, so it clamps to the
 * end it points at rather than being silently relocated to the opposite one.
 */
export function toBucket(fraction: number, buckets: number): number {
  if (Number.isNaN(fraction)) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.min(buckets - 1, Math.floor(clamped * buckets));
}

export interface CellInput {
  /** Click x in viewport pixels. */
  x: number;
  /** Click y in *document* pixels (viewport y + scroll offset). */
  y: number;
  /** Left edge of the centred content column, in viewport pixels. */
  contentLeft: number;
  /** Width of the centred content column. */
  contentWidth: number;
  /** Full scrollable document height. */
  documentHeight: number;
}

/**
 * Quantise one click into a heatmap cell.
 *
 * x is measured against the content column (see CONTENT_SELECTOR in
 * constants.ts for why), y against total document height. A degenerate
 * measurement — zero-width column, zero-height document, which is what a
 * `display: none` ancestor or a mid-layout click reports — falls back to the
 * first cell rather than producing NaN or a division by zero.
 */
export function toGridCell(input: CellInput): { x: number; y: number } {
  const width = input.contentWidth > 0 ? input.contentWidth : 1;
  const height = input.documentHeight > 0 ? input.documentHeight : 1;
  return {
    x: toBucket((input.x - input.contentLeft) / width, GRID_X),
    y: toBucket(input.y / height, GRID_Y),
  };
}

/**
 * Canonicalise a tracked element's id.
 *
 * The allowed alphabet is narrow by design. These values are author-supplied
 * in markup, but they arrive over an anonymous HTTP endpoint, so what the
 * server actually receives is whatever a caller chose to send. Restricting to
 * `[a-z0-9._:/-]` means a target can never carry markup, whitespace-padded
 * lookalikes, or a sentence someone typed into a form.
 */
export function sanitizeTarget(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = stripControls(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:/-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TARGET_LENGTH);
  return value || null;
}

/** Human-facing label. Bounded and control-stripped; never used as a key. */
export function sanitizeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = stripControls(raw).replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
  return value || null;
}

/**
 * Outbound destination for an off-site link: the bare hostname.
 *
 * The full URL is deliberately discarded. Which sites we send people to is the
 * useful signal; which specific page of someone else's site a particular
 * visitor opened is a browsing record, and this endpoint has no business
 * holding one.
 */
export function outboundTarget(href: unknown, selfHost?: string | null): string | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!host) return null;
    if (selfHost && host === selfHost.replace(/^www\./, "").toLowerCase()) return null;
    return host.slice(0, MAX_TARGET_LENGTH);
  } catch {
    return null;
  }
}

/** Scroll depth as a whole percentage, 0–100. */
export function clampDepth(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Visible dwell time in ms, capped so one stuck tab can't skew every average. */
export function clampDuration(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_DURATION_MS, Math.round(n));
}

/** Grid indices arriving from the network, forced back into range. */
export function clampCell(x: unknown, y: unknown): { x: number; y: number } {
  const cx = Number(x);
  const cy = Number(y);
  return {
    x: Number.isFinite(cx) ? Math.min(GRID_X - 1, Math.max(0, Math.trunc(cx))) : 0,
    y: Number.isFinite(cy) ? Math.min(GRID_Y - 1, Math.max(0, Math.trunc(cy))) : 0,
  };
}

/**
 * Format a duration for the dashboard. Sub-minute values read better in
 * seconds than as "0m 42s".
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
