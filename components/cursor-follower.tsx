"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/** How much of the remaining distance the ring closes each frame. */
const EASE = 0.16;

/**
 * Subscribe to a media query the React-idiomatic way.
 *
 * useSyncExternalStore rather than useState + useEffect: the browser is the
 * source of truth here, so mirroring it into state would mean a render pass
 * just to catch up, and it would go stale if the user plugged in a mouse or
 * flipped the reduced-motion setting mid-session. The server snapshot is
 * `false` so nothing is emitted during SSR.
 */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Trailing cursor ring.
 *
 * Renders nothing on touch or coarse-pointer devices, where there is no cursor
 * to follow and the element would just be a stray dot. Also opts out entirely
 * under prefers-reduced-motion.
 *
 * The ring is animated in a rAF loop writing directly to `style.transform`
 * rather than through React state — a state update per frame would re-render
 * the tree 60 times a second for a purely decorative element.
 */
export function CursorFollower() {
  const ringRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);

  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const enabled = finePointer && !reducedMotion;

  useEffect(() => {
    if (!enabled) return;

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const ring = { ...target };
    let frame = 0;
    let visible = false;

    const onMove = (event: PointerEvent) => {
      target.x = event.clientX;
      target.y = event.clientY;

      if (!visible) {
        visible = true;
        ringRef.current?.classList.add("is-visible");
        dotRef.current?.classList.add("is-visible");
      }

      // Grow over anything clickable, so the cursor doubles as an affordance
      // hint rather than pure decoration.
      const interactive = (event.target as HTMLElement | null)?.closest(
        "a, button, input, textarea, select, [role='button'], [data-magnetic]",
      );
      ringRef.current?.classList.toggle("is-active", Boolean(interactive));
    };

    const onLeave = () => {
      visible = false;
      ringRef.current?.classList.remove("is-visible");
      dotRef.current?.classList.remove("is-visible");
    };

    const tick = () => {
      ring.x += (target.x - ring.x) * EASE;
      ring.y += (target.y - ring.y) * EASE;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ring.x}px, ${ring.y}px, 0) translate(-50%, -50%)`;
      }
      if (dotRef.current) {
        // The dot tracks the pointer exactly; only the ring lags, which is
        // what produces the trailing feel.
        dotRef.current.style.transform = `translate3d(${target.x}px, ${target.y}px, 0) translate(-50%, -50%)`;
      }
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <div ref={ringRef} className="cursor-ring" aria-hidden="true" />
      <div ref={dotRef} className="cursor-dot" aria-hidden="true" />
    </>
  );
}
