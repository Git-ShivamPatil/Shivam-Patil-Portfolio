"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { audiences, AUDIENCE_STORAGE_KEY, type AudienceId } from "../../app/audiences";
import "./entry-gate.css";

/**
 * The four-way chooser that greets a first-time visitor.
 *
 * **The page underneath is rendered, not withheld.** The overlay is
 * `position: fixed; inset: 0`, so it covers the site without taking it out of
 * the document. Three things depend on that and each would break under a
 * "return null until chosen" implementation:
 *
 * - **Search.** This site ships a sitemap, a canonical, Person JSON-LD and
 *   per-route metadata. Content that only exists after a click is content a
 *   crawler has to guess at, and the homepage is the page every other one
 *   links back to.
 * - **Layout shift.** A fixed overlay participates in no layout, so choosing a
 *   path moves nothing. CLS on this site is 0 and Lighthouse gates it.
 * - **The E2E suite.** Forty-seven specs assert a visible `main h1` on every
 *   route. An interstitial that empties `<main>` fails all of them, and would
 *   be failing for a reason that has nothing to do with what they test.
 *
 * The choice is read before first paint by an inline script in the root layout,
 * which stamps `data-audience-chosen` on `<html>`. The CSS keys off that
 * attribute, so a returning visitor never sees a frame of the overlay — the
 * same trick, and the same reasoning, as `data-reveal-ready`.
 */
/* The stored choice, read as an external store rather than copied into state
   by an effect.

   `useState` + `useEffect` is the obvious shape and the compiler lint rejects
   it: setState in an effect body cascades a second render on every mount. It is
   also wrong here for a subtler reason — localStorage is genuinely external
   state, so reading it during render through the documented API is what this
   hook is for. NavDrawer settled the same question the same way.

   The server snapshot is a non-null sentinel, so the overlay is absent from the
   SSR output and appears on the client only when nothing is stored. */
const subscribeToNothing = () => () => {};
const readStoredChoice = (): string | null => {
  try {
    return window.localStorage.getItem(AUDIENCE_STORAGE_KEY);
  } catch {
    // Safari private mode throws on access rather than returning null. Treat
    // that as "not chosen" and let the visitor pick again.
    return null;
  }
};
const serverChoice = () => "ssr";

export function EntryGate() {
  const router = useRouter();
  const stored = useSyncExternalStore(subscribeToNothing, readStoredChoice, serverChoice);
  // Set only from event handlers, which is where setState belongs.
  const [dismissed, setDismissed] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const open = !stored && !dismissed;

  // Move focus into the dialog once it is up, so a keyboard visitor is not
  // tabbing through a page they cannot see.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a,button")?.focus();
  }, [open]);

  const choose = useCallback(
    (id: AudienceId, href: string) => {
      try {
        window.localStorage.setItem(AUDIENCE_STORAGE_KEY, id);
      } catch {
        // A visitor who cannot persist the choice still gets to make it; they
        // are simply asked again next time. Losing the preference is a much
        // smaller failure than refusing to route them.
      }
      document.documentElement.setAttribute("data-audience-chosen", "true");
      setDismissed(true);
      router.push(href);
    },
    [router],
  );

  const skip = useCallback(() => {
    // Deliberately not persisted. Skipping is "not now", not "never ask again"
    // — persisting it would silently retire the chooser on one stray Escape.
    document.documentElement.setAttribute("data-audience-chosen", "true");
    setDismissed(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, skip]);

  // Scroll is locked while the chooser is up, restoring the previous value
  // rather than clearing it — something else may own body overflow at the time.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="entry-gate" role="dialog" aria-modal="true" aria-labelledby="entry-gate-title">
      <div className="entry-gate-panel" ref={panelRef}>
        <p className="eyebrow">
          <span className="live-dot" />
          Before you go in
        </p>
        <h2 id="entry-gate-title">
          Who&apos;s <em>reading?</em>
        </h2>
        <p className="entry-gate-lede">
          The site is the same either way — this just decides what it leads with.
        </p>

        <div className="entry-gate-options">
          {audiences.map((audience) => (
            <button
              key={audience.id}
              type="button"
              className="entry-gate-option"
              onClick={() => choose(audience.id, audience.href)}
            >
              <span className="entry-gate-option-label">{audience.label}</span>
              <span className="entry-gate-option-blurb">{audience.blurb}</span>
              <span className="entry-gate-option-arrow" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>

        <button type="button" className="entry-gate-skip" onClick={skip}>
          Just let me look around
        </button>
      </div>
    </div>
  );
}
