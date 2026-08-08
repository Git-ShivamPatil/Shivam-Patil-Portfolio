"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  COLLECT_PATH,
  CONTENT_SELECTOR,
  DOWNLOAD_PREFIX,
  FLUSH_AT_EVENTS,
  FLUSH_INTERVAL_MS,
  MAX_EVENTS_PER_BATCH,
  RAGE_CLICK_COUNT,
  RAGE_CLICK_WINDOW_MS,
  SKIP_ATTRIBUTE,
  TRACK_ATTRIBUTE,
} from "../lib/analytics/constants";
import { isExcludedPath, normalizePath, toGridCell } from "../lib/analytics/normalize";

/**
 * P10 — the browser side.
 *
 * Mounted once in the root layout. One `useEffect` keyed on the pathname, so a
 * client-side navigation ends the previous view (final flush) and starts a new
 * one — App Router transitions never reload the document, so without this
 * every SPA navigation would be attributed to the landing page.
 *
 * Three listeners total, all delegated to `document` and all passive. This is
 * a portfolio, not a product: the tracker is not allowed to be the reason a
 * page janks. Nothing here reads or writes a cookie, and nothing is stored
 * beyond the lifetime of the view.
 *
 * Two kinds of number leave this file and they are accumulated differently:
 *
 * - **Deltas** (heatmap cells, events) are cleared after every successful
 *   flush; the server increments.
 * - **Cumulative** values (visible duration, deepest scroll) are never
 *   cleared; the server takes the maximum, so a duplicate or out-of-order
 *   beacon is a no-op instead of a double count.
 */

interface Pending {
  cells: Map<string, number>;
  events: { type: "click" | "download" | "outbound" | "rage"; target: string; label?: string }[];
}

/**
 * Opt-out, checked once per view.
 *
 * `globalPrivacyControl` is not in TypeScript's Navigator type — it is a real,
 * shipping property in Firefox and Brave, so the cast is describing reality
 * rather than working around it.
 */
function hasOptedOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  if (nav.globalPrivacyControl === true) return true;
  const dnt =
    nav.doNotTrack ??
    nav.msDoNotTrack ??
    (window as Window & { doNotTrack?: string }).doNotTrack ??
    null;
  return dnt === "1" || dnt === "yes";
}

/** Full scrollable height, taking the larger of the two places browsers report it. */
function documentHeight(): number {
  const body = document.body;
  const html = document.documentElement;
  return Math.max(
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
    html?.clientHeight ?? 0,
    html?.scrollHeight ?? 0,
    html?.offsetHeight ?? 0,
    1,
  );
}

/**
 * Horizontal extent of the centred content column, measured live.
 *
 * Measured per click rather than cached because the column width changes with
 * the viewport, and a cached value taken at mount would quietly misplace every
 * click after a window resize or an orientation change.
 */
function contentBox(): { left: number; width: number } {
  const element = document.querySelector(CONTENT_SELECTOR);
  if (element) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0) return { left: rect.left, width: rect.width };
  }
  return { left: 0, width: window.innerWidth || 1 };
}

/** The tracked identity of whatever was clicked, or null to record position only. */
function describeTarget(element: Element | null): Pending["events"][number] | null {
  if (!element) return null;

  const tracked = element.closest(`[${TRACK_ATTRIBUTE}]`);
  if (tracked) {
    const id = tracked.getAttribute(TRACK_ATTRIBUTE);
    if (id) {
      // The label is an explicit attribute rather than the element's text.
      // Scraping textContent would work today and would quietly start
      // recording whatever text happens to sit inside a tracked element
      // tomorrow — including, on a form, something a visitor typed.
      const label = tracked.getAttribute(`${TRACK_ATTRIBUTE}-label`) ?? undefined;
      return { type: "click", target: id, label };
    }
  }

  const anchor = element.closest("a[href]") as HTMLAnchorElement | null;
  if (!anchor) return null;

  // `.href` rather than `getAttribute("href")`: the DOM property is already
  // resolved against the document base, so a relative href is comparable to
  // location.host without re-implementing URL resolution.
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return null;
  }

  if (url.host === window.location.host) {
    // A counted download link. The `/d/<slug>` route counts these server-side
    // too — that is the authoritative number, and this one is what lets the
    // dashboard say *which page* the download was started from.
    if (url.pathname.startsWith(`${DOWNLOAD_PREFIX}/`)) {
      const slug = url.pathname.slice(DOWNLOAD_PREFIX.length + 1);
      if (slug) return { type: "download", target: slug };
    }
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Hostname only. Which sites we send people to is worth knowing; which page
  // of someone else's site a particular person opened is not ours to hold.
  return { type: "outbound", target: url.hostname.replace(/^www\./, "") };
}

