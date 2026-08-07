"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Max pixels a magnetic element drifts toward the pointer. */
const MAGNET_STRENGTH = 7;
/** Max degrees a tilt surface rotates on each axis. */
const TILT_MAX_DEG = 5;

/**
 * Global pointer-interaction driver: magnetic buttons, click ripples, and
 * card tilt.
 *
 * Like ScrollReveal, this is a single client component mounted in the root
 * layout that wires behaviour onto plain `data-*` attributes, so server
 * components stay server components. Everything here is a progressive
 * enhancement — without JS the elements are still perfectly usable, just
 * static.
 *
 * All three effects are suppressed under `prefers-reduced-motion`, and the
 * pointer-driven ones are additionally gated on a fine pointer: magnetic drift
 * and tilt are meaningless on touch and would only fight with scrolling.
 */
export function InteractionLayer() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const cleanups: Array<() => void> = [];
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    if (finePointer) {
      // ---- magnetic buttons ----
      document.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((el) => {
        const onMove = (event: PointerEvent) => {
          const rect = el.getBoundingClientRect();
          const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
          const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
          el.style.setProperty("--magnet-x", `${dx * MAGNET_STRENGTH}px`);
          el.style.setProperty("--magnet-y", `${dy * MAGNET_STRENGTH}px`);
        };
        const onLeave = () => {
          el.style.setProperty("--magnet-x", "0px");
          el.style.setProperty("--magnet-y", "0px");
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerleave", onLeave);
        cleanups.push(() => {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerleave", onLeave);
        });
      });

      // ---- tilt surfaces ----
      document.querySelectorAll<HTMLElement>("[data-tilt]").forEach((el) => {
        const onMove = (event: PointerEvent) => {
          const rect = el.getBoundingClientRect();
          const px = (event.clientX - rect.left) / rect.width - 0.5;
          const py = (event.clientY - rect.top) / rect.height - 0.5;
          // Y drives rotateX inverted so the edge nearest the pointer dips
          // toward the viewer, which is what reads as "physical".
          el.style.setProperty("--tilt-x", `${-py * TILT_MAX_DEG}deg`);
          el.style.setProperty("--tilt-y", `${px * TILT_MAX_DEG}deg`);
        };
        const onLeave = () => {
          el.style.setProperty("--tilt-x", "0deg");
          el.style.setProperty("--tilt-y", "0deg");
        };
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerleave", onLeave);
        cleanups.push(() => {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerleave", onLeave);
        });
      });
    }

    // ---- click ripple ----
    // Delegated rather than per-element: ripple targets are the most numerous
    // and the most likely to be added dynamically (forms, admin tables).
    const onPointerDown = (event: PointerEvent) => {
      // .button-text is excluded: it has no background box, so clipping a
      // ripple to it would also clip its trailing arrow glyph.
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        ".button:not(.button-text), [data-ripple]",
      );
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple-ink";
      const size = Math.max(rect.width, rect.height) * 2;
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
      // The ripple is absolutely positioned against its host, so the host must
      // establish a containing block. Buttons here are already inline-flex
      // with a radius; adding relative/hidden is safe and idempotent.
      target.classList.add("has-ripple");
      target.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
    };

    document.addEventListener("pointerdown", onPointerDown);
    cleanups.push(() => document.removeEventListener("pointerdown", onPointerDown));

    return () => cleanups.forEach((fn) => fn());
  }, [pathname]);

  return null;
}
