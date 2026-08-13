"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";

/**
 * Non-critical client components, mounted after the browser goes idle.
 *
 * Measured on production before this existed: the HTML arrived at 301ms and the
 * DOM was interactive at 359ms, but first paint did not happen until **1360ms**
 * — a full second of blank screen while 1,012KB of JavaScript across 17 scripts
 * hydrated fourteen providers at once. Four long tasks (191 + 91 + 336 + 567ms)
 * held the main thread through that entire window.
 *
 * Nothing below is needed for the first frame:
 *
 * - `CursorFollower`, `InteractionLayer` — pointer decoration; there is no
 *   pointer event to respond to before the user has seen the page.
 * - `ScrollProgress`, `BackToTop` — both are functions of scroll position, and
 *   scroll position is 0 until the page is visible enough to scroll.
 * - `ChatWidget` — a launcher button in the corner.
 * - `PresenceTracker` — renders nothing at all; it beats a heartbeat so the
 *   chat widget can say whether the owner is around.
 * - `Toaster` — renders nothing until something calls `toast()`, which only
 *   happens on a user action.
 *
 * Deliberately NOT deferred, because each is paint-critical or correctness-
 * critical and belongs in the root layout:
 *
 * - `ThemeProvider` — deferring it reintroduces the theme flash it exists to
 *   prevent.
 * - `ScrollReveal` — reveals above-the-fold `[data-reveal]` sections, which sit
 *   at `opacity: 0` until it runs. Deferring it means visibly empty sections.
 * - `SplitText` — rewrites headings into `opacity: 0` per-character spans, so
 *   running it later makes the hero heading vanish and re-animate *later*, not
 *   sooner. Its cost is a design question (see the hero animation note in
 *   HANDOFF.md), not a scheduling one.
 * - `AnalyticsTracker` — deferring it silently drops fast bounces from the
 *   pageview record. Measurement integrity beats a few KB.
 * - `ReferralCapture` — must read `?ref=` before the visitor can navigate away.
 *
 * `ssr: false` keeps all of this out of the server render and out of the
 * initial chunk graph; the idle gate then keeps it off the main thread until
 * after first paint.
 */

const CursorFollower = dynamic(() => import("../cursor-follower").then((m) => m.CursorFollower), {
  ssr: false,
});
const InteractionLayer = dynamic(
  () => import("./interaction-layer").then((m) => m.InteractionLayer),
  { ssr: false },
);
const ScrollProgress = dynamic(() => import("../scroll-progress").then((m) => m.ScrollProgress), {
  ssr: false,
});
const BackToTop = dynamic(() => import("../back-to-top").then((m) => m.BackToTop), {
  ssr: false,
});
const ChatWidget = dynamic(() => import("../chat/chat-widget").then((m) => m.ChatWidget), {
  ssr: false,
});
// P11. Deferred for the same reason as the chat launcher it feeds: a heartbeat
// that arrives after first paint is still a heartbeat, and nothing on screen
// depends on it before then.
// P17. The palette renders nothing until Cmd+K is pressed — closed, it is one
// keydown listener — and the customiser nothing until the palette asks for it.
// Both are deferred anyway: neither can be wanted before first paint.
const CommandPalette = dynamic(
  () => import("../devex/command-palette").then((m) => m.CommandPalette),
  { ssr: false },
);
const ThemeCustomizer = dynamic(
  () => import("../devex/theme-customizer").then((m) => m.ThemeCustomizer),
  { ssr: false },
);
const PresenceTracker = dynamic(
  () => import("../presence-tracker").then((m) => m.PresenceTracker),
  { ssr: false },
);

export function DeferredLayer() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // requestIdleCallback isn't in Safari <17, hence the timeout fallback. The
    // `timeout` option is the ceiling: on a busy main thread the callback still
    // fires within 2s rather than being starved indefinitely.
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof w.requestIdleCallback === "function") {
      const handle = w.requestIdleCallback(() => setReady(true), { timeout: 2000 });
      return () => w.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(() => setReady(true), 200);
    return () => window.clearTimeout(handle);
  }, []);

  if (!ready) return null;

  return (
    <>
      <InteractionLayer />
      <ScrollProgress />
      <CursorFollower />
      <BackToTop />
      <PresenceTracker />
      <CommandPalette />
      <ThemeCustomizer />
      <ChatWidget />
      <Toaster
        position="bottom-right"
        // Lifted clear of the chat launcher, which occupies the same corner —
        // otherwise a toast lands on top of it.
        offset="92px"
        toastOptions={{
          style: {
            background: "var(--bg)",
            color: "var(--fg)",
            border: "1px solid var(--line)",
          },
        }}
      />
    </>
  );
}
