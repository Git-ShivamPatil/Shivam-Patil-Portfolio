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
 *
 * ---
 *
 * Why there is a MutationObserver here as well as a pathname effect.
 *
 * Keying the scan on `usePathname()` alone is not enough, and the failure was
 * total rather than cosmetic: **every client-side navigation rendered a
 * completely blank page**, and only a hard refresh brought content back.
 *
 * The ordering is the problem. `PageTransition` wraps the route in
 * `<AnimatePresence mode="wait">`, and "wait" means the outgoing page stays
 * mounted until its exit animation finishes — the *incoming* page is not in the
 * DOM yet. But `pathname` updates as soon as the navigation commits. So the
 * effect fired, queried `[data-reveal]`, found only the outgoing page's
 * elements (already revealed), and cleaned up. When the new content finally
 * mounted a couple of hundred milliseconds later, nothing was left watching it,
 * so its sections kept the `opacity: 0` start state indefinitely.
 *
 * Reproduced on production across `/services`, `/about` and `/contact`: six
 * targets, six at `opacity: 0`, including a `.page-hero` sitting at `top: 101`
 * — comfortably above the fold and still invisible.
 *
 * The fix deliberately does not depend on transition timing. Rather than
 * guessing when the new subtree lands (a `setTimeout` race) or dropping
 * `mode="wait"` (which changes how the site feels), the observer watches the
 * document for added nodes and arms whatever appears, whenever it appears.
 * That also covers any future content that mounts late for an unrelated reason.
 */
export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canObserve = typeof IntersectionObserver !== "undefined";

    // One shared IntersectionObserver for the life of the effect; `arm` is
    // idempotent, so an element handed to it twice is a no-op.
    const io =
      prefersReducedMotion || !canObserve
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const el = entry.target as HTMLElement;
                el.setAttribute("data-revealed", "true");
                io?.unobserve(el);
              }
            },
            // A negative bottom margin holds the reveal until the element is
            // properly on screen rather than firing the moment one pixel
            // clears the fold.
            { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
          );

    const arm = (el: HTMLElement) => {
      if (el.dataset.revealed === "true") return;
      if (!io) {
        el.setAttribute("data-revealed", "true");
        return;
      }
      // Anything already in view reveals immediately — no observer round-trip,
      // so above-the-fold content never flashes as hidden. This is also what
      // makes a freshly-mounted page correct: its hero is on screen the moment
      // it lands, so it is revealed synchronously rather than waiting for a
      // scroll that may never come.
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
        el.setAttribute("data-revealed", "true");
        return;
      }
      io.observe(el);
    };

    const scan = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>("[data-reveal], [data-stagger]").forEach(arm);
    };

    scan(document);

    // A second pass on the next frame, because the first one measures a layout
    // that has not settled. A freshly-mounted subtree is measured before fonts
    // have applied and before images have taken their space, so an element can
    // report a `top` well below its final position, miss the immediate-reveal
    // threshold, and get handed to the IntersectionObserver instead.
    //
    // That is a trap for anything straddling the fold: it is on screen, but not
    // by the 12% the observer requires, so it stays invisible until the visitor
    // scrolls. Seen on /reach-out, where `.channel-list` settles at top 485
    // against a 492 threshold and was left unrevealed.
    //
    // `arm` is idempotent, so re-scanning costs a querySelectorAll and nothing
    // else.
    let raf = 0;
    const rescan = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => scan(document));
    };

    // Catches the subtree AnimatePresence mounts after its exit animation, and
    // anything else that arrives late.
    const mo = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches("[data-reveal], [data-stagger]")) arm(node);
          scan(node);
        }
      }
      rescan();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    rescan();

    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      io?.disconnect();
    };
  }, [pathname]);

  return null;
}
