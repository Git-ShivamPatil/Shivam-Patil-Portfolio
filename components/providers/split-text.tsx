"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Character-by-character heading reveals.
 *
 * Walks the *text nodes* of any `[data-split]` element rather than replacing
 * its innerHTML, so nested markup the design depends on — `<em>` for the
 * the <em> weight drop, `<br>` for the deliberate line breaks — survives intact.
 *
 * Accessibility: splitting a heading into one span per character makes screen
 * readers announce it letter by letter. Before splitting, the original text is
 * captured and set as `aria-label`, and the generated spans are hidden from the
 * accessibility tree, so assistive tech reads the heading normally.
 */
export function SplitText() {
  const pathname = usePathname();

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Same ordering trap as ScrollReveal: AnimatePresence mode="wait" mounts
    // the incoming page *after* pathname has already changed, so a one-shot
    // scan here runs before the new headings exist and they never get split.
    // Unlike ScrollReveal this degrades gracefully — an unsplit heading is
    // plain visible text, not an invisible one — but it meant the signature
    // character reveal only ever played on a full page load. The observer
    // makes it fire on client-side navigation too.
    const run = () => {
      const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-split]"));
      if (targets.length === 0) return;
      split(targets, prefersReducedMotion);
    };

    run();

    const mo = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) {
            run();
            return;
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => mo.disconnect();
  }, [pathname]);

  return null;
}

/** Extracted so both the initial scan and the observer share one code path. */
function split(targets: HTMLElement[], prefersReducedMotion: boolean) {
  {
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

        // Characters are grouped into a word wrapper rather than emitted as
        // siblings, and that grouping is load-bearing.
        //
        // `.split-char` is `display: inline-block` (motion-bold.css) because
        // the reveal animates transform, which inline boxes cannot take. But
        // every inline-block is its own line-break opportunity, so a heading
        // made of bare character spans may break between ANY two letters. It
        // rendered "Build syste / ms that hold up." on the live homepage.
        //
        // It was latent for as long as the markup carried a hard <br>: the
        // break landed at the authored point and never had to be chosen. The
        // fluid-typography work removed that <br> so the line could reflow,
        // which is what surfaced it.
        //
        // The wrapper is inline-block + nowrap, so the only break opportunities
        // left are the real space text nodes between words.
        let word: HTMLElement | null = null;
        const closeWord = () => {
          if (word) fragment.appendChild(word);
          word = null;
        };

        for (const char of text) {
          if (char === " ") {
            closeWord();
            // Kept as a real text node: wrapping spaces in inline-block spans
            // collapses them and destroys the word spacing.
            fragment.appendChild(document.createTextNode(" "));
            continue;
          }
          if (!word) {
            word = document.createElement("span");
            word.className = "split-word";
            word.setAttribute("aria-hidden", "true");
          }
          const span = document.createElement("span");
          span.className = "split-char";
          span.setAttribute("aria-hidden", "true");
          span.style.setProperty("--char-index", String(index));
          span.textContent = char;
          word.appendChild(span);
          index += 1;

          // A hyphen or dash is a line-break opportunity in ordinary text, and
          // the `nowrap` wrapper above destroys it. That is not cosmetic — it
          // was the site's entire measured CLS.
          //
          // /about's heading ends in "systems-minded.". As a text node the
          // browser may break it after the hyphen, so the heading's min-content
          // width is one part-word. Wrapped in a single `white-space: nowrap`
          // span it becomes one unbreakable 652px token, and `.about-hero` is
          // `grid-template-columns: 1.1fr 0.9fr` — where `1.1fr` means
          // `minmax(auto, 1.1fr)`. The left track therefore grows past its
          // share to fit that token and steals 82px from the right one. The
          // photo beside it is `aspect-ratio: 4/5`, so 82px narrower is 102px
          // shorter, and everything below jumps up by 102px the moment this
          // effect runs.
          //
          // Measured on production: CLS 0.0324 on /about, from a single shift
          // naming .about-photo-frame, .about-page-story and .brand-watermark —
          // against a 0.02 budget, and the only assertion failing in the
          // Lighthouse job. Closing the word after the dash restores the break
          // opportunity: the widest word drops from 652px to 424px, the columns
          // return to 618/506, and the shift goes to zero.
          //
          // The dash stays at the end of the first word, which is where a
          // browser breaks. En and em dashes are included because headings on
          // this site use them the same way.
          if (char === "-" || char === "–" || char === "—") closeWord();
        }
        closeWord();

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
  }
}
