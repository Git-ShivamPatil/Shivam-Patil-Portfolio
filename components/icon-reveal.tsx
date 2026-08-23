import { BRAND_ICONS, type BrandIconName } from "./icons";

/**
 * A label that becomes its icon on hover.
 *
 * "GitHub" is a word until you point at it, at which point the word slides
 * up out of the slot and the GitHub mark rises into the space it left.
 * Focus does the same thing, so the interaction is not mouse-only.
 *
 * **It is a server component, and that is the point.** The whole mechanic is
 * two `transform`s and two `opacity`s driven by `:hover` / `:focus-visible`
 * on the enclosing link — see `.icon-reveal` in app/motion.css. No state, no
 * effect, no event handler, nothing shipped to the browser. The previous
 * generation of this idea on other sites is a `useState` and an
 * `onMouseEnter`, which costs a client boundary on every link that uses it
 * and stops working before hydration; this works on the first frame and in a
 * page with JavaScript disabled.
 *
 * **Layout stability is designed in, not hoped for.** Both children occupy
 * the same single grid area, so the slot's width is the label's width and
 * the swap moves nothing around it. That matters here more than usual: these
 * sit in the footer directory and in /reach-out's channel rows, both of
 * which are dense lists where a few pixels of reflow per row would ripple.
 *
 * **The label never leaves the DOM.** It is translated and faded, not
 * removed and not `display: none`, so it stays the link's accessible name
 * and stays selectable by find-in-page. The icon is `aria-hidden`, so a
 * screen reader hears "GitHub" once rather than twice.
 *
 * Reduced motion is handled globally — app/globals.css blanket-cancels
 * transition durations under `prefers-reduced-motion`, which turns this into
 * an instant swap rather than an animation. That is the correct degradation:
 * the affordance still works, it just does not travel.
 */
export function IconReveal({
  label,
  icon,
  className = "",
}: {
  label: string;
  icon: BrandIconName;
  className?: string;
}) {
  const Icon = BRAND_ICONS[icon];
  return (
    <span className={`icon-reveal ${className}`.trim()}>
      <span className="icon-reveal-label">{label}</span>
      <span className="icon-reveal-glyph">
        <Icon />
      </span>
    </span>
  );
}
