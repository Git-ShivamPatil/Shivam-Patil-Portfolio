"use client";

import { useEffect, useState } from "react";

/**
 * Thin reading-progress bar pinned under the sticky header.
 *
 * Driven by rAF-throttled scroll rather than a raw scroll handler so a fast
 * flick doesn't queue a layout read per event.
 */
export function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      // Pages shorter than the viewport have nothing to progress through —
      // reporting 0 keeps the bar hidden instead of showing a full bar.
      setProgress(scrollable <= 0 ? 0 : Math.min(1, window.scrollY / scrollable));
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="scroll-progress" aria-hidden="true">
      <span style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
