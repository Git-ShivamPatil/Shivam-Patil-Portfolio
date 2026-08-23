import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * The tab icon: one letter, no container.
 *
 * It used to be "SP" in white on a #0e0e0e disc. Two things were wrong with
 * that at the size it actually renders. A favicon is shown at 16px in most
 * tab strips — the 32px here is the 2x asset — and two letters inside a disc
 * leaves each glyph about six pixels of usable height once the padding and
 * the circle's own inset are taken off. At that size "SP" is a smudge, not a
 * lettermark. The disc was also doing the opposite of what a tab icon wants:
 * it drew a hard edge around the mark, so what the eye caught first was the
 * container rather than the letter in it.
 *
 * So: one letter, filling the box, no disc and no fill behind it. The glyph
 * is the whole icon, which is how the marks that read best at 16px are built
 * — the Google "G", the Figma and Notion marks, the GitHub cat. Dropping the
 * second letter roughly doubles the height available to the first.
 *
 * **The background is transparent, and that is a deliberate trade.** A
 * transparent PNG takes the colour of whatever the browser paints behind it,
 * which is the tab strip. On a dark tab strip — the default on Windows and
 * macOS in dark mode, and what this site's own theme assumes — a white "S"
 * has full contrast. On a light tab strip it has none, and the icon will look
 * empty.
 *
 * That is the literal brief ("no background"), and it is the right call for
 * this site's audience, but it is a real limitation rather than a detail. If
 * a light tab strip ever matters, the fix is one line: give the wrapper
 * `background: "#0e0e0e"` back and keep everything else, which restores a
 * dark plate under the letter without bringing back the disc.
 *
 * No `borderRadius`: the letter is the shape.
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
        // Transparent — see the note above.
        background: "transparent",
        color: "#ffffff",
        /* 30px in a 32px box. The glyph is meant to reach the edges: an "S"
             has no ascender or descender, so its cap height is the whole of
             its visual weight and there is nothing to clip. */
        fontSize: "30px",
        /* 700, not 600. One letter at 16px needs the extra stem width or it
             thins out to nothing once the browser downsamples the 32px PNG. */
        fontWeight: 700,
        /* Slightly negative so the letterform sits optically centred; a
             single glyph in a flex box centres on its advance width, which
             includes side bearings the eye does not see. */
        letterSpacing: "-1px",
        lineHeight: 1,
      }}
    >
      S
    </div>,
    { ...size },
  );
}
