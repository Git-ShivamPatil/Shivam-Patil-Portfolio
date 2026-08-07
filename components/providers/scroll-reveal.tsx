"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Global scroll-reveal driver.
 *
 * Mounted once in the root layout, it observes every `[data-reveal]` element
 * and flips `data-revealed="true"` when it scrolls into view — the actual
 * transition lives in CSS. Doing it centrally means server components can opt
 * in with a plain attribute instead of each becoming a client component.
 *
 * Elements are unobserved once shown: these are one-shot entrances, so there's
 * no reason to keep paying for intersection callbacks on the way back up.
 */
export function ScrollReveal() {
  // App Router keeps the layout mounted across navigations, so a fresh scan is
  // needed per route — otherwise a new page's elements are never observed and
  // stay stuck at their hidden start state.
  const pathname = usePathname();

  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (targets.length === 0) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion || typeof IntersectionObserver === "undefined") {
      targets.forEach((el) => el.setAttribute("data-revealed", "true"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.setAttribute("data-revealed", "true");
          observer.unobserve(el);
        }
      },
      // A negative bottom margin holds the reveal until the element is properly
      // on screen rather than firing the moment one pixel clears the fold.
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    targets.forEach((el) => {
      // Anything already in view on load reveals immediately — no observer
      // round-trip, so above-the-fold content never flashes as hidden.
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
        el.setAttribute("data-revealed", "true");
        return;
      }
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
