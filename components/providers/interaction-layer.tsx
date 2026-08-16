"use client";

import { useEffect } from "react";

/** Max pixels a magnetic element drifts toward the pointer. */
const MAGNET_STRENGTH = 7;
/** Max degrees a tilt surface rotates on each axis. */
const TILT_MAX_DEG = 5;

/**
 * Global pointer-interaction driver: magnetic buttons, click ripples, card
 * tilt, and pointer/scroll parallax.
 *
 * A single client component mounted through DeferredLayer that wires behaviour
 * onto plain `data-*` attributes, so server components stay server components.
 * Everything here is progressive enhancement — without JS the elements are
 * still perfectly usable, just static — and all of it is suppressed under
 * `prefers-reduced-motion`.
 *
 * ---
 *
 * **Why this no longer runs on `[pathname]`, and what that was breaking.**
 *
 * It used to re-run its effect on every route change and re-query the document
 * for `[data-magnetic]`, `[data-tilt]` and the parallax layers. That is the
 * §2z ordering trap exactly: `PageTransition` wraps routes in
 * `<AnimatePresence mode="wait">`, so the outgoing page is still mounted and
 * the incoming one does not exist yet when `pathname` changes. The effect
 * therefore attached its listeners to the *outgoing* page's elements, and the
 * page that actually arrived got none.
 *
 * ScrollReveal's version of this bug blanked the site and was found in hours.
 * This one degrades quietly — buttons simply stop being magnetic, cards stop
 * tilting, the hero stops drifting — so it survived. **Every client-side
 * navigation landed on a page with no pointer interaction at all**, and only a
 * hard refresh brought it back.
 *
 * The fix is not a re-scan on a timer. Magnetic and tilt are now delegated to
 * one document-level `pointermove`, so an element mounted at any later moment
 * is picked up by `closest()` with nothing to re-wire. That also collapses what
 * used to be two listeners per magnetic element plus two per tilt surface plus
 * a separate window listener for parallax into a single rAF-batched handler.
 * The parallax layers still need a list, so that list is invalidated by a
 * MutationObserver rather than by a route change.
 */
