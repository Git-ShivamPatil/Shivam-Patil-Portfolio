import Image from "next/image";

/**
 * Ghosted brand mark bled off the page edge.
 *
 * Decorative only: `aria-hidden` keeps it out of the accessibility tree and
 * `pointer-events: none` (see .brand-watermark in globals.css) keeps it from
 * intercepting clicks on the content that sits above it. It anchors to `main`,
 * which is the nearest positioned ancestor.
 *
 * The source image is a photograph rather than a flat logo, so the CSS
 * deliberately desaturates and masks it — at full colour it would read as a
 * stray photo pasted behind the text instead of a watermark.
 */
export function BrandWatermark({
  placement = "bottom-right",
}: {
  placement?: "bottom-right" | "top-right";
}) {
  return (
    <div
      className={`brand-watermark brand-watermark-${placement}`}
      aria-hidden="true"
      // Drifts with both the pointer and the scroll position, so it sits
      // behind the content as a parallax layer rather than a flat sticker.
      data-parallax-pointer="0.7"
      data-parallax-scroll="0.22"
    >
      <Image
        src="/logo.jpeg"
        alt=""
        width={720}
        height={1280}
        sizes="(max-width: 900px) 55vw, 520px"
        className="brand-watermark-img"
      />
    </div>
  );
}
