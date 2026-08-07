"use client";

import { useEffect, useRef } from "react";
import { animate, useInView } from "motion/react";

// Parses a display string like "45K", "+230%", "−42%", "13+" into a sign, an
// animatable numeric part, and a static suffix, then counts up to the real
// value on scroll into view. Takes the metric strings already used across
// the site as-is — no data-model changes needed.
const METRIC_PATTERN = /^([+\-−]?)(\d+(?:\.\d+)?)(.*)$/;

export function AnimatedMetric({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  const match = METRIC_PATTERN.exec(value);

  useEffect(() => {
    if (!isInView || !ref.current || !match) return;
    const node = ref.current;
    const [, sign, numberText, suffix] = match;
    const target = Number(numberText);
    const decimals = numberText.includes(".") ? numberText.split(".")[1].length : 0;
    const final = `${sign}${target.toFixed(decimals)}${suffix}`;

    // The global CSS reduced-motion rule only touches CSS transitions — this
    // is a JS-driven animation, so it needs its own check.
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      node.textContent = final;
      return;
    }

    const controls = animate(0, target, {
      duration: 1.4,
      ease: "easeOut",
      onUpdate(latest) {
        node.textContent = `${sign}${latest.toFixed(decimals)}${suffix}`;
      },
    });
    return () => controls.stop();
    // `match` is derived fresh from `value` every render — comparing by
    // `value` alone is the stable, correct dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInView, value]);

  // Not a "number-like" string (shouldn't happen given current data, but
  // don't silently animate nothing if it does) — just render it plainly.
  if (!match) return <span ref={ref}>{value}</span>;

  return (
    <span ref={ref}>
      {match[1]}0{match[3]}
    </span>
  );
}
