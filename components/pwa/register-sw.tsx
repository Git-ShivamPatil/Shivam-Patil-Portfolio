"use client";

import { useEffect } from "react";
import { requestDrain } from "../../lib/pwa/outbox";

/**
 * P23 — register the service worker on every load.
 *
 * **Before this, the worker only registered when someone opened the push
 * toggle and granted notification permission.** That was correct while the
 * worker did nothing but deliver notifications. Now that it also serves the
 * offline shell and drains the outbox, tying its installation to a permission
 * prompt would mean offline support existed only for the small fraction of
 * visitors who had opted into notifications — and would make the outbox
 * unavailable to precisely the people most likely to need it.
 *
 * Registration stays idempotent: `register()` on an already-registered scope
 * resolves to the existing registration and does not re-download unless the
 * bytes changed. components/push-toggle.tsx still calls it, and that is fine.
 *
 * Renders nothing, and is mounted inside the deferred layer — a service worker
 * registration is the definition of work that should not compete with first
 * paint.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js");
        if (cancelled) return;

        // Ask for a drain on every load, not only after queueing. Where
        // Background Sync is unsupported this is the *only* thing that ever
        // sends a queued message, and a visitor returning after a flight is
        // exactly the case it covers.
        await requestDrain();
      } catch (error) {
        // A failed registration must never surface to the visitor. The site
        // works without a worker; that is the whole design of progressive
        // enhancement, and an error toast about a caching layer is noise
        // about something they did not ask for.
        console.error("[sw] registration failed", error);
      }
    };

    // After load rather than on mount. Registration competes with the initial
    // asset fetches for connections, and a worker that installs 400ms later
    // costs nothing — it cannot serve this navigation either way.
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
