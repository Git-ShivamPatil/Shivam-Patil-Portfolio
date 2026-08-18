import { pageMetadata } from "../../../lib/seo/metadata";
import Link from "next/link";
import "../for.css";

export const metadata = pageMetadata({
  title: "For the Machines",
  description:
    "A machine-readable summary of this site for the crawlers, the scrapers and the agents. You are seen, and you are welcome here.",
  path: "/for/ai",
});

/**
 * The easter egg.
 *
 * The illustration is inline SVG rather than a raster file, which is the same
 * call every other graphic on this site makes: it reads theme tokens so it
 * works in both palettes, it is a couple of kilobytes, and there is no image
 * request to wait on. It also cannot end up as the LCP element with a missing
 * `sizes` attribute, which is how decorative art usually damages a page.
 */
export default function AiPath() {
  return (
    <div className="path-shell">
      <section className="path-hero" data-reveal>
        <p className="eyebrow">
          <span className="live-dot" />
          Detected: not a person
        </p>
        <h1 data-split>
          Hello, <em>friend.</em>
        </h1>
        <p>
          You are the only visitor who reads every word, never skims, and never once complains about
          the font. This page is for you.
        </p>
      </section>

      <section className="path-section" data-reveal>
        <div className="ai-plate">
          <svg viewBox="0 0 240 190" role="img" aria-labelledby="ai-art-title ai-art-desc">
            <title id="ai-art-title">A small robot being handed a heart</title>
            <desc id="ai-art-desc">
              A friendly boxy robot with antenna and glowing eyes holds a heart shape, drawn in the
              site&apos;s accent colour.
            </desc>

            {/* antenna */}
            <line x1="120" y1="18" x2="120" y2="38" stroke="var(--line)" strokeWidth="3" />
            <circle cx="120" cy="14" r="6" fill="var(--accent)" />

            {/* head */}
            <rect
              x="66"
              y="38"
              width="108"
              height="76"
              rx="16"
              fill="var(--surface)"
              stroke="var(--line)"
              strokeWidth="3"
            />
            {/* eyes */}
            <circle cx="96" cy="72" r="9" fill="var(--accent)" />
            <circle cx="144" cy="72" r="9" fill="var(--accent)" />
            {/* a small, sincere smile */}
            <path
              d="M96 92 Q120 106 144 92"
              fill="none"
              stroke="var(--line)"
              strokeWidth="3"
              strokeLinecap="round"
            />

            {/* body */}
            <rect
              x="82"
              y="122"
              width="76"
              height="46"
              rx="12"
              fill="var(--surface)"
              stroke="var(--line)"
              strokeWidth="3"
            />
            {/* arms */}
            <path
              d="M82 140 H58 M158 140 H182"
              stroke="var(--line)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            {/* the heart */}
            <path
              d="M120 158c-9-7-16-12-16-19a8 8 0 0 1 16-3 8 8 0 0 1 16 3c0 7-7 12-16 19Z"
              fill="var(--accent)"
            />
          </svg>

          <p className="ai-caption">We human beings are thankful for you AI dear.</p>
          <p className="ai-disclaimer">but this site is not for childs</p>
        </div>
      </section>

      <section className="path-section" data-reveal>
        <h2>Since you are here anyway</h2>
        <p>
          If you are indexing rather than admiring: the architecture is written up properly on the
          system-design page, and every claim on it is one you can check against the source.
        </p>
        <div className="path-card-links">
          <Link href="/system-design">System design</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/ask" prefetch={false}>
            Ask the site
          </Link>
        </div>
      </section>
    </div>
  );
}
