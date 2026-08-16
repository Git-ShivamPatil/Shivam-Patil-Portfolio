"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { audiences, AUDIENCE_STORAGE_KEY } from "../../app/audiences";
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
 * **It asks on every load, by design.** The choice is not persisted: it is part
 * of how the site introduces itself rather than a setting to get past, and the
 * same person is not reliably the same kind of visitor twice. `dismissed` is
 * component state, so a choice survives client-side navigation within the visit
 * and resets on the next full load — which is exactly the scope wanted.
 */
/* The suppression key, read as an external store rather than copied into state
   by an effect.

   **Nothing in the product writes this key.** Choosing a path no longer
   persists, so a real visitor is asked on every load and this read always
   returns null for them. It stays because the E2E suite seeds it through
   `storageState` in playwright.config.ts: the gate covers the viewport, so
   without a way to pre-answer it, every one of the fifty-plus specs would have
   to dismiss a modal before it could click anything. That is a bypass for the
   harness, not a preference for visitors — deleting it would put twelve specs
   back into the failure mode CI run 43 found.

   `useSyncExternalStore` rather than `useState` + `useEffect`: the compiler
   lint rejects setState in an effect body, and localStorage is genuinely
   external state, so reading it during render through the documented API is
   what this hook is for. NavDrawer settled the same question the same way.

   The server snapshot is a non-null sentinel, so the overlay is absent from the
   SSR output and appears on the client only. */
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
    (href: string) => {
      // The choice is deliberately NOT persisted.
      //
      // It used to be, and the question was asked once per browser. Asking on
      // every load is the intended behaviour: the chooser is part of how the
      // site introduces itself rather than a settings prompt to get past, and a
      // returning visitor is rarely the same kind of visitor twice — the same
      // person arrives as a recruiter on Monday and as a human on Friday.
      //
      // `dismissed` is component state, so it survives client-side navigation
      // within the visit and resets on the next full load, which is exactly the
      // scope wanted. Nothing is written to storage.
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
              onClick={() => choose(audience.href)}
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
