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
 * ### The palette was also wrong
 *
 * The original card was `#111110` / `#f4f3ee` / `#d8fe67` — near-black, bone and
 * an olive lime. That was the site's identity once. The theme is a two-colour
 * pink-and-cream system now, and every one of those three values is outside it,
 * so the card a stranger saw first looked like a different site than the one the
 * link opened. The values below are the real tokens: `--ink`, `--paper`,
 * `--pink`.
 *
 * They are written as literals rather than read from CSS on purpose — this runs
 * in the Edge runtime with no stylesheet and no `getComputedStyle`. That makes
 * them a second copy, so they are named here explicitly to be found when the
 * palette next moves.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const INK = "#1a0a10"; // --ink
const PAPER = "#fdf8f5"; // --paper
const PINK = "#ffc2da"; // --pink
const MUTED = "#c9b3bc";

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
            background: PINK,
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
              color: PINK,
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
