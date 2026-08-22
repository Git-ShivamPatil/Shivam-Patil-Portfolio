"use client";

import { useSyncExternalStore } from "react";
import { requestPalette } from "../../lib/devex/palette-events";

/**
 * The platform's modifier key: "⌘" on Apple hardware, "ctrl" everywhere else.
 *
 * ### Why this is `useSyncExternalStore` and not `useState` + `useEffect`
 *
 * The server has no `navigator`, so it must render "ctrl" for everyone; the
 * client then has to correct that on Apple hardware. Reading `navigator` during
 * render would make the two disagree about the text inside the element — a
 * hydration mismatch, the same class of bug §44 found on /mlops where a
 * locale-dependent number rendered "128,000" on the server and "1,28,000" in
 * the browser.
 *
 * The obvious fix — start at "ctrl", correct it in an effect — is what this was
 * first written as, and `react-hooks/set-state-in-effect` rejects it: a
 * setState in an effect body renders once with the wrong value and again with
 * the right one, which is the cascading-render pattern this repo lints against
 * everywhere else.
 *
 * `useSyncExternalStore` is the hook that exists for exactly this shape. Its
 * third argument is the server snapshot and its second is the client one, so
 * React itself renders "ctrl" through hydration and swaps to "⌘" afterwards —
 * no mismatch to report and no state to set. The subscribe function returns an
 * unsubscribe and never fires: a machine does not stop being a Mac.
 */
const subscribe = () => () => {};
const serverModifier = () => "ctrl";

function clientModifier(): string {
  // `userAgentData.platform` where it exists, `platform` where it does not.
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "ctrl";
}

function useModifier(): string {
  // Strings compare by value, so returning a fresh one from clientModifier on
  // every call cannot cause the infinite re-render loop this hook warns about
  // when a snapshot returns a new object each time.
  return useSyncExternalStore(subscribe, clientModifier, serverModifier);
}

/**
 * "Press ⌘ K to start" — and a button, not a sentence.
 *
 * The reference design states the shortcut as flat text. That is fine on a
 * laptop and useless on a phone: there is no ctrl key to press, and with the
 * homepage's twenty-eight-card index gone, a touch visitor who read that line
 * had nowhere to go from it. So the whole line is a real `<button>` that fires
 * the same event the shortcut does.
 */
export function PaletteHint() {
  const modifier = useModifier();

  return (
    <button type="button" className="palette-hint" onClick={requestPalette}>
      Press <kbd>{modifier}</kbd> <kbd>K</kbd> to start <span aria-hidden="true">→</span>
    </button>
  );
}

/**
 * The same affordance, compressed to a chip for the header bar.
 *
 * It replaced a magnifying-glass link to /search. That link still exists in the
 * footer and the palette still searches, so nothing is lost — but an icon that
 * navigates to a search page and a shortcut that opens a search overlay are two
 * doors onto one room, and the bar only has space to advertise one properly.
 *
 * `aria-label` carries the full sentence because the visible text is two glyphs.
 * `aria-keyshortcuts` states the binding in the form assistive tech actually
 * reads, which the visible ⌘K does not: it is presentation, not a declaration.
 */
export function PaletteButton() {
  const modifier = useModifier();

  return (
    <button
      type="button"
      className="palette-button"
      onClick={requestPalette}
      aria-label="Open the command palette"
      aria-keyshortcuts="Control+K Meta+K"
    >
      <kbd>{modifier}</kbd>
      <kbd>K</kbd>
    </button>
  );
}
