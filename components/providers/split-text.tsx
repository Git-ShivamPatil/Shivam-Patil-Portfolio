"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Character-by-character heading reveals.
 *
 * Walks the *text nodes* of any `[data-split]` element rather than replacing
 * its innerHTML, so nested markup the design depends on — `<em>` for the
 * Playfair italics, `<br>` for the deliberate line breaks — survives intact.
 *
 * Accessibility: splitting a heading into one span per character makes screen
 * readers announce it letter by letter. Before splitting, the original text is
 * captured and set as `aria-label`, and the generated spans are hidden from the
 * accessibility tree, so assistive tech reads the heading normally.
 */
export function SplitText() {
  const pathname = usePathname();

  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-split]"));
    if (targets.length === 0) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const el of targets) {
      if (el.dataset.splitDone === "true") continue;

      // Preserve the readable string before the DOM is rewritten.
      //
      // innerText, not textContent: these headings use <br> for their line
      // breaks, and textContent concatenates straight across one — "Build
      // systems<br>that" would be announced as "systemsthat". innerText
      // renders the break as a newline, which the whitespace collapse below
      // turns into a proper space.
      const label = (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (label) el.setAttribute("aria-label", label);

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

      let index = 0;
      for (const node of textNodes) {
        const text = node.nodeValue ?? "";
        if (!text.trim()) continue;

        const fragment = document.createDocumentFragment();
        for (const char of text) {
          if (char === " ") {
            // Kept as a real text node: wrapping spaces in inline-block spans
            // collapses them and destroys the word spacing.
            fragment.appendChild(document.createTextNode(" "));
            continue;
          }
          const span = document.createElement("span");
          span.className = "split-char";
          span.setAttribute("aria-hidden", "true");
          span.style.setProperty("--char-index", String(index));
          span.textContent = char;
          fragment.appendChild(span);
          index += 1;
        }
        node.parentNode?.replaceChild(fragment, node);
      }

      el.dataset.splitDone = "true";
    }

    if (prefersReducedMotion || typeof IntersectionObserver === "undefined") {
      targets.forEach((el) => el.setAttribute("data-split-revealed", "true"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-split-revealed", "true");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.2 },
    );

    for (const el of targets) {
      // Above-the-fold headings play immediately — waiting for an observer
      // callback would show a frame of invisible text on first paint.
      if (el.getBoundingClientRect().top < window.innerHeight) {
        el.setAttribute("data-split-revealed", "true");
        continue;
      }
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
