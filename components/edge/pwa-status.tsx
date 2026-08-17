"use client";

import { useCallback, useEffect, useState } from "react";
import {
  hasBackgroundSync,
  isSupported,
  pending,
  requestDrain,
  type DrainMechanism,
} from "../../lib/pwa/outbox";

/**
 * P23 — what the offline layer is actually doing in *this* browser.
 *
 * Reported rather than claimed. "Works offline" means four different things
 * across four browsers, and a page that says it flatly is wrong in at least
 * two of them.
 */

interface Status {
  online: boolean;
  worker: "none" | "registering" | "active";
  /** What the API's presence advertises. */
  backgroundSyncApi: boolean;
  /** What actually happened when we asked. See lib/pwa/outbox.ts. */
  mechanism: DrainMechanism;
  queued: number;
  installed: boolean;
  caches: string[];
}

export function PwaStatus() {
  const [status, setStatus] = useState<Status | null>(null);

  const read = useCallback(async () => {
    if (typeof navigator === "undefined") return;

    const registration =
      "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistration().catch(() => null)
        : null;

    let cacheNames: string[] = [];
    try {
      cacheNames = (await caches.keys()).filter((name) => name.startsWith("sf-"));
    } catch {
      // Cache Storage is unavailable in some private modes.
    }

    // Asked rather than detected. `requestDrain` reports which mechanism took
    // responsibility, and an empty queue makes the call free — which is what
    // lets the status line say what will really happen instead of what the
    // API's presence implies. In this very browser the Background Sync API is
    // present and refuses to register.
    const mechanism = registration ? await requestDrain() : "none";

    setStatus({
      online: navigator.onLine,
      worker: !registration ? "none" : registration.active ? "active" : "registering",
      backgroundSyncApi: hasBackgroundSync(),
      mechanism,
      queued: await pending(),
      // The reliable install signal. `navigator.standalone` is a
      // Safari-only legacy property and the beforeinstallprompt event says
      // whether it *could* be installed, not whether it is.
      installed:
        typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches,
      caches: cacheNames,
    });
  }, []);

  useEffect(() => {
    // The lint rule objects to state being set from an effect, and it is
    // usually right — most such cases are derived state that belongs in render.
    // This is the exception the rule cannot see: every value here is read
    // asynchronously from an external system the render pass cannot touch
    // (IndexedDB, Cache Storage, the service-worker registration), and none of
    // them exists during the server render. Synchronising React state with an
    // external store is the definition of what an effect is for.
    //
    // The alternative — useSyncExternalStore, as webusb-lab.tsx uses for its
    // one synchronous check — does not apply: its snapshot must be synchronous,
    // and three of these six values are promises.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void read();

    // Re-read on connectivity change: the queued count is the number most
    // likely to move, and it moves exactly when the network comes back.
    const onChange = () => void read();
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);

    // And re-read once a worker takes control.
    //
    // On a first-ever visit the worker is registered from the deferred layer
    // *after* load, so this panel's first read genuinely finds none and would
    // otherwise sit on "Not registered" until a navigation — reporting the
    // feature as absent on precisely the visit that just enabled it.
    //
    // `controllerchange` rather than awaiting `navigator.serviceWorker.ready`:
    // that promise never settles when no worker is ever registered, so awaiting
    // it would leave this component hanging forever in browsers where the
    // registration fails.
    const onController = () => void read();
    navigator.serviceWorker?.addEventListener("controllerchange", onController);

    return () => {
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
      navigator.serviceWorker?.removeEventListener("controllerchange", onController);
    };
  }, [read]);

  if (!status) return <p className="edge-note">Reading the offline layer…</p>;

  if (!isSupported()) {
    return (
      <div className="edge-panel" data-state="unsupported">
        <p className="edge-panel-state">No service worker support</p>
        <p className="edge-note">
          Without IndexedDB and a service worker there is no offline layer at all. The site works
          exactly as it did before — which is the point of building this as an enhancement rather
          than a dependency.
        </p>
      </div>
    );
  }

  return (
    <div className="edge-panel" data-state={status.worker === "active" ? "supported" : "partial"}>
      <dl className="edge-figures">
        <div>
          <dt>Connection</dt>
          <dd>{status.online ? "Online" : "Offline"}</dd>
        </div>
        <div>
          <dt>Service worker</dt>
          <dd>
            {status.worker === "active"
              ? "Active"
              : status.worker === "registering"
                ? "Installing"
                : "Not registered"}
          </dd>
        </div>
        <div>
          <dt>Background Sync</dt>
          <dd>
            {status.mechanism === "background-sync"
              ? "Working"
              : status.backgroundSyncApi
                ? "Refused"
                : "Absent"}
          </dd>
        </div>
        <div>
          <dt>Queued</dt>
          <dd>{status.queued}</dd>
        </div>
        <div>
          <dt>Caches</dt>
          <dd>{status.caches.length}</dd>
        </div>
        <div>
          <dt>Installed</dt>
          <dd>{status.installed ? "Standalone" : "In a tab"}</dd>
        </div>
      </dl>

      <p className="edge-note">
        {status.mechanism === "background-sync"
          ? "Background Sync accepted the registration, so anything queued sends when the connection returns — even if you close this tab first."
          : status.backgroundSyncApi
            ? "The Background Sync API exists in this browser and refused to register — it is separately revocable, off by default in several hardened and automated configurations, and denied on origins with low engagement. Queued messages are sent while this tab is open instead. Detecting the API and trusting it is how this silently sent nothing at all, before the fallback existed."
            : "Background Sync is absent here (Safari does not implement it). Queued messages are sent on your next visit instead, which is a weaker promise and the page will not pretend otherwise."}
      </p>

      {status.queued > 0 ? (
        <div className="edge-actions">
          <button type="button" className="edge-button" onClick={() => void requestDrain()}>
            Send {status.queued} queued now
          </button>
        </div>
      ) : null}
    </div>
  );
}
