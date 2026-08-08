"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTheme } from "next-themes";

/** Duration of the circular wipe, in ms. */
const WIPE_MS = 620;

// `startViewTransition` is typed as required by TypeScript's DOM lib, but is
// genuinely absent in Firefox and older Safari — so it is narrowed to an
// optional here and feature-detected at the call site before use.
type MaybeViewTransitions = {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> };
};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Avoid rendering theme-dependent UI until after hydration, since the
  // server doesn't know the user's stored/system preference yet. This is
  // next-themes' own documented mount-guard pattern — the one-time setState
  // here is intentional, not a synchronization bug.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  /**
   * Swap the theme behind a circular wipe originating at this button.
   *
   * The View Transitions API snapshots the old and new documents and
   * cross-fades between them, which is what makes the change read as one
   * continuous surface rather than every element snapping independently.
   * We override the default cross-fade with a clip-path circle so the new
   * theme appears to spread from the control the user actually clicked.
   *
   * Falls back to a plain setTheme when the API is missing (Firefox, older
   * Safari) or the user prefers reduced motion — the theme still changes,
   * just instantly.
   */
  function toggle() {
    const next = isDark ? "light" : "dark";
    const doc = document as unknown as MaybeViewTransitions;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || typeof doc.startViewTransition !== "function") {
      setTheme(next);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : 0;
    // Radius needed to reach the furthest corner from the origin, so the
    // circle always finishes covering the viewport.
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = doc.startViewTransition(() => {
      // flushSync forces React to commit the theme change *inside* the
      // transition callback. Without it the snapshot is taken before the DOM
      // updates and the wipe reveals the old theme twice.
      flushSync(() => setTheme(next));
    });

    void transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
        },
        {
          duration: WIPE_MS,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggle}
      aria-label={mounted ? `Switch to ${isDark ? "light" : "dark"} mode` : "Toggle theme"}
      className="theme-toggle border-app-line text-app-fg hover:border-app-fg inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {mounted && isDark ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path
              d="M12 3a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Zm0 15a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1ZM4.93 4.93a1 1 0 0 1 1.41 0l.71.7a1 1 0 0 1-1.42 1.42l-.7-.71a1 1 0 0 1 0-1.41Zm12.02 12.02a1 1 0 0 1 1.41 0l.71.7a1 1 0 0 1-1.42 1.42l-.7-.71a1 1 0 0 1 0-1.41ZM3 12a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm15 0a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1ZM4.93 19.07a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.42 1.42l-.71.7a1 1 0 0 1-1.42 0Zm12.02-12.02a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.42 1.42l-.71.7a1 1 0 0 1-1.42 0ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
              fill="currentColor"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
            <path
              d="M20.742 13.045a8.088 8.088 0 0 1-2.077.267c-4.476 0-8.106-3.63-8.106-8.106 0-1.09.216-2.13.61-3.078a1 1 0 0 0-1.276-1.303A10.106 10.106 0 0 0 2 10.894C2 16.478 6.522 21 12.106 21a10.106 10.106 0 0 0 9.94-8.243 1 1 0 0 0-1.304-1.106 8.06 8.06 0 0 1 0 .394Z"
              fill="currentColor"
            />
          </svg>
        )}
      </span>
    </button>
  );
}