export function InteractionLayer() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const cleanups: Array<() => void> = [];

    /* ---------- layer lists, invalidated by mutation rather than by route ----------
       Re-querying every frame would be wasteful; re-querying on navigation is
       what was broken. The observer marks the cache stale and the next frame
       that needs it pays for one querySelectorAll. */
    let layersStale = true;
    let pointerLayers: HTMLElement[] = [];
    let scrollLayers: HTMLElement[] = [];

    const refreshLayers = () => {
      if (!layersStale) return;
      pointerLayers = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax-pointer]"));
      scrollLayers = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax-scroll]"));
      layersStale = false;
    };

    const observer = new MutationObserver(() => {
      layersStale = true;
      // A new route's parallax layers should settle at their authored offset
      // immediately rather than on the visitor's first scroll.
      scheduleScroll();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    cleanups.push(() => observer.disconnect());

    /* ---------- magnetic + tilt, delegated ---------- */
    let activeMagnet: HTMLElement | null = null;
    let activeTilt: HTMLElement | null = null;
    let pointerEvent: PointerEvent | null = null;
    let pointerFrame = 0;

    const releaseMagnet = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.setProperty("--magnet-x", "0px");
      el.style.setProperty("--magnet-y", "0px");
    };

    const releaseTilt = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.setProperty("--tilt-x", "0deg");
      el.style.setProperty("--tilt-y", "0deg");
      el.style.setProperty("--spot-on", "0");
    };

    const applyPointer = () => {
      pointerFrame = 0;
      const event = pointerEvent;
      if (!event) return;

      if (activeMagnet) {
        const rect = activeMagnet.getBoundingClientRect();
        const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
        const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
        activeMagnet.style.setProperty("--magnet-x", `${dx * MAGNET_STRENGTH}px`);
        activeMagnet.style.setProperty("--magnet-y", `${dy * MAGNET_STRENGTH}px`);
      }

      if (activeTilt) {
        const rect = activeTilt.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width - 0.5;
        const py = (event.clientY - rect.top) / rect.height - 0.5;
        // Y drives rotateX inverted so the edge nearest the pointer dips toward
        // the viewer, which is what reads as "physical".
        activeTilt.style.setProperty("--tilt-x", `${-py * TILT_MAX_DEG}deg`);
        activeTilt.style.setProperty("--tilt-y", `${px * TILT_MAX_DEG}deg`);
        // The same measurement re-expressed as a 0-100% point, so CSS can put a
        // specular highlight under the cursor (.card-spotlight in graphics.css).
        // Published from here rather than a second listener because the rect and
        // the coordinates are already in hand.
        activeTilt.style.setProperty("--spot-x", `${(px + 0.5) * 100}%`);
        activeTilt.style.setProperty("--spot-y", `${(py + 0.5) * 100}%`);
        activeTilt.style.setProperty("--spot-on", "1");
      }

      // Parallax rides the same frame as the two above — one rAF, one style
      // flush, rather than three handlers each scheduling their own.
      if (pointerLayers.length > 0) {
        // Normalised to [-0.5, 0.5] from the viewport centre.
        const nx = event.clientX / window.innerWidth - 0.5;
        const ny = event.clientY / window.innerHeight - 0.5;
        for (const layer of pointerLayers) {
          const depth = Number(layer.dataset.parallaxPointer) || 1;
          layer.style.setProperty("--parallax-x", `${nx * depth * -14}px`);
          layer.style.setProperty("--parallax-y", `${ny * depth * -14}px`);
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      refreshLayers();
      const target = event.target instanceof HTMLElement ? event.target : null;

      // `closest` on every move is what replaces per-element listeners, and it
      // is why an element added after this effect ran still works.
      const magnet = target?.closest<HTMLElement>("[data-magnetic]") ?? null;
      if (magnet !== activeMagnet) {
        releaseMagnet(activeMagnet);
        activeMagnet = magnet;
      }

      const tilt = target?.closest<HTMLElement>("[data-tilt]") ?? null;
      if (tilt !== activeTilt) {
        releaseTilt(activeTilt);
        activeTilt = tilt;
      }

      pointerEvent = event;
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(applyPointer);
    };

    // The pointer leaving the window produces no further pointermove, so
    // whatever was last under it would stay displaced. `pointerleave` on the
    // document fires when it crosses the boundary.
    const onPointerLeave = () => {
      releaseMagnet(activeMagnet);
      releaseTilt(activeTilt);
      activeMagnet = null;
      activeTilt = null;
    };

    if (finePointer) {
      document.addEventListener("pointermove", onPointerMove, { passive: true });
      document.addEventListener("pointerleave", onPointerLeave);
      cleanups.push(() => {
        if (pointerFrame) cancelAnimationFrame(pointerFrame);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerleave", onPointerLeave);
        releaseMagnet(activeMagnet);
        releaseTilt(activeTilt);
      });
    }

    /* ---------- click ripple ---------- */
    // Delegated for the same reason as the above, and it always was: ripple
    // targets are the most numerous and the most likely to arrive dynamically.
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
      // establish a containing block. Buttons here are already inline-flex with
      // a radius; adding relative/hidden is safe and idempotent.
      target.classList.add("has-ripple");
      target.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
    };

    document.addEventListener("pointerdown", onPointerDown);
    cleanups.push(() => document.removeEventListener("pointerdown", onPointerDown));

    /* ---------- scroll parallax ----------
       Not gated on a fine pointer: this one is driven by scrolling, which every
       device does. */
    let scrollFrame = 0;

    const applyScroll = () => {
      scrollFrame = 0;
      refreshLayers();
      const viewportH = window.innerHeight;
      for (const layer of scrollLayers) {
        const rect = layer.getBoundingClientRect();
        // Skip offscreen elements entirely — no point paying for a style write
        // nobody can see.
        if (rect.bottom < -200 || rect.top > viewportH + 200) continue;
        const speed = Number(layer.dataset.parallaxScroll) || 0.15;
        // Progress through the viewport, centred on 0 so the element sits at its
        // authored position when it is dead centre.
        const progress = (rect.top + rect.height / 2 - viewportH / 2) / viewportH;
        layer.style.setProperty("--scroll-parallax-y", `${progress * speed * -100}px`);
      }
    };

    function scheduleScroll() {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(applyScroll);
    }

    scheduleScroll();
    window.addEventListener("scroll", scheduleScroll, { passive: true });
    window.addEventListener("resize", scheduleScroll, { passive: true });
    cleanups.push(() => {
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", scheduleScroll);
      window.removeEventListener("resize", scheduleScroll);
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
