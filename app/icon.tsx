import { ImageResponse } from "next/og";

/**
 * 96x96, not 32x32.
 *
 * Google's guidance for the favicon it shows beside a search result is that the
 * file should be **a multiple of 48px square** — 48, 96, 144 and so on. It
 * downsamples to whatever the surface needs. 32x32 is not a multiple of 48, and
 * it is also below the 48px floor, so it was the wrong asset for the one place
 * this icon is most seen by people who do not already know the site.
 *
 * 96 rather than 48: it is the 2x asset, so it stays crisp on a retina tab
 * strip as well as satisfying the search-result requirement with one file.
 */
export const size = { width: 96, height: 96 };
export const contentType = "image/png";

/**
 * The tab icon: one letter on a solid plate.
 *
 * ### What this replaced, and why it changed twice
 *
 * It began as "SP" in white on a dark **disc**. Two letters inside a circle
 * leave each glyph about six pixels of usable height once the padding and the
 * circle's inset are taken off, and a favicon renders at 16px in most tab
 * strips — so "SP" was a smudge. The disc also drew a hard edge around the
 * mark, which meant the eye caught the container before the letter.
 *
 * That was replaced with a single "S" filling the box on a **transparent**
 * background, which was the literal brief ("no background") and fixed the
 * legibility. It also introduced a bug, and this is the commit that fixes it:
 *
 * **A transparent PNG takes the colour of whatever paints behind it.** On a
 * dark tab strip a white "S" has full contrast. On a LIGHT one it has none —
 * and the single most important light surface this icon appears on is a Google
 * search result, which is white. The icon was on its way to rendering as an
 * empty square in exactly the place it does the most work.
 *
 * So the plate is back, and the thing the brief actually objected to is still
 * gone: there is no `borderRadius`, so no disc. A square plate reads as the
 * icon's own edge rather than as a badge drawn around it, and it composites
 * predictably on white, on near-black, and on whatever a browser chooses.
 *
 * ### Why white-on-black rather than black-on-white
 *
 * Both are legible on both surfaces. This direction matches the site, which
 * defaults to dark, and it keeps the mark reading as the same object in the tab
 * strip and on the page.
 */
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        /* Opaque, and the whole point of this revision — see above. --ink,
             the "always near-black regardless of theme" token. */
        background: "#0e0e0e",
        color: "#ffffff",
        /* ~72% of the box. The plate needs a margin or the letter reads as
             cropped once a browser rounds the corners itself, which several do
             to favicons they did not ask to be square. */
        fontSize: "68px",
        /* 700: one letter downsampled from 96px to 16px loses stem weight,
             and a thin "S" at 16px turns into a grey smear. */
        fontWeight: 700,
        /* A single glyph centres on its advance width, which includes side
             bearings the eye does not see. Nudged so it sits optically centred
             rather than metrically. */
        letterSpacing: "-2px",
        lineHeight: 1,
      }}
    >
      S
    </div>,
    { ...size },
  );
}
