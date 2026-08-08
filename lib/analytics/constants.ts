/**
 * P10 — first-party analytics: shared constants.
 *
 * This module is imported by BOTH the browser tracker and the server ingest,
 * so it deliberately has zero imports of its own. Anything added here ships to
 * the client; anything that needs `node:crypto` or Prisma belongs elsewhere.
 *
 * Why first-party at all, when @vercel/analytics is already mounted: Vercel
 * Analytics answers "how many page views" and nothing else. It cannot tell us
 * *where on the page* people click, whether they reached the résumé button
 * before leaving, or how many actually downloaded the PDF. Those are the three
 * questions this phase exists to answer, and none of them are answerable from
 * outside our own origin.
 */

/** The endpoint the browser beacons into. */
export const COLLECT_PATH = "/api/analytics/collect";

/** Counted-download prefix: `/d/<slug>` -> the real asset, plus a counter. */
export const DOWNLOAD_PREFIX = "/d";

// ---- Heatmap grid ----------------------------------------------------------

/**
 * Grid resolution.
 *
 * 24 x 48 is a deliberate compromise. Finer resolution looks better but the
 * cell count is the table's ceiling (paths x devices x cells), and the extra
 * precision is spurious anyway: a click's position varies by more than a
 * 1/48th of the page between two browsers rendering the same markup at
 * different font metrics. At this resolution a desktop cell is ~49px wide and
 * a typical page's cell is ~60px tall — roughly one button.
 */
export const GRID_X = 24;
export const GRID_Y = 48;

/**
 * How x is normalised.
 *
 * NOT by viewport width. The site's layout is a centred column —
 * `.shell { width: min(1180px, 100% - 64px) }` — so the same button sits at a
 * different fraction of the viewport on a 1280px screen than on a 1920px one.
 * Normalising against that column instead means the same element lands in the
 * same cell at every desktop width, which is the entire point of aggregating.
 * Clicks on full-bleed sections fall outside the column and clamp to the edge
 * cells, which is visually where they are.
 */
export const CONTENT_SELECTOR = ".shell";

/**
 * How y is normalised: position within the *document*, not the viewport. A
 * viewport-relative y would pile every click into the top band regardless of
 * how far down the page it happened.
 */

// ---- Batching and bounds ---------------------------------------------------

/**
 * Hard cap on events per beacon. The endpoint is anonymous and writes rows, so
 * every dimension of the payload needs a ceiling — this one bounds the write
 * amplification of a single accepted request.
 */
export const MAX_EVENTS_PER_BATCH = 40;

/** Flush early if the buffer fills up, rather than risking a dropped beacon. */
export const FLUSH_AT_EVENTS = 12;

/** Periodic flush, so a long-lived tab doesn't hold everything until unload. */
export const FLUSH_INTERVAL_MS = 30_000;

/** Field length caps, applied client-side and re-applied on the server. */
export const MAX_PATH_LENGTH = 160;
export const MAX_TARGET_LENGTH = 120;
export const MAX_LABEL_LENGTH = 80;

/**
 * Rage-click detection: N clicks landing in the same grid cell inside this
 * window. Not a vanity metric — repeated clicks on one spot almost always
 * mean something looks interactive and isn't, which is a bug report nobody
 * files.
 */
export const RAGE_CLICK_COUNT = 3;
export const RAGE_CLICK_WINDOW_MS = 1_200;

/**
 * Dwell time is accumulated only while the tab is visible. A tab left open in
 * a background window for six hours is not six hours of reading, and counting
 * it that way makes the average meaningless.
 */
export const MAX_DURATION_MS = 30 * 60 * 1000;

/** Retention window. Rows older than this are pruned — see the cron route. */
export const RETENTION_DAYS = 180;

// ---- Devices ---------------------------------------------------------------

/** Device classes, in the order the dashboard renders them. */
export const DEVICE_CLASSES = ["desktop", "mobile", "tablet", "bot", "unknown"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/**
 * Device classes a heatmap is drawn for. Bots don't click, and "unknown"
 * cannot be laid out meaningfully.
 */
export const HEATMAP_DEVICES = ["desktop", "mobile", "tablet"] as const;

// ---- Attribute contract ----------------------------------------------------

/**
 * Opt-in marker for element-level click tracking:
 * `<a data-analytics-id="resume-download">`.
 *
 * Tracking is opt-in rather than "every click, with a derived selector"
 * because a derived selector is both fragile — it breaks the moment a class
 * changes — and a quiet way to record the text of whatever was clicked. An
 * explicit id is a decision someone made, and it survives a redesign.
 */
export const TRACK_ATTRIBUTE = "data-analytics-id";

/** Opt-out marker: nothing inside a `data-analytics-skip` subtree is recorded. */
export const SKIP_ATTRIBUTE = "data-analytics-skip";

/** Path prefixes never tracked at all. */
export const EXCLUDED_PREFIXES = ["/admin", "/api", "/login", "/register", "/reset-password"];
