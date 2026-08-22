/**
 * The contract between "something asked for the command palette" and the
 * palette itself — kept in its own module because three unrelated components
 * need it and none of them should own it.
 *
 * ### Why this is not just an event name
 *
 * The palette is mounted by `components/providers/deferred-layer.tsx`, behind
 * `requestIdleCallback` and a dynamic import, and that is correct: closed, it
 * is one keydown listener, and nothing on the first frame depends on it.
 *
 * It stopped being harmless when the homepage was reduced to a name, a role,
 * a line, and "Press ctrl K to start". That instruction is now the page's
 * primary navigation affordance, which means the single most likely moment for
 * a visitor to trigger the palette is the first second after the page appears —
 * exactly the window in which its listener does not exist yet. A CustomEvent
 * fired into a document with no listener is silently dropped. The button
 * clicked, nothing happened, and the visitor had no way to know whether they
 * had missed.
 *
 * So a request is recorded as well as dispatched, and the palette claims it on
 * mount. The flag is module-level rather than on `window`: both the deferred
 * chunk and the main bundle import this module, and a bundler shares one module
 * instance across chunks in a single runtime — so this is the same variable in
 * both, without putting anything on the global object.
 */

export const OPEN_PALETTE_EVENT = "sf:open-palette";

let pending = false;

/**
 * Ask for the palette.
 *
 * Records the request first, dispatches second. That order matters: a listener
 * that is already attached handles the event synchronously and calls
 * `consumePaletteRequest()` during the dispatch, clearing the flag it just set.
 * Setting it afterwards would leave the flag on and open the palette a second
 * time on the next mount.
 */
export function requestPalette(): void {
  pending = true;
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
}

/**
 * Claim a request made before the palette existed. Returns true at most once
 * per request — the caller opens; nobody else should see the same request.
 */
export function consumePaletteRequest(): boolean {
  const requested = pending;
  pending = false;
  return requested;
}
