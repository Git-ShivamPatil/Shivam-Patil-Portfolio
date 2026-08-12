"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
// From constants, never from lib/realtime/presence — that module imports
// Prisma, and importing it here would ship the database client to the browser.
import { PRESENCE_HEARTBEAT_MS } from "../lib/realtime/constants";

/**
 * P11 — the browser half of presence.
 *
 * One token per *document*, one beat every PRESENCE_HEARTBEAT_MS while the tab
 * is visible, and a `sendBeacon` on the way out so a leaving visitor frees
 * their row immediately instead of lingering for a TTL.
 *
 * **The token lives in module scope, deliberately — not in storage.** That is
 * not a shortcut; it is what makes the release beacon safe. A token held in
 * `sessionStorage` survives a reload, so the outgoing page's "I'm leaving,
 * delete token T" and the incoming page's "I'm here, token T" race each other,
 * and `sendBeacon` gives no ordering guarantee: when the beacon lands second it
 * deletes a row for a visitor who is demonstrably still on the site. Found
 * exactly that way — the beat returned 200 and the table stayed empty.
 *
 * A module-scoped token dies with the document, so a reload mints a fresh one
 * and the two requests name different rows. Client-side navigations keep the
 * module alive, so clicking through the site is still one presence row rather
 * than one per page. Storage-free also means no private-mode failure path and
 * nothing at all persisted on the visitor's machine.
 *
 * Two further decisions worth stating:
 *
 * - **Visibility-gated.** A backgrounded tab is not a person on the site. Left
 *   ungated, one abandoned tab would beat forever and count as a live visitor
 *   for as long as the browser stayed open.
 * - **The interval restarts on navigation** rather than an extra beat firing
 *   per route change, so a visitor clicking quickly through five pages sends
 *   five beats total, not five plus the periodic ones.
 */

/** Fired on `window` whenever the server tells us the owner's status changed. */
export const PRESENCE_EVENT = "sf:presence";

export interface PresenceDetail {
  ownerOnline: boolean;
}

let documentToken: string | null = null;

function tabToken(): string | null {
  if (documentToken) return documentToken;
  try {
    // crypto.randomUUID needs a secure context; any browser without it is one
    // where a presence badge is not worth a polyfill.
    documentToken = crypto.randomUUID().replace(/-/g, "");
    return documentToken;
  } catch {
    return null;
  }
}

export function PresenceTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const token = tabToken();
    if (!token) return;

    let cancelled = false;
    let lastOwnerOnline: boolean | null = null;

    const beat = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/presence/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, path: pathname }),
          // Presence is never worth keeping a page alive for.
          keepalive: false,
        });
        if (!response.ok) return;
        const json = (await response.json()) as { ownerOnline?: boolean };
        const ownerOnline = json.ownerOnline === true;
        // Only announce transitions. The chat widget re-renders on this event,
        // and a badge that already says "online" does not need to hear it again
        // every twenty seconds.
        if (ownerOnline !== lastOwnerOnline) {
          lastOwnerOnline = ownerOnline;
          window.dispatchEvent(
            new CustomEvent<PresenceDetail>(PRESENCE_EVENT, { detail: { ownerOnline } }),
          );
        }
      } catch {
        // Offline, or mid-deploy. The badge simply stops updating.
      }
    };

    void beat();
    const timer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS);

    // Coming back to a backgrounded tab should update the badge now, not in up
    // to twenty seconds.
    const onVisibility = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // A page restored from the bfcache has already sent its release beacon, so
    // its row is gone while the visitor is looking straight at it. Beat
    // immediately rather than waiting out an interval.
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) void beat();
    };
    window.addEventListener("pageshow", onShow);

    // `pagehide` rather than `unload`: iOS fires the latter unreliably, and
    // bfcache-restored pages never fire it at all. sendBeacon because a normal
    // fetch is cancelled the moment the document goes away.
    const onLeave = () => {
      try {
        navigator.sendBeacon?.(
          "/api/presence/heartbeat",
          new Blob([JSON.stringify({ token, path: pathname, leaving: true })], {
            type: "application/json",
          }),
        );
      } catch {
        // Nothing to recover — the row lapses on its own within a TTL.
      }
    };
    window.addEventListener("pagehide", onLeave);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [pathname]);

  return null;
}
