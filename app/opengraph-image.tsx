import { renderOgImage, OG_SIZE, OG_CONTENT_TYPE } from "../lib/seo/og-image";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * The site-wide social card, and the fallback for every route that does not
 * export its own. See lib/seo/og-image.tsx for why the palette changed and why
 * per-route cards exist at all.
 */
export default function OpengraphImage() {
  return renderOgImage({
    eyebrow: "Portfolio",
    title: "Build systems that hold up.",
    subtitle:
      "High-throughput backend platforms and distributed systems in C++, Rust, Go and Python.",
  });
}