export function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const path = normalizePath(pathname ?? window.location.pathname);
    if (isExcludedPath(path)) return;
    if (hasOptedOut()) return;
    if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") return;

    const viewId = crypto.randomUUID();
    const referrer = document.referrer;
    const timezone = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    })();

    const pending: Pending = { cells: new Map(), events: [] };
    let scrollDepth = 0;
    let visibleMs = 0;
    // Null while the tab is hidden — that is what makes duration "time spent
    // reading" rather than "time the tab existed".
    let visibleSince: number | null = document.visibilityState === "visible" ? Date.now() : null;
    let recent: { key: string; at: number }[] = [];
    let scrollQueued = false;
    let closed = false;
    /**
     * What the last beacon actually reported. Null until the first one, which
     * must always send because it is what creates the row.
     */
    let lastSent: { durationMs: number; scrollDepth: number } | null = null;

    const settledDuration = () => visibleMs + (visibleSince ? Date.now() - visibleSince : 0);

    function flush(final: boolean) {
      if (closed && !final) return;

      const cells = [...pending.cells.entries()].slice(0, MAX_EVENTS_PER_BATCH).map(([key, n]) => {
        const [x, y] = key.split(",").map(Number);
        return { x, y, n };
      });
      const events = pending.events.slice(0, MAX_EVENTS_PER_BATCH);

      const durationMs = Math.round(settledDuration());

      // Nothing new to say — don't say it. The first beacon always sends,
      // because it is what creates the row. After that, a beacon is only worth
      // its request if it carries new deltas or advances one of the two
      // monotonic values.
      //
      // This matters more than it looks: `visibilitychange` fires every time
      // the tab is switched away from, and without this guard someone flicking
      // between tabs generates one request per flick, each of which the
      // server's monotonic guard would then correctly ignore. Observed in
      // local verification before it was added.
      const nothingNew =
        cells.length === 0 &&
        events.length === 0 &&
        lastSent !== null &&
        durationMs <= lastSent.durationMs &&
        scrollDepth <= lastSent.scrollDepth;
      if (nothingNew) return;

      const payload = JSON.stringify({
        viewId,
        path,
        referrer: referrer || undefined,
        timezone,
        durationMs,
        scrollDepth,
        cells: cells.length ? cells : undefined,
        events: events.length ? events : undefined,
      });

      let sent = false;
      try {
        // sendBeacon is the only send that reliably survives the page going
        // away — a normal fetch is cancelled on navigation, which is precisely
        // when the most useful beacon (the one carrying dwell time) fires.
        if (typeof navigator.sendBeacon === "function") {
          sent = navigator.sendBeacon(
            COLLECT_PATH,
            new Blob([payload], { type: "application/json" }),
          );
        }
      } catch {
        sent = false;
      }

      if (!sent) {
        // keepalive gives fetch the same survive-unload property, with a
        // smaller payload budget — well above anything we send.
        void fetch(COLLECT_PATH, {
          method: "POST",
          body: payload,
          keepalive: true,
          headers: { "Content-Type": "application/json" },
        }).catch(() => {
          // A dropped beacon is a missing data point, nothing more.
        });
      }

      // Deltas are consumed whether or not the transport confirmed: retrying
      // them on the next flush is how a flaky connection turns into inflated
      // counts. Cumulative values stay, and the server's monotonic guard makes
      // resending them free.
      pending.cells.clear();
      pending.events.length = 0;
      lastSent = { durationMs, scrollDepth };
    }

    function onClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`[${SKIP_ATTRIBUTE}]`)) return;

      const box = contentBox();
      const cell = toGridCell({
        x: event.clientX,
        y: event.clientY + window.scrollY,
        contentLeft: box.left,
        contentWidth: box.width,
        documentHeight: documentHeight(),
      });
      const key = `${cell.x},${cell.y}`;
      pending.cells.set(key, (pending.cells.get(key) ?? 0) + 1);

      const described = describeTarget(target);
      // Bounded independently of the flush cap: if a flush ever fails to run,
      // the buffer must still not grow without limit in a long-lived tab.
      if (described && pending.events.length < MAX_EVENTS_PER_BATCH) {
        pending.events.push(described);
      }

      // Rage: repeated hits on one cell in a short window. Almost always means
      // something looks clickable and isn't — a bug nobody reports.
      const now = Date.now();
      recent = recent.filter((hit) => now - hit.at < RAGE_CLICK_WINDOW_MS);
      recent.push({ key, at: now });
      const sameCell = recent.filter((hit) => hit.key === key).length;
      // Exactly equal, not >=, so one frustrated burst emits one event rather
      // than one per click past the threshold.
      if (sameCell === RAGE_CLICK_COUNT && pending.events.length < MAX_EVENTS_PER_BATCH) {
        pending.events.push({
          type: "rage",
          target: described?.target ?? `cell:${cell.x}-${cell.y}`,
        });
      }

      if (pending.events.length + pending.cells.size >= FLUSH_AT_EVENTS) flush(false);
    }

    function onScroll() {
      if (scrollQueued) return;
      scrollQueued = true;
      // Coalesced to one measurement per frame — a scroll handler that reads
      // layout on every event is the classic way to make a page stutter.
      requestAnimationFrame(() => {
        scrollQueued = false;
        const reached = ((window.scrollY + window.innerHeight) / documentHeight()) * 100;
        const depth = Math.min(100, Math.max(0, Math.round(reached)));
        if (depth > scrollDepth) scrollDepth = depth;
      });
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        if (visibleSince) {
          visibleMs += Date.now() - visibleSince;
          visibleSince = null;
        }
        // On iOS this is often the *only* unload-ish event that fires, so it
        // has to carry a full flush rather than just pausing the timer.
        flush(true);
      } else if (!visibleSince) {
        visibleSince = Date.now();
      }
    }

    function onPageHide() {
      onVisibility();
      flush(true);
    }

    document.addEventListener("click", onClick, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    const timer = window.setInterval(() => flush(false), FLUSH_INTERVAL_MS);

    // Record the view immediately rather than only at the end. A visitor who
    // closes the tab in a way that fires nothing — a force-quit, a crash, an
    // OS tab eviction — still counts as having been here; only their dwell
    // time is lost.
    flush(true);

    return () => {
      closed = true;
      window.clearInterval(timer);
      document.removeEventListener("click", onClick);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      if (visibleSince) {
        visibleMs += Date.now() - visibleSince;
        visibleSince = null;
      }
      // Closes out this view before the next pathname's effect opens a new one.
      flush(true);
    };
  }, [pathname]);

  return null;
}
