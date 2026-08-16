"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The wire shape of /api/integrations/{github,leetcode}. Note that `fetchedAt`
 * is a STRING here, not a Date: the route serialises it with `.toISOString()`,
 * and a component that forgets that and calls `.toISOString()` on it again
 * throws. StaleNote accepts both for exactly this reason.
 */
export interface LiveSnapshot<T> {
  data: T;
  fetchedAt: string;
  stale: boolean;
}

export type LiveStatus = "idle" | "refreshing" | "error";

interface Options<T> {
  /** Absolute path, e.g. "/api/integrations/github". */
  endpoint: string;
  initial: LiveSnapshot<T>;
  /**
   * Must be >= the route's `s-maxage`, or the extra requests are answered by
   * the CDN with bytes the client already has. 60s for github, 300s for
   * leetcode — see the EDGE_CACHE constants in the route handlers.
   */
  intervalMs: number;
  /** Shape check for the response body — same discipline as the server side. */
  guard: (value: unknown) => value is T;
}

/** Give up on a poll well before the route's own 8s upstream timeout would. */
const REQUEST_TIMEOUT_MS = 9000;
/** Failures back off geometrically and stop doubling here. */
const MAX_BACKOFF_MS = 30 * 60 * 1000;

/**
 * Polls one of the integration endpoints and hands back the newest snapshot.
 *
 * No SWR, no react-query. This is ~90 lines and the four properties that
 * actually matter — pause when hidden, abort on unmount, back off on failure,
 * never setState after unmount — are all visible in one file. A data-fetching
 * library would add 12-15KB to a route whose entire job is to display numbers
 * that change hourly, and the Lighthouse budget is what stops that happening
 * by accident.
 *
 * **Why polling is safe here at all.** Both routes send a shared-cache
 * `s-maxage`, so a burst of pollers costs one origin invocation; behind that,
 * lib/integrations/cache.ts holds a 1h (GitHub) / 6h (LeetCode) TTL, so no
 * amount of polling can reach the upstream more often than the TTL permits.
 * `cache: "no-store"` is not a way around either layer — it only pins the
 * *browser's* private freshness, which neither route specifies (`max-age` is
 * absent), so without it the interval would be at the mercy of a heuristic.
 */
export function useLiveData<T>({ endpoint, initial, intervalMs, guard }: Options<T>) {
  const [polled, setPolled] = useState<LiveSnapshot<T> | null>(null);
  const [status, setStatus] = useState<LiveStatus>("idle");

  /**
   * Derived during render rather than copied into state.
   *
   * The obvious shape — `useState(initial)` plus an effect that adopts a newer
   * `initial` — needs a setState inside an effect body, which cascades an
   * extra render on every server re-render and is exactly what React's
   * "you might not need an effect" guidance is about. Comparing the two
   * timestamps here instead means the server's snapshot wins automatically
   * whenever it is the fresher of the two, with no synchronisation step to get
   * wrong: after a router.refresh() the polled value is simply no longer the
   * newer one, so it stops being used.
   */
  const snapshot =
    polled && Date.parse(polled.fetchedAt) > Date.parse(initial.fetchedAt) ? polled : initial;

  // Refs, not state: changing any of these must not itself schedule a render.
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const failures = useRef(0);

  const poll = useCallback(async () => {
    // One request at a time. Without this, a tab that has been hidden for an
    // hour fires a poll on wake while the previous one is still stalled, and
    // the two race to set state.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    // A hung endpoint must not leave the panel showing "refreshing" forever.
    const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    if (mounted.current) setStatus("refreshing");
    try {
      const response = await fetch(endpoint, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      // A 503 from these routes carries `{error}`, not `{data}` — the two
      // bodies are disjoint, so branching on `res.ok` is the only correct test.
      if (!response.ok) throw new Error(`${endpoint} responded ${response.status}`);
      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("data" in body) ||
        !guard((body as { data: unknown }).data)
      ) {
        throw new Error(`${endpoint} returned an unexpected shape`);
      }
      const next = body as LiveSnapshot<T>;
      if (!mounted.current) return null;
      failures.current = 0;
      setStatus("idle");
      // Keep whichever reading is newer. Two polls can land out of order when
      // one of them was answered from the CDN and the other went to the
      // origin, and a panel that walks backwards in time is worse than one
      // that is a minute behind.
      setPolled((current) =>
        !current || Date.parse(next.fetchedAt) > Date.parse(current.fetchedAt) ? next : current,
      );
      return next;
    } catch (error) {
      // An abort is us, not a failure — it must not feed the backoff.
      if (controller.signal.aborted) return null;
      if (!mounted.current) return null;
      failures.current += 1;
      setStatus("error");
      console.warn(`[stats] live refresh failed for ${endpoint}:`, error);
      return null;
    } finally {
      clearTimeout(deadline);
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [endpoint, guard]);

  useEffect(() => {
    mounted.current = true;

    const delay = () =>
      failures.current === 0
        ? intervalMs
        : Math.min(intervalMs * 2 ** failures.current, MAX_BACKOFF_MS);

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(tick, delay());
    };

    const tick = async () => {
      // A background tab polling on a timer is pure battery cost: nothing is
      // on screen to update, and the value it fetches will be re-fetched the
      // moment the tab is looked at again. Skip and re-arm.
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        await poll();
      }
      if (mounted.current) schedule();
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Catch up immediately rather than waiting out the remainder of an
      // interval that elapsed while the tab was hidden — the first thing a
      // returning reader looks at is the number.
      void tick();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // Abort rather than merely ignore: a fetch left running after unmount
      // holds a connection open and will still resolve into a setState that
      // React warns about.
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [poll, intervalMs]);

  /** Manual refresh — resets the backoff, because a click is a fresh signal. */
  const refresh = useCallback(async () => {
    failures.current = 0;
    return poll();
  }, [poll]);

  return { snapshot, status, refresh };
}
