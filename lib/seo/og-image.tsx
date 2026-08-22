import { ImageResponse } from "next/og";
import { person } from "./site";

/**
 * The shared social-card renderer.
 *
 * ### Why this exists
 *
 * Every route on this site shared one image — the root `app/opengraph-image.tsx`
 * — so a case study, a blog post and the homepage all unfurled in Slack,
 * LinkedIn and WhatsApp with the identical card. The title and description
 * became per-route in this pass; the picture did not, and the picture is the
 * part a person actually looks at.
 *
 * Route segments that want their own card export an `opengraph-image.tsx` that
 * calls this. Segments that do not inherit the root's, which is correct: a card
 * saying who this is beats no card, and beats a bad generated one.
 *
 * ### The palette has now been wrong twice
 *
 * The card was `#111110` / `#f4f3ee` / `#d8fe67` while the site was pink and
 * cream, and then pink and cream while the site went monochrome — both times a
 * stranger's first impression was of a different site than the link opened.
 *
 * That is the failure mode this file has, and it has it structurally: these are
 * a hand-copied second copy of the palette, so nothing breaks when the real one
 * moves. It is not fixable from here — see below for why — so the mitigation is
 * to name it. The values are `--ink`, `--paper` and `--muted`, and if the
 * palette moves again this file does not follow on its own.
 *
 * Why it is not fixable: this runs in the Edge runtime, rendering to a PNG with
 * no document, no stylesheet and no `getComputedStyle`. There is nothing here
 * to read a custom property off. A build step could inline them, and that is
 * the real fix if this happens a third time.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const INK = "#0e0e0e"; // --ink
const PAPER = "#ffffff"; // --paper
/** The monogram disc and the eyebrow — the card's one non-text tone.
 *  Named for its job now that the palette has no hue to name it after.
 *  14.0:1 on INK. */
const TONE = "#d9d9d9";
/** Supporting copy: the subtitle and the footer role line. 8.5:1 on INK. */
const MUTED = "#9e9e9e";

export function renderOgImage({
  eyebrow,
  title,
  subtitle,
}: {
  /** Small uppercase line above the title — the section this page belongs to. */
  eyebrow?: string;
  /** The page's own title. Truncated at 90 characters; longer than that is unreadable at card size anyway. */
  title: string;
  /** One supporting line. Truncated at 120. */
  subtitle?: string;
}) {
  // Truncation happens here rather than at each call site, because the failure
  // it prevents is silent: `ImageResponse` does not wrap indefinitely, it
  // overflows the box and the end of a long project title simply vanishes off
  // the card with nothing to indicate it was cut.
  const safeTitle = title.length > 90 ? `${title.slice(0, 89).trimEnd()}…` : title;
  const safeSubtitle =
    subtitle && subtitle.length > 120 ? `${subtitle.slice(0, 119).trimEnd()}…` : subtitle;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: INK,
        color: PAPER,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            background: TONE,
            color: INK,
            fontSize: "26px",
            fontWeight: 700,
            letterSpacing: "-1px",
          }}
        >
          SP
        </div>
        {eyebrow ? (
          <div
            style={{
              fontSize: "22px",
              letterSpacing: "3px",
              textTransform: "uppercase",
              color: TONE,
            }}
          >
            {eyebrow}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <div
          style={{
            fontSize: safeTitle.length > 46 ? "56px" : "68px",
            fontWeight: 700,
            letterSpacing: "-2px",
            lineHeight: 1.06,
          }}
        >
          {safeTitle}
        </div>
        {safeSubtitle ? (
          <div style={{ fontSize: "28px", lineHeight: 1.35, color: MUTED }}>{safeSubtitle}</div>
        ) : null}
      </div>

      {/* The name is on every card, in the same place, whatever the page. A
            social card is often the only impression that survives a re-share,
            so the one thing it must always carry is whose work this is. */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "24px" }}>
        <span style={{ fontWeight: 700 }}>{person.name}</span>
        <span style={{ color: MUTED }}>·</span>
        <span style={{ color: MUTED }}>{person.jobTitle}</span>
      </div>
    </div>,
    { ...OG_SIZE },
  );
}
